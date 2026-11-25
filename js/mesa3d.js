// Casa Cobre: a mesa em 3D, desenhada em tempo real a cada quadro (lisa em 60, 100 ou 144 Hz).
// A luz da comida e da madeira vem assada do Cycles, ja com a cor final do render (AgX Punchy); aqui entram reflexos,
// vapor, a camera conduzida pela rolagem e as interacoes (luz do cursor, pratos clicaveis, ingredientes, mesa da reserva, sons).
import * as THREE from "three";
import { GLTFLoader } from "./vendor/three/addons/loaders/GLTFLoader.js";
import * as som from "./som.js";

const CEL = matchMedia("(max-width: 760px), (pointer: coarse)").matches;
const TOQUE = matchMedia("(pointer: coarse)").matches;
const CALMO = matchMedia("(prefers-reduced-motion: reduce)").matches;
const Q = CEL ? "-m" : "";
const DIR = "assets/3d/";
const PRATOS = ["heroi", "alho", "bacalhau", "bombinha"];
const NOMES = { heroi: "Camarão empanado", alho: "Camarão ao alho", bacalhau: "Bacalhau à Brás", bombinha: "Bombinha de camarão" };
const ANCORA = { heroi: "p-empanado", alho: "p-alho", bacalhau: "p-bacalhau", bombinha: "p-bombinha" };
const POS = { heroi: [-0.36, 0.16], alho: [0.06, 0.25], bacalhau: [0.42, -0.02], bombinha: [-0.04, -0.24] };
const GIRO = { heroi: 24, alho: -18, bacalhau: 40, bombinha: 12 };
/* ingredientes, em coordenadas do prato no Blender (x, y, z) */
const LOCAIS = {
  heroi: { "Crosta de panko": [-0.0104, -0.059, 0.05], "Batata palha": [0, 0, 0.06], "Arroz cremoso": [0.0325, -0.089, 0.03], "Cauda do camarão": [-0.034, 0.029, 0.1] },
  alho: { "Camarão selado": [0.03, -0.04, 0.035], "Lascas de alho": [-0.02, 0.01, 0.04], "Molho de alho": [0.06, -0.065, 0.022] },
  bacalhau: { "Azeitona preta": [0.056, 0.012, 0.085], "Batata palha": [0.11, -0.04, 0.04], "Bacalhau com ovo": [-0.01, -0.02, 0.075] },
  bombinha: { "Bombinha de camarão": [0, -0.0755, 0.06], "Molho claro": [0, 0, 0.036], "Panela de cobre": [-0.12, -0.044, 0.036] },
};

/* Blender (Z para cima) para three (Y para cima) */
const B = (x, y, z) => new THREE.Vector3(x, z, -y);
const noPrato = (prato, [lx, ly, lz]) => {
  const a = (GIRO[prato] * Math.PI) / 180, [x, y] = POS[prato];
  return B(x + lx * Math.cos(a) - ly * Math.sin(a), y + lx * Math.sin(a) + ly * Math.cos(a), lz);
};

/* paradas da camera. ox/oy deslocam o quadro para abrir espaco para a ficha */
function paradas(retrato) {
  const k = retrato ? 1.42 : 1.14;
  const perto = (n, dx, dy, dz, ox) => {
    const [x, y] = POS[n];
    return { p: B(x + dx * k, y + dy * k, dz * k), t: B(x, y, 0.03), fov: retrato ? 36 : 30, ox: retrato ? 0 : ox, oy: retrato ? 0.17 : 0 };
  };
  return [
    /* no celular a mesa e vista girada: o lado comprido fica na vertical da tela */
    { p: retrato ? B(0.03, 0, 2.55) : B(0.03, -0.2, 1.74), t: B(0.03, 0, 0), fov: 36, ox: 0, oy: retrato ? 0.1 : 0.07, up: retrato ? new THREE.Vector3(1, 0, 0) : undefined },
    perto("heroi", 0.2, -0.42, 0.25, 0.09),
    perto("alho", -0.24, -0.4, 0.27, -0.09),
    perto("bacalhau", 0.16, -0.44, 0.3, 0.09),
    perto("bombinha", -0.2, -0.38, 0.26, -0.09),
    { p: B(-0.62, -1.0 * k, 0.48 * k), t: B(0.08, 0, 0.02), fov: 34, ox: retrato ? 0 : 0.14, oy: retrato ? 0.2 : 0 },
  ];
}

const CIMA = new THREE.Vector3(0, 1, 0);
const liso = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/* manchas de luz prontas (canvas -> textura), usadas na camada de tela por cima da cena */
function mancha(paradasCor, tam = 256) {
  const c = document.createElement("canvas"); c.width = c.height = tam;
  const x = c.getContext("2d"), g = x.createRadialGradient(tam / 2, tam / 2, 0, tam / 2, tam / 2, tam / 2);
  for (const [o, cor] of paradasCor) g.addColorStop(o, cor);
  x.fillStyle = g; x.fillRect(0, 0, tam, tam);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- caldos: uma pelicula transparente sobre o molho de cada panela, so com o brilho molhado.
   A cor do molho continua a do Cycles (assada); a pelicula soma os reflexos das luzes da cena, que mexem com:
   o balanco do caldo (mola amortecida com a frequencia real do primeiro modo de onda numa panela rasa),
   ondinhas onde o cursor ou o dedo passa, um tremor leve de calor e, no oleo do alho, bolhinhas fervendo. */
// luzes da cena do Blender (Z para cima -> Y para cima) e o peso de cada uma no reflexo
const LUZES = [[-0.36, 0.8, -0.1, 1], [0.25, 0.8, -0.1, 1], [-0.04, 0.8, 0.3, 0.7], [0.1, 0.5, -1.1, 2.4]];
const G = 9.81;
const CALDOS = {
  // R: raio do molho (m); h: profundidade (m); zeta: amortecimento (creme viscoso assenta rapido, oleo fino balanca mais)
  // nivel: altura (m) acima da qual o grao esta em cima da comida (camarao, monte), e nao no caldo: nao boia nem e levado
  // bolhas: fervura parada; ferve: bolhas com o fogo no maximo (segurando o clique); grade: tamanho da celula de bolha (creme: bolha maior)
  heroi: { malha: "heroi_base", R: 0.134, h: 0.010, zeta: 0.32, visc: 4.5, nivel: 0.0405, brilho: 0.9, sala: 1.2, rug: 45, vivo: 0.45, bolhas: 0, ferve: 1.5, grade: 0.018, oleo: false },
  alho: { malha: "alho_base", R: 0.101, h: 0.006, zeta: 0.07, visc: 1.6, nivel: 0.0305, brilho: 1.9, sala: 2.4, rug: 90, vivo: 1, bolhas: 1, ferve: 2.4, grade: 0.011, oleo: true },
  bombinha: { disco: [-0.04, -0.24, 0.0326, 0.0284], R: 0.03, h: 0.012, zeta: 0.16, visc: 2.4, nivel: 0.038, brilho: 1.4, sala: 1.8, rug: 80, vivo: 0.7, bolhas: 0, ferve: 1.3, grade: 0.012, oleo: false },
};
/* inclinar pela alca: borda = raio da panela (o apoio do lado oposto fica nela); alca = daqui para fora e alca;
   max = angulo maximo (rad); fluidez = quanto o molho se nivela (creme grosso acompanha so metade) */
const INCLINA = {
  heroi: { borda: 0.15, alca: 0.158, max: 0.09, fluidez: 0.5 },
  alho: { borda: 0.12, alca: 0.127, max: 0.11, fluidez: 0.85 },
};
// primeiro modo de onda numa panela redonda rasa: k = 1,8412 / R ; w = sqrt(g k tanh(k h))
for (const c of Object.values(CALDOS)) { const k = 1.8412 / c.R; c.w = Math.sqrt(G * k * Math.tanh(k * c.h)); }
const ONDAS = 10;
const SULCOS = 24; // rastro da colher/camarao arrastado no molho: pontos que viram um sulco raso e se fecham devagar

/* a pelicula segue a panela inclinada (uPivo) e sobe/desce com o balanco (uInc), junto com o molho assado embaixo */
const VERT_CALDO = /* glsl */ `
uniform mat4 uPivo; uniform vec2 uC, uInc;
varying vec3 vW, vL;
void main() {
  vec4 l = modelMatrix * vec4(position, 1.0);
  l.y += dot(l.xz - uC, uInc);
  vL = l.xyz;
  vec4 w = uPivo * l; vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/* altura da superficie do caldo num ponto (m): balanco + calor + ondinhas + bolhas. Usada pela pelicula e pelos graos que boiam.
   Coordenadas da panela (sem a inclinacao da alca); uTB e o relogio das bolhas, que corre mais rapido com o fogo alto */
const ALTURA_GLSL = /* glsl */ `
uniform float uT, uR, uBolha, uVivo, uFerve, uGrade, uTB;
uniform vec2 uC, uInc;
uniform vec4 uOnda[${ONDAS}];
uniform vec4 uSulco[${SULCOS}];
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bolhas(vec2 p) {
  vec2 g = p / uGrade, id = floor(g), f = fract(g) - 0.5;
  float r = hash(id), dens = 0.3 + 0.5 * uFerve;      // fogo alto: mais pontos fervendo
  if (r > dens) return 0.0;
  float per = 1.3 + r * 6.0, fase = fract(uTB / per + r * 7.0);
  vec2 off = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.45;
  float d = length(f - off), raio = 0.1 + 0.26 * fase;
  float vida = smoothstep(0.0, 0.15, fase) * (1.0 - smoothstep(0.86, 1.0, fase)) * smoothstep(dens, dens - 0.06, r);
  return vida * max(0.0, 1.0 - d * d / (raio * raio)) * 0.00032 * (1.0 + 1.5 * uFerve);
}
float altura(vec2 w) {
  vec2 p = w - uC;
  float h = dot(p, uInc);                                   // balanco (inclinacao do primeiro modo)
  h += uVivo * 0.00011 * (sin(p.x * 190.0 + uT * 1.7) * sin(p.y * 170.0 - uT * 1.3) + 0.6 * sin((p.x + p.y) * 260.0 + uT * 2.3)); // calor
#ifndef LEVE
  for (int i = 0; i < ${ONDAS}; i++) {                      // ondinhas: frente que se espalha e some
    vec4 o = uOnda[i];
    float a = uT - o.z;
    if (o.w == 0.0 || a < 0.0 || a > 3.0) continue;
    float e = length(w - o.xy) - a * 0.16;
    h += o.w * exp(-a * 1.7) * exp(-e * e / (0.00018 + a * 0.0006)) * sin(e * 520.0);
  }
  if (uBolha > 0.0) h += uBolha * bolhas(p);
  for (int i = 0; i < ${SULCOS}; i++) {                     // sulco: afunda onde a colher passou, alarga e fecha com o tempo
    vec4 s = uSulco[i];
    float a = uT - s.z;
    if (s.w == 0.0 || a < 0.0 || a > 7.0) continue;
    vec2 q = w - s.xy; float l = 0.0035 + a * 0.0012;
    h -= s.w * 0.0007 * exp(-a * 0.55) * exp(-dot(q, q) / (l * l));
  }
#endif
  return h;
}`;
const FRAG_CALDO = /* glsl */ `
${ALTURA_GLSL}
uniform float uBrilho, uRug, uAlfa, uSala;
uniform vec4 uLuz[4];
uniform mat4 uPivo;
varying vec3 vW, vL;
void main() {
  float e = 0.0007, h0 = altura(vL.xz);
  vec3 N = normalize(vec3(-(altura(vL.xz + vec2(e, 0.0)) - h0) / e, 1.0, -(altura(vL.xz + vec2(0.0, e)) - h0) / e));
  N = normalize(mat3(uPivo) * N);                                // a panela inclinada leva a normal junto
  vec3 V = normalize(cameraPosition - vW);
  float s = 0.0;
  for (int i = 0; i < 4; i++) { vec3 H = normalize(normalize(uLuz[i].xyz - vW) + V); s += uLuz[i].w * pow(max(dot(N, H), 0.0), uRug) * (uRug + 8.0) / 25.13; }
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0); // Fresnel: rasante reflete mais
  vec3 R = reflect(-V, N);
  float sala = 0.05 + 0.4 * smoothstep(0.15, 1.0, R.y);          // reflexo da sala: escuro em volta, claro para o teto com os pendentes
  float borda = 1.0 - smoothstep(0.84, 0.99, length(vL.xz - uC) / uR);
  // a cupula de cada bolha pega um pouco de luz (aparece mesmo sem o reflexo das lampadas cair nela)
  float hb = uBolha > 0.0 ? uBolha * bolhas(vL.xz - uC) / 0.00032 : 0.0;
  gl_FragColor = vec4((vec3(1.0, 0.86, 0.7) * (s * uBrilho + sala * uSala) * F + vec3(1.0, 0.88, 0.72) * 0.05 * hb) * borda * uAlfa, 1.0);
}`;

/* ---------- graos soltos: pecas 3D tiradas da cena do Blender (posicao, giro, tamanho e a cor iluminada pelo Cycles).
   Boiam com a mesma superficie do caldo (sobem, descem e inclinam com as ondas) e sao levados pela correnteza (CPU). */
const GRAOS = {
  // flutua: quanto acompanha a altura do caldo; inclina: quanto gira com a superficie; arrasto: quanto a correnteza leva;
  // mola: volta muito lenta ao lugar (o caldo grosso acomoda); molhado: brilho do caldo grudado
  // sombra: forca da sombra de contato (arroz: muitos graos juntos, sombra leve; ervilha redonda: mais marcada)
  arroz_graos: { flutua: 0.6, inclina: 0.6, arrasto: 5, mola: 0.03, molhado: 0.6, sombra: 0.32 },
  ervilhas: { flutua: 0.85, inclina: 0.5, arrasto: 3.2, mola: 0.03, molhado: 1.0, sombra: 0.75 },
  cenoura: { flutua: 0.85, inclina: 0.8, arrasto: 3.2, mola: 0.03, molhado: 0.8, sombra: 0.65 },
  camaroezinhos: { flutua: 0.7, inclina: 0.6, arrasto: 2.2, mola: 0.03, molhado: 0.9, sombra: 0.55 },
  lascas_alho: { flutua: 1, inclina: 1, arrasto: 2.6, mola: 0.01, molhado: 1.2, sombra: 0.45 },
  salsinha: { flutua: 1, inclina: 1, arrasto: 4, mola: 0.01, molhado: 0.8, sombra: 0.35 },
  cebolinha: { flutua: 1, inclina: 1, arrasto: 3.5, mola: 0.01, molhado: 0.9, sombra: 0.35 },
};
const VERT_GRAO = /* glsl */ `
${ALTURA_GLSL}
attribute vec3 aDesvio;
attribute float aSolto;   // 1 = no caldo (boia); 0 = em cima da comida (parado)
uniform float uFlutua, uInclina;
uniform mat4 uPivo;
varying vec3 vCor, vN, vW;
void main() {
  vec3 c = vec3(instanceMatrix[3]);
  vec3 p = mat3(instanceMatrix) * position;
  vec2 xz = c.xz + aDesvio.xz;
  float e = 0.001, h0 = altura(xz), hInc = dot(xz - uC, uInc);
  vec2 grad = vec2(altura(xz + vec2(e, 0.0)) - h0, altura(xz + vec2(0.0, e)) - h0) / e * aSolto;
  // o nivel do molho (balanco e inclinacao) leva o grao inteiro; ondas e bolhas, so o quanto ele boia
  vec3 w = vec3(xz.x, c.y + (hInc + (h0 - hInc) * uFlutua) * aSolto + aDesvio.y, xz.y) + p;
  w.y += dot(p.xz, grad) * uInclina;
  vec4 wp = uPivo * vec4(w, 1.0);
  vW = wp.xyz;
  vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vN = normalize(mat3(uPivo) * (mat3(instanceMatrix) * (normal / (s * s)) + vec3(-grad.x, 0.0, -grad.y) * uInclina));
#ifdef USE_INSTANCING_COLOR
  vCor = instanceColor;
#else
  vCor = vec3(0.7);
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG_GRAO = /* glsl */ `
uniform vec4 uLuz[4];
uniform float uMolhado, uAlfa;
varying vec3 vCor, vN, vW;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float s = 0.0;
  for (int i = 0; i < 4; i++) { vec3 H = normalize(normalize(uLuz[i].xyz - vW) + V); s += uLuz[i].w * pow(max(dot(N, H), 0.0), 70.0) * 3.1; }
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // a cor ja vem iluminada (lado de cima); o lado de baixo escurece um pouco, como no render
#ifdef COR_ASSADA
  float lado = 1.0;  // luz do Cycles assada em cada vertice: ja tem o lado de baixo escuro
#else
  float lado = 0.62 + 0.42 * max(0.0, dot(N, normalize(vec3(0.1, 1.0, 0.25))));
#endif
  gl_FragColor = vec4(vCor * lado * uAlfa + vec3(1.0, 0.86, 0.7) * s * F * uMolhado * uAlfa, 1.0);
  #include <colorspace_fragment>
}`;

/* ---------- vapor: planos que sempre olham para a camera, com ruido pronto (subindo e torcendo), bem translucido */
const VERT_FUMO = /* glsl */ `
uniform float uT, uVento; uniform sampler2D uRuido; varying vec2 vUv;
void main() {
  vUv = uv; vec3 p = position;
  float tor = (texture2D(uRuido, vec2(0.5, uv.y * 0.25 - uT * 0.012)).r - 0.5) * 7.0 * uv.y;
  p.x = p.x * cos(tor);
  float y2 = uv.y * uv.y;
  p.x += (texture2D(uRuido, vec2(0.2, uT * 0.008)).r - 0.5) * 0.07 * y2 + uVento * y2;
  p.z += (texture2D(uRuido, vec2(0.8, uT * 0.008)).r - 0.5) * 0.05 * y2;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG_FUMO = /* glsl */ `
uniform float uT, uOp; uniform sampler2D uRuido; varying vec2 vUv;
void main() {
  vec2 u = vUv * vec2(0.8, 0.42); u.y -= uT * 0.035;
  float n = smoothstep(0.4, 0.78, texture2D(uRuido, u).r * 0.65 + texture2D(uRuido, u * 2.1 + 0.37).r * 0.35);
  n *= smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.4, vUv.y);
  gl_FragColor = vec4(1.0, 0.96, 0.91, n * uOp);
}`;
const FUMOS = { heroi: 0.42, alho: 0.48, bombinha: 0.22, bacalhau: 0.16 }; // opacidade: sem exagero

/* ---------- sombra de contato dos graos: mancha suave embaixo de cada grao (o assado da comida foi feito sem os graos,
   entao sem isto eles pareciam colados por cima). Usa a mesma posicao do grao: boia, deriva e inclina junto */
const VERT_SOMBRA = /* glsl */ `
${ALTURA_GLSL}
attribute vec3 aDesvio;
attribute float aSolto;
uniform float uFlutua;
uniform mat4 uPivo;
varying vec2 vUv;
varying float vSolto;
void main() {
  vec3 c = vec3(instanceMatrix[3]);
  vec3 a0 = instanceMatrix[0].xyz, a1 = instanceMatrix[1].xyz, a2 = instanceMatrix[2].xyz;
  vec2 xz = c.xz + aDesvio.xz;
  float h0 = altura(xz), hInc = dot(xz - uC, uInc);
  float meia = abs(a0.y) + abs(a1.y) + abs(a2.y);              // meia altura do grao
  vUv = position.xz * 2.0;                                      // -1..1
  // elipse no chao seguindo os dois eixos maiores do grao (um pouco maior que ele), com tamanho minimo
  vec2 e0 = a0.xz, e1 = a1.xz;
  float m = max(length(e0), length(e1));
  e0 += normalize(e0 + 1e-6) * m * 0.25; e1 += normalize(e1 + 1e-6) * m * 0.25;
  vec2 off = (e0 * vUv.x + e1 * vUv.y) * 1.45;
  // no caldo: na altura do meio do grao (o grao boia meio afundado); em cima da comida: no pe do grao
  float y = c.y + (hInc + (h0 - hInc) * uFlutua) * aSolto + aDesvio.y - meia * mix(0.85, 0.25, aSolto);
  vec4 wp = uPivo * vec4(xz.x + off.x, y, xz.y + off.y, 1.0);
  vSolto = aSolto;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG_SOMBRA = /* glsl */ `
uniform float uForca, uAlfa;
varying vec2 vUv;
varying float vSolto;
void main() {
  float d2 = dot(vUv, vUv);
  float a = exp(-d2 * 3.2) * (1.0 - smoothstep(0.8, 1.0, d2)) * uForca * uAlfa;
  gl_FragColor = vec4(0.035, 0.016, 0.007, a);
}`;

/* ---------- pecas soltas do bacalhau (batata palha, salsinha, lascas, azeitonas): sem caldo, sao comida seca.
   Cada peca tem um deslocamento (x, y, z) e um giro em torno do eixo vertical, guardados numa textura que a CPU atualiza;
   pousam no relevo da comida (mapa de alturas do Blender), pulam quando tocadas e sao empurradas pelo garfo (arrastar) */
const GIRO_GLSL = /* glsl */ `vec3 giroY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }`;
const VERT_PECA_INST = /* glsl */ `
uniform sampler2D tDesl; uniform int uBase, uLarg; uniform vec3 uTip; uniform float uGanho;
varying vec3 vCor, vN, vW;
${GIRO_GLSL}
void main() {
  int id = uBase + gl_InstanceID;
  vec4 d = texelFetch(tDesl, ivec2(id % uLarg, id / uLarg), 0);
  vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 w = vec3(instanceMatrix[3]) + d.xyz + giroY(mat3(instanceMatrix) * position, d.w);
  vN = giroY(normalize(mat3(instanceMatrix) * (normal / (s * s))), d.w);
  vW = w;
#ifdef USE_INSTANCING_COLOR
  vCor = instanceColor;
#else
  vCor = vec3(0.7);
#endif
  vCor = max(vCor * uGanho, uTip * 0.95 * clamp(length(d.xz) / 0.008 + d.y * 60.0, 0.0, 1.0)); // fora do lugar: sem a sombra de quem estava em cima
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const VERT_PECA_UNICA = /* glsl */ `
attribute float aId; attribute vec4 aCor;
uniform sampler2D tDesl, tCentro; uniform int uLarg; uniform float uGanho, uPiso; uniform vec3 uTip;
varying vec3 vCor, vN, vW;
${GIRO_GLSL}
void main() {
  int id = int(aId + 0.5); ivec2 t = ivec2(id % uLarg, id / uLarg);
  vec4 d = texelFetch(tDesl, t, 0);
  vec3 w = texelFetch(tCentro, t, 0).xyz + d.xyz + giroY(position, d.w);
  vN = giroY(normal, d.w); vW = w;
  vec3 c = aCor.rgb; vCor = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)) * uGanho; // cor do Cycles (sRGB) para linear
  // piso de cor: nenhuma parte fica muito mais escura que a cor tipica (faces de baixo/lado assadas quase sem luz);
  // fora do lugar, sobe ate perto da tipica (sem a sombra de quem estava em cima)
  vCor = max(vCor, uTip * mix(uPiso, 0.85, clamp(length(d.xz) / 0.008 + d.y * 60.0, 0.0, 1.0)));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const VERT_SOMBRA_PECA = /* glsl */ `
uniform sampler2D tDesl, tCentro, tAlt; uniform int uLarg; uniform vec4 uAlt;
varying vec2 vUv; varying float vA;
float alt(vec2 xz) { vec2 g = (xz - uAlt.xy) / uAlt.z; return texture2D(tAlt, (g + 0.5) / uAlt.w).r; }
void main() {
  int id = gl_InstanceID; ivec2 t = ivec2(id % uLarg, id / uLarg);
  vec4 c = texelFetch(tCentro, t, 0), d = texelFetch(tDesl, t, 0);
  vec2 xz = c.xz + d.xz;
  float chao = alt(xz) + 0.0006;
  float alto = max(0.0, d.y - (alt(xz) - alt(c.xz)));     // quanto esta no ar (pulando)
  // w = codigo + raio: codigo = forca*20*2 + sempre (1 = sombra sempre; 0 = so quando sai do monte ou pula)
  float cod = floor(c.w), raio = fract(c.w), forca = floor(cod / 2.0) / 20.0, sempre = mod(cod, 2.0);
  float fora = clamp(length(d.xz) / 0.008 + alto * 60.0, 0.0, 1.0);
  float tam = raio * (1.0 + alto * 10.0);
  vA = exp(-alto * 45.0) * forca * max(sempre, fora);
  vUv = position.xz * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x + position.x * 2.0 * tam, chao, xz.y + position.z * 2.0 * tam, 1.0);
}`;
const FRAG_SOMBRA_PECA = /* glsl */ `
uniform float uAlfa; varying vec2 vUv; varying float vA;
void main() { float d2 = dot(vUv, vUv); gl_FragColor = vec4(0.03, 0.014, 0.006, exp(-d2 * 3.0) * (1.0 - smoothstep(0.8, 1.0, d2)) * vA * uAlfa); }`;
// sombra: forca, raio (a partir do tamanho da peca) e se aparece sempre ou so quando a peca sai do monte
const SOLTOS_CFG = {
  // fio fino: sombra fraca e estreita (varias juntas escureciam o creme); fino: afina o molde; leve: fracao desenhada no celular
  palha: { molhado: 0.35, sombra: 0.15, raio: (e) => e[1] * 1.6, sempre: 0, fino: 0.5, leve: 0.5 },
  salsinha_b: { molhado: 0.5, sombra: 0.3, raio: (e) => e[0] * 1.0, sempre: 0, ganho: 1.7 }, // folha fina: a cor amostrada veio da sombra
  // lascas: molhado baixo (o brilho do ambiente ja vem assado); ganho 1,3 medido contra o quadro do Cycles (lascas claras do render)
  // piso: fracao da cor tipica abaixo da qual nenhuma parte da peca escurece (lasca e branca; azeitona e escura de verdade)
  lascas: { molhado: 0.2, sombra: 0.25, raio: (e, w) => w * 0.6, sempre: 1, ganho: 1.3, piso: 0.62 },
  azeitonas: { molhado: 0.25, sombra: 0.6, piso: 0.3, raio: (e, w) => w * 1.15, sempre: 1 },
};

/* ---------- camera de cinema: profundidade de campo (foco seletivo) num passe de tela.
   A cena e desenhada numa textura com profundidade; cada pixel borra conforme a distancia ao plano de foco,
   juntando amostras num disco (angulo de ouro) que cresce para fora. Amostra mais distante que o centro nao borra
   alem do dobro do centro: o fundo desfocado nao invade o prato em foco. */
const VERT_TELA = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG_DOF = (passo, maxR) => /* glsl */ `
uniform sampler2D tCor, tProf;
uniform vec2 uTexel;
uniform float uFoco, uK, uPerto, uLonge, uVinheta, uZona;
varying vec2 vUv;
float distancia(vec2 uv) { float z = texture2D(tProf, uv).r * 2.0 - 1.0; return 2.0 * uPerto * uLonge / (uLonge + uPerto - z * (uLonge - uPerto)); }
// uZona: faixa nitida em volta do foco (o prato inteiro fica nitido; so o que esta fora dele desfoca)
float borrao(float z) { return min(max(abs(z - uFoco) - uZona, 0.0) / z * uK, ${maxR.toFixed(1)}); }
void main() {
  vec3 cor = texture2D(tCor, vUv).rgb;
  float z0 = distancia(vUv), r0 = borrao(z0), tot = 1.0, raio = ${passo.toFixed(2)}, ang = 0.0;
  for (int i = 0; i < 64; i++) {
    if (raio >= ${maxR.toFixed(1)}) break;
    vec2 uv = vUv + vec2(cos(ang), sin(ang)) * uTexel * raio;
    vec3 c = texture2D(tCor, uv).rgb;
    float z = distancia(uv), r = borrao(z);
    if (z > z0) r = min(r, r0 * 2.0);
    float m = smoothstep(raio - 0.5, raio + 0.5, r);
    cor += mix(cor / tot, c, m); tot += 1.0;
    ang += 2.39996; raio += ${passo.toFixed(2)} / raio;
  }
  cor /= tot;
  vec2 q = vUv - 0.5;
  cor *= 1.0 - uVinheta * smoothstep(0.25, 0.85, dot(q, q) * 2.2);  // vinheta leve de lente
  gl_FragColor = vec4(cor, 1.0);
  #include <colorspace_fragment>
}`;

/* ruido suave que se repete sem emenda (128 px), calculado uma vez */
function texturaRuido() {
  const N = 128, d = new Uint8Array(N * N * 4);
  const grade = (P, s) => { const g = new Float32Array(P * P); let x = s; for (let i = 0; i < g.length; i++) { x = (x * 16807) % 2147483647; g[i] = x / 2147483647; } return g; };
  const camadas = [[4, 0.5, 11], [8, 0.27, 23], [16, 0.15, 37], [32, 0.08, 51]].map(([P, a, s]) => ({ P, a, g: grade(P, s) }));
  const lisa = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const { P, a, g } of camadas) {
      const fx = (x / N) * P, fy = (y / N) * P, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = lisa(fx - x0), ty = lisa(fy - y0);
      const q = (i, j) => g[((j % P) * P) + (i % P)];
      v += a * ((q(x0, y0) * (1 - tx) + q(x0 + 1, y0) * tx) * (1 - ty) + (q(x0, y0 + 1) * (1 - tx) + q(x0 + 1, y0 + 1) * tx) * ty);
    }
    const k = (y * N + x) * 4; d[k] = d[k + 1] = d[k + 2] = Math.min(255, v * 255); d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

export async function iniciar({ canvas, carga, escolhidos = () => new Set() }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !CEL, powerPreference: "high-performance" });
  /* comida, mesa e louca vem com a cor final do Cycles (AgX Punchy) ja nas texturas e nao passam pelo tone mapping;
     so o metal, que reflete em tempo real, usa o AgX daqui com a mesma exposicao do render (-0,5) */
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = Math.pow(2, -0.5);
  /* nivel de qualidade: 2 = PC com placa dedicada; 1 = placa integrada ou pouca memoria; 0 = celular ou renderizacao por software.
     ?qualidade=alta|media|baixa forca um nivel. Se mesmo assim o aparelho sofrer, o site desce de nivel sozinho (baixaNivel) */
  const GPU = (() => { try { const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info"); return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ""; } catch { return ""; } })();
  const parQ = new URLSearchParams(location.search).get("qualidade");
  let NIVEL = parQ === "alta" ? 2 : parQ === "media" ? 1 : parQ === "baixa" ? 0
    : CEL || /swiftshader|llvmpipe|software|microsoft basic/i.test(GPU) ? 0
    : /intel|uhd|iris|mali|adreno|powervr|vega [0-9]\b|radeon\(tm\) graphics/i.test(GPU) || (navigator.deviceMemory || 8) <= 4 ? 1 : 2;
  const FRACAO = [0.5, 0.65, 1][NIVEL]; // fracao dos graos de arroz e fios de palha desenhados e simulados
  renderer.setClearColor(0x0a0503, 1);
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0503);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 12);

  /* ambiente para os reflexos do metal: sala escura com pendentes quentes */
  const sala = new THREE.Scene();
  sala.background = new THREE.Color(0.05, 0.035, 0.028);
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.035, 0.018), side: THREE.DoubleSide }));
  chao.rotation.x = -Math.PI / 2; chao.position.y = -0.6; sala.add(chao); // a madeira refletida na parede de cobre
  const painel = (w, h, x, y, z, cor, forca) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(cor).multiplyScalar(forca), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); sala.add(m);
  };
  painel(2.2, 1.2, -0.8, 3, 0.2, 0xffd9b0, 9);
  painel(1.6, 1.0, 1.4, 2.6, -0.8, 0xffcfa0, 7);
  painel(4, 0.7, 0, 1.1, -4, 0xffb98a, 4);
  painel(3, 0.5, -4, 0.8, 1, 0xd8c8b8, 1.6);
  painel(5, 0.45, 0, 0.5, 4.5, 0xffc9a0, 1.4);
  painel(6, 1.4, 4.5, 0.7, 0, 0xffc49a, 1.5);
  painel(7, 1.6, 0, 0.8, 5, 0xffd2ae, 1.8);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(sala, 0.03).texture;
  pm.dispose();

  /* texturas decodificadas fora da linha principal (createImageBitmap): carregar um prato nao trava a rolagem */
  const tl = new THREE.TextureLoader();
  const maxAni = Math.min(CEL ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  const BITMAP = typeof createImageBitmap === "function";
  const tex = async (nome, srgb, inverte = false) => {
    try {
      let t;
      if (BITMAP) {
        const blob = await (await fetch(DIR + nome)).blob();
        const bm = await createImageBitmap(blob, { imageOrientation: inverte ? "flipY" : "from-image", premultiplyAlpha: "none", colorSpaceConversion: "none" });
        t = new THREE.Texture(bm); t.needsUpdate = true; t.flipY = false;
      } else {
        t = await tl.loadAsync(DIR + nome); t.flipY = inverte;
      }
      t.anisotropy = maxAni;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    } catch { return null; }
  };
  /* sobe para a placa uma textura por quadro, em vez de todas de uma vez */
  const sobe = async (ts) => { for (const t of ts) if (t) { renderer.initTexture(t); await new Promise((ok) => { requestAnimationFrame(ok); setTimeout(ok, 60); }); } }; // aba escondida nao para o carregamento

  /* mesa: luz assada na madeira, com brilho leve em tempo real */
  const mesaTex = await tex("mesa-cor" + Q + ".webp", true, true);
  const geo = new THREE.PlaneGeometry(2.3, 1.6); geo.rotateX(-Math.PI / 2);
  const matMesa = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: mesaTex, emissiveIntensity: 1, roughness: 0.5, envMapIntensity: 0.05, toneMapped: false });
  /* a madeira cai no escuro nas pontas: nao se ve onde a mesa termina */
  matMesa.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      vec2 dMesa = (vEmissiveMapUv - 0.5) * vec2(2.3, 1.6);
      totalEmissiveRadiance *= 1.0 - 0.95 * smoothstep(0.5, 1.02, length(dMesa));`);
  };
  scene.add(new THREE.Mesh(geo, matMesa));

  /* cor final do render + um brilho fraco do ambiente (molho e louca molhados) */
  const assado = (lit, nor, op = {}) => new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 1, normalMap: nor || null,
    roughness: op.r ?? 0.5, envMapIntensity: op.e ?? 0.12, toneMapped: false,
  });
  const metal = (cor, r, ao, e) => new THREE.MeshStandardMaterial({ color: cor, metalness: 1, roughness: r, aoMap: ao, aoMapIntensity: 0.7, envMapIntensity: e, side: THREE.DoubleSide });

  /* caldos: estado da fisica e a pelicula de brilho de cada panela */
  const caldos = [];
  const luzU = LUZES.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
  function criaCaldo(prato, grupo) {
    const c = CALDOS[prato];
    let geo, pos = new THREE.Vector3(), quat = new THREE.Quaternion(), esc = new THREE.Vector3(1, 1, 1), base = null;
    if (c.malha) {
      base = grupo.getObjectByName(c.malha);
      if (!base) return null;
      geo = base.geometry; base.updateWorldMatrix(true, false); base.matrixWorld.decompose(pos, quat, esc);
    } else {
      const [x, y, z, raio] = c.disco;
      geo = new THREE.CircleGeometry(raio, 64); geo.rotateX(-Math.PI / 2); pos.copy(B(x, y, z));
    }
    const centro = c.malha ? B(POS[prato][0], POS[prato][1], 0) : B(c.disco[0], c.disco[1], 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT_CALDO, fragmentShader: FRAG_CALDO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        uT: { value: 0 }, uR: { value: c.R }, uBolha: { value: c.bolhas }, uVivo: { value: CALMO ? 0 : c.vivo }, uBrilho: { value: c.brilho }, uSala: { value: c.sala }, uRug: { value: c.rug }, uAlfa: { value: 0 },
        uC: { value: new THREE.Vector2(centro.x, centro.z) }, uInc: { value: new THREE.Vector2() },
        uOnda: { value: Array.from({ length: ONDAS }, () => new THREE.Vector4(0, 0, -9, 0)) }, uLuz: { value: luzU },
        uFerve: { value: 0 }, uGrade: { value: c.grade }, uTB: { value: 0 }, uPivo: { value: new THREE.Matrix4() },
        uSulco: { value: Array.from({ length: SULCOS }, () => new THREE.Vector4(0, 0, -9, 0)) },
      },
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos); m.position.y += 0.0008; m.quaternion.copy(quat); m.scale.copy(esc);
    m.renderOrder = 2;
    scene.add(m);
    /* o molho assado embaixo sobe de um lado e desce do outro com o balanco e com a panela inclinada */
    if (base) {
      const u = mat.uniforms;
      base.material.onBeforeCompile = (s) => {
        s.uniforms.uC = u.uC; s.uniforms.uInc = u.uInc;
        s.vertexShader = "uniform vec2 uC, uInc;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n transformed.y += dot(position.xz - uC, uInc);");
      };
      base.material.customProgramCacheKey = () => "molho-nivel";
      base.material.needsUpdate = true;
    }
    // altura da superficie do molho (m): a malha do molho ja vem em coordenadas do mundo (position do objeto e 0)
    geo.computeBoundingBox();
    const ySup = (c.malha ? geo.boundingBox.max.y : pos.y) + 0.0008;
    const estado = { prato, c, mesh: m, mat, ySup, inc: new THREE.Vector2(), vel: new THREE.Vector2(), incAlvo: new THREE.Vector2(), onda: 0, ultimaOnda: null,
      graos: [], correntes: [], emMovimento: false, ultimoToque: null, fogo: 0, fogoAlvo: 0, tb: 0 };
    caldos.push(estado);
    return estado;
  }
  const relogio0 = performance.now();
  const agoraS = () => (performance.now() - relogio0) / 1000;
  function ondinha(est, x, z, forca = 1) {
    if (CALMO) return;
    const o = est.mat.uniforms.uOnda.value[est.onda];
    o.set(x, z, agoraS(), 0.0008 * forca * (est.c.zeta > 0.3 ? 0.55 : 1)); // creme grosso ondula menos
    est.onda = (est.onda + 1) % ONDAS;
  }
  /* ponto do rastro da colher: um a cada 6 mm de caminho; o shader junta os pontos num sulco que se fecha */
  function sulco(est, x, z, forca = 1) {
    if (CALMO) return;
    const u = est.ultSulco;
    if (u && Math.hypot(x - u.x, z - u.z) < 0.006) return;
    est.mat.uniforms.uSulco.value[est.iSulco = ((est.iSulco ?? -1) + 1) % SULCOS].set(x, z, agoraS(), forca * (est.c.zeta > 0.3 ? 1 : 0.6)); // creme grosso marca mais que oleo
    est.ultSulco = { x, z };
  }
  function empurra(est, dx, dz, forca = 1) {
    if (CALMO) return;
    const n = Math.hypot(dx, dz) || 1, A = 0.011 * forca; // inclinacao inicial (m/m)
    est.vel.x += (dx / n) * A * est.c.w; est.vel.y += (dz / n) * A * est.c.w;
  }
  function fisicaCaldos(dt) {
    let ativo = false;
    const t = agoraS();
    for (const e of caldos) {
      const { w, zeta } = e.c, a = e.incAlvo;
      for (let passos = Math.ceil(dt / (1 / 240)), h = dt / passos, i = 0; i < passos; i++) {
        // mola amortecida em volta do nivel de repouso (com a panela inclinada, o molho procura ficar na horizontal):
        // inc'' = -w^2 (inc - alvo) - 2 zeta w inc'
        e.vel.x += (-w * w * (e.inc.x - a.x) - 2 * zeta * w * e.vel.x) * h; e.vel.y += (-w * w * (e.inc.y - a.y) - 2 * zeta * w * e.vel.y) * h;
        e.inc.x += e.vel.x * h; e.inc.y += e.vel.y * h;
      }
      /* fogo: sobe enquanto alguem segura no molho, baixa devagar ao soltar */
      e.fogo += (e.fogoAlvo - e.fogo) * (1 - Math.exp(-dt * (e.fogoAlvo > e.fogo ? 1.4 : 0.55)));
      if (!e.fogoAlvo && e.fogo < 0.003) e.fogo = 0;
      e.tb += dt * (1 + 2.2 * e.fogo);
      const u = e.mat.uniforms;
      u.uInc.value.copy(e.inc);
      u.uT.value = CALMO ? 0 : t;
      u.uTB.value = CALMO ? 0 : e.tb;
      u.uFerve.value = e.fogo;
      u.uBolha.value = e.c.bolhas + (e.c.ferve - e.c.bolhas) * e.fogo;
      u.uVivo.value = CALMO ? 0 : e.c.vivo * (1 + 1.6 * e.fogo);
      const vivas = u.uOnda.value.some((o) => o.w && t - o.z < 3) || u.uSulco.value.some((s) => s.w && t - s.z < 7);
      if (vivas || e.fogo > 0 || Math.abs(e.inc.x - a.x) + Math.abs(e.inc.y - a.y) + Math.abs(e.vel.x) + Math.abs(e.vel.y) > 1e-5) ativo = true;
    }
    return ativo;
  }

  /* esfera fixa em volta de um prato: os shaders dos graos e das pecas soltas so movem os vertices dentro da panela,
     entao a esfera do prato vale para o recorte da camera (sem ela, tudo era desenhado mesmo com o prato fora da tela) */
  const esferaPrato = (prato) => new THREE.Sphere(B(POS[prato][0], POS[prato][1], 0.04), 0.26);
  const recorta = (obj, prato) => {
    const esf = esferaPrato(prato);
    if (obj.isInstancedMesh) obj.boundingSphere = esf; else obj.geometry.boundingSphere = esf;
    obj.frustumCulled = true;
  };

  /* ---------- graos soltos: carregam junto do prato e vivem na correnteza do caldo */
  async function carregaGraos(prato, est) {
    try {
      const [meta, bin] = await Promise.all([fetch(`${DIR}${prato}-graos.json`).then((q) => q.json()), fetch(`${DIR}${prato}-graos.bin`).then((q) => q.arrayBuffer())]);
      const u = est.mat.uniforms;
      for (const t of meta.tipos) {
        const cfg = GRAOS[t.nome]; if (!cfg) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, t.off, t.nv * 3), 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(bin, t.off + t.nv * 12, t.nv * 3), 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, t.off + t.nv * 24, t.ni), 1));
        const desvio = new THREE.InstancedBufferAttribute(new Float32Array(t.n * 3), 3);
        desvio.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aDesvio", desvio);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT_GRAO, fragmentShader: FRAG_GRAO, toneMapped: false, defines: NIVEL === 0 ? { LEVE: 1 } : {},
          uniforms: { uT: u.uT, uR: u.uR, uBolha: u.uBolha, uVivo: u.uVivo, uC: u.uC, uInc: u.uInc, uOnda: u.uOnda, uLuz: u.uLuz, uAlfa: u.uAlfa,
            uFerve: u.uFerve, uGrade: u.uGrade, uTB: u.uTB, uPivo: u.uPivo, uSulco: u.uSulco,
            uFlutua: { value: cfg.flutua }, uInclina: { value: cfg.inclina }, uMolhado: { value: cfg.molhado } },
        });
        const m = new THREE.InstancedMesh(geo, mat, t.n);
        m.frustumCulled = false; m.renderOrder = 1;
        const mats = new Float32Array(bin, t.moff, t.n * 12), cores = new Uint8Array(bin, t.coff, t.n * 3);
        const M = new THREE.Matrix4(), cor = new THREE.Color(), rest = new Float32Array(t.n * 2), soltoArr = new Float32Array(t.n);
        /* graos escondidos sob os camaroes pegaram a cor da sombra: se aparecerem ao mexer, ficariam pretos.
           Os bem mais escuros que o tipico do seu tipo recebem a cor tipica (com leve variacao) */
        const lum = (i) => 0.2126 * cores[i * 3] + 0.7152 * cores[i * 3 + 1] + 0.0722 * cores[i * 3 + 2];
        const ordem = Array.from({ length: t.n }, (_, i) => i).sort((a, b) => lum(a) - lum(b));
        const tip = ordem[Math.floor(t.n * 0.6)];
        const lumTip = lum(tip);
        for (let i = 0; i < t.n; i++) if (lum(i) < lumTip * 0.62) { const k = 0.82 + ((i * 7919) % 100) / 600; for (let c = 0; c < 3; c++) cores[i * 3 + c] = Math.min(255, cores[tip * 3 + c] * k); }
        for (let i = 0; i < t.n; i++) {
          const k = i * 12;
          M.set(mats[k], mats[k + 3], mats[k + 6], mats[k + 9], mats[k + 1], mats[k + 4], mats[k + 7], mats[k + 10], mats[k + 2], mats[k + 5], mats[k + 8], mats[k + 11], 0, 0, 0, 1);
          m.setMatrixAt(i, M);
          cor.setRGB(cores[i * 3] / 255, cores[i * 3 + 1] / 255, cores[i * 3 + 2] / 255, THREE.SRGBColorSpace);
          m.setColorAt(i, cor);
          rest[i * 2] = mats[k + 9]; rest[i * 2 + 1] = mats[k + 11];
          soltoArr[i] = mats[k + 10] < est.c.nivel ? 1 : 0;
        }
        const soltoAttr = new THREE.InstancedBufferAttribute(soltoArr, 1);
        geo.setAttribute("aSolto", soltoAttr);
        /* sombra de contato: um quadrado por grao, com as mesmas matrizes, desvio e "solto" do grao (dados compartilhados) */
        const geoS = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        geoS.setAttribute("aDesvio", desvio); geoS.setAttribute("aSolto", soltoAttr);
        const sombraG = new THREE.InstancedMesh(geoS, new THREE.ShaderMaterial({
          vertexShader: VERT_SOMBRA, fragmentShader: FRAG_SOMBRA, transparent: true, depthWrite: false, toneMapped: false, defines: NIVEL === 0 ? { LEVE: 1 } : {},
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
          uniforms: { uT: u.uT, uR: u.uR, uBolha: u.uBolha, uVivo: u.uVivo, uC: u.uC, uInc: u.uInc, uOnda: u.uOnda, uAlfa: u.uAlfa,
            uFerve: u.uFerve, uGrade: u.uGrade, uTB: u.uTB, uPivo: u.uPivo, uSulco: u.uSulco, uFlutua: { value: cfg.flutua }, uForca: { value: cfg.sombra ?? 0.45 } },
        }), t.n);
        sombraG.instanceMatrix = m.instanceMatrix;
        sombraG.renderOrder = 1;
        recorta(m, prato); recorta(sombraG, prato);
        await renderer.compileAsync(m, camera, scene);
        scene.add(sombraG);
        scene.add(m);
        /* grao em cima de um camarao solto (nao boia): fica preso a ele e anda/gira junto */
        let dono = null, rel = null;
        if (camaroes && camaroes.est === est) {
          dono = new Int8Array(t.n).fill(-1); rel = new Float32Array(t.n * 2);
          for (let i = 0; i < t.n; i++) {
            if (soltoArr[i]) continue;
            let melhor = -1, dmin = 1e9;
            camaroes.lista.forEach((c, k) => { const d = Math.hypot(rest[i * 2] - c.cx, rest[i * 2 + 1] - c.cz); if (d < c.raio * 1.6 && d < dmin) { dmin = d; melhor = k; } });
            if (melhor >= 0) { dono[i] = melhor; rel[i * 2] = rest[i * 2] - camaroes.lista[melhor].cx; rel[i * 2 + 1] = rest[i * 2 + 1] - camaroes.lista[melhor].cz; }
          }
        }
        // celular (modo leve): so metade dos graos de arroz e desenhada e simulada
        const nVis = t.n > 1000 ? Math.ceil(t.n * FRACAO) : t.n;
        m.count = sombraG.count = nVis;
        // altura de cada grao (para cair de cima do camarao ate o molho) e estado de queda
        const ry = new Float32Array(t.n); for (let i = 0; i < t.n; i++) ry[i] = mats[i * 12 + 10];
        est.graos.push({ nome: t.nome, m, cfg, n: nVis, rest, desvio, solto: soltoArr, soltoAttr, vel: new Float32Array(t.n * 2), dono, rel,
          ry, caiu: new Uint8Array(t.n), vy: new Float32Array(t.n), sombra: sombraG });
      }
      pede();
    } catch (e) { console.warn("graos", prato, e); }
  }
  function correnteza(est, x, z, vx, vz, rad = 0) {
    if (CALMO) return;
    est.correntes.push({ x, z, vx, vz, rad, t0: agoraS(), r: rad ? 0.03 : 0.022 });
    if (est.correntes.length > 28) est.correntes.shift();
    est.ultimaMexida = agoraS();
  }
  // volta ao lugar: depois de VOLTA_PAUSA s sem mexer, cada grao desliza de volta (constante de tempo ~VOLTA_TAU s,
  // um pouco diferente por grao, para o prato se arrumar aos poucos e nao todo de uma vez)
  const VOLTA_PAUSA = 1.4, VOLTA_RAMPA = 1.4, VOLTA_TAU = 1.3;
  /* cada grao: e levado pela correnteza (mexida do cursor + balanco do caldo), com atrito; fica dentro da panela */
  function fisicaGraos(dt) {
    let ativo = false;
    const t = agoraS();
    for (const est of caldos) {
      if (!est.graos.length) continue;
      est.correntes = est.correntes.filter((b) => t - b.t0 < 2.6);
      const C = est.mat.uniforms.uC.value, Rmax = est.c.R * 0.9;
      const sx = est.vel.x * 0.5, sz = est.vel.y * 0.5; // o caldo corre para o lado que sobe
      const forteBalanco = Math.abs(sx) + Math.abs(sz) > 2e-4;
      // fervura: a conveccao gira os graos devagar; panela inclinada: o molho escorre para o lado baixo
      const visc = est.c.visc; // creme grosso: a correnteza morre rapido; oleo fino: corre mais
      const fogo = est.fogo, conv = (fogo * 0.012) / visc;
      const ax = (est.incAlvo.x * 0.3) / visc, az = (est.incAlvo.y * 0.3) / visc, inclinada = Math.abs(ax) + Math.abs(az) > 1e-4;
      if (fogo > 0.05 || inclinada) est.ultimaMexida = t; // enquanto ferve ou inclina, os graos nao voltam ao lugar
      const comCamarao = camaroes && camaroes.est === est && camaroes.mexendo;
      if (!est.correntes.length && !forteBalanco && !est.emMovimento && !est.foraDoLugar && !(fogo > 0.01) && !inclinada && !comCamarao) continue;
      let maxV = 0, maxD = 0;
      const calmo = t - (est.ultimaMexida ?? -99), xs = Math.min(1, Math.max(0, (calmo - VOLTA_PAUSA) / VOLTA_RAMPA));
      const volta = xs * xs * (3 - 2 * xs); // entra suave, sem tranco
      const bs = est.correntes.map((b) => ({ ...b, k: Math.exp(-(t - b.t0) * visc), r2: b.r * b.r }));
      for (const gr of est.graos) {
        const { rest, vel, n, cfg, solto } = gr, d = gr.desvio.array;
        for (let i = 0; i < n; i++) {
          if (!solto[i]) { // em cima da comida: nao boia; se a comida e um camarao solto, anda e gira com ele
            const k = gr.dono ? gr.dono[i] : -1;
            if (k >= 0) {
              const c = camaroes.lista[k], co = Math.cos(c.g), si = Math.sin(c.g), rx = gr.rel[i * 2], rz = gr.rel[i * 2 + 1];
              d[i * 3] = c.cx + c.dx + rx * co + rz * si - rest[i * 2];
              d[i * 3 + 2] = c.cz + c.dz - rx * si + rz * co - rest[i * 2 + 1];
              d[i * 3 + 1] = c.m.position.y;
              /* nao e colado: camarao pulando, girando forte ou arrastado rapido sacode o grao, que pode cair no molho */
              const h = ((i * 2654435761) >>> 0) / 4294967296; // sorte fixa de cada grao
              if (c.sacode > 0 && Math.random() < c.sacode * dt * (0.6 + h * 1.4)) {
                gr.dono[i] = -1; gr.caiu[i] = 1; solto[i] = 1; gr.soltoAttr.needsUpdate = true;
                gr.vy[i] = 0.05 + h * 0.15;
                vel[i * 2] = (c.dxv || 0) * 0.6 + (h - 0.5) * 0.05; vel[i * 2 + 1] = (c.dzv || 0) * 0.6 + (0.5 - h) * 0.05;
              }
            }
            continue;
          }
          if (gr.caiu && gr.caiu[i] === 1) { // caindo de cima do camarao ate a superficie do molho
            const alvoY = est.ySup - 0.0012 - gr.ry[i];
            gr.vy[i] -= 9.81 * dt; d[i * 3 + 1] += gr.vy[i] * dt;
            if (d[i * 3 + 1] <= alvoY) { d[i * 3 + 1] = alvoY; gr.caiu[i] = 2; ondinha(est, rest[i * 2] + d[i * 3], rest[i * 2 + 1] + d[i * 3 + 2], 0.25); }
          }
          const px = rest[i * 2] + d[i * 3], pz = rest[i * 2 + 1] + d[i * 3 + 2];
          const qx = px - C.x, qz = pz - C.y, rr = (qx * qx + qz * qz) / (est.c.R * est.c.R);
          let ux = sx * (1 - rr) + ax, uz = sz * (1 - rr) + az;
          if (conv > 0) { ux += conv * Math.sin(pz * 70 + px * 30 + t * 1.1); uz += conv * Math.cos(px * 70 - pz * 25 - t * 0.9); }
          // correnteza da mexida: media ponderada dos rastros (rastros sobrepostos nao somam velocidade)
          let mx2 = 0, mz2 = 0, sw = 0;
          for (const b of bs) {
            const dx = px - b.x, dz = pz - b.z, d2 = dx * dx + dz * dz;
            if (d2 > b.r2 * 9) continue;
            const w = Math.exp(-d2 / b.r2);
            if (b.rad) { const dd = Math.sqrt(d2) + 1e-4; ux += (dx / dd) * b.rad * w * b.k; uz += (dz / dd) * b.rad * w * b.k; }
            else { mx2 += b.vx * w * b.k; mz2 += b.vz * w * b.k; sw += w; }
          }
          if (sw > 0) { const nrm = Math.max(1, sw); ux += mx2 / nrm; uz += mz2 / nrm; }
          const caido = gr.caiu && gr.caiu[i] > 0; // caiu de cima de um camarao: fica onde caiu (nao volta para cima dele)
          if (volta > 0 && !caido) {
            const h = (i * 0.6180339) % 1, tau = VOLTA_TAU * (0.7 + 0.6 * h);
            ux -= (d[i * 3] / tau) * volta; uz -= (d[i * 3 + 2] / tau) * volta;
          }
          let vx = vel[i * 2], vz = vel[i * 2 + 1];
          vx += ((ux - vx) * cfg.arrasto - cfg.mola * d[i * 3]) * dt;
          vz += ((uz - vz) * cfg.arrasto - cfg.mola * d[i * 3 + 2]) * dt;
          let nx = d[i * 3] + vx * dt, nz = d[i * 3 + 2] + vz * dt;
          const ox = rest[i * 2] + nx - C.x, oz = rest[i * 2 + 1] + nz - C.y, r = Math.hypot(ox, oz);
          if (r > Rmax) {
            // graos que ja nasceram perto da borda podem ficar ate o proprio lugar (senao a volta nunca termina)
            // o que caiu de cima de um camarao perto da borda nao tem lugar proprio la: fica no molho, dentro da panela
            const lim = caido ? Rmax : Math.max(Rmax, Math.hypot(rest[i * 2] - C.x, rest[i * 2 + 1] - C.y));
            if (r > lim) { nx -= (ox / r) * (r - lim); nz -= (oz / r) * (r - lim); const vr = (vx * ox + vz * oz) / r; if (vr > 0) { vx -= (ox / r) * vr; vz -= (oz / r) * vr; } }
          }
          d[i * 3] = nx; d[i * 3 + 2] = nz; vel[i * 2] = vx; vel[i * 2 + 1] = vz;
          const v2 = vx * vx + vz * vz + (caido && gr.caiu[i] === 1 ? 1 : 0); if (v2 > maxV) maxV = v2; // ainda caindo: segue ativo
          if (!caido) { const d2 = nx * nx + nz * nz; if (d2 > maxD) maxD = d2; } // o caido parado nao mantem a fisica acordada
        }
        gr.desvio.needsUpdate = true;
      }
      est.emMovimento = maxV > 1e-8;
      est.foraDoLugar = maxD > 2.5e-7; // algum grao a mais de 0,5 mm do lugar
      ativo = ativo || est.emMovimento || est.foraDoLugar || est.correntes.length > 0;
    }
    return ativo;
  }

  /* ---------- inclinar a panela pela alca: tudo menos o prato de louca gira em volta do apoio do lado oposto a alca.
     O molho procura ficar na horizontal (sobe do lado baixo), os graos escorrem para la, e ao soltar a panela bate na mesa */
  const inclinaveis = {};
  function montaInclina(prato, grupo, est) {
    grupo.updateMatrixWorld(true);
    const piv = new THREE.Group(); piv.matrixAutoUpdate = false; piv.name = prato + "_pivo";
    const filhos = grupo.children.filter((o) => o.isMesh && o.material.userData.parte !== "louca");
    grupo.add(piv);
    for (const o of filhos) piv.attach(o);
    est.mat.uniforms.uPivo.value = piv.matrixWorld; // pelicula e graos usam a mesma matriz (atualizada a cada desenho)
    const cobre = filhos.find((o) => o.material.userData.parte === "cobre");
    inclinaveis[prato] = { prato, cfg: INCLINA[prato], est, piv, cobre, ang: 0, vel: 0, alvo: 0, segura: false, auto: 0, bateu: 0, dir: new THREE.Vector2(1, 0) };
  }
  const eixo = new THREE.Vector3(), mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mC = new THREE.Matrix4();
  function fisicaInclina(dt) {
    let ativo = false;
    for (const p of Object.values(inclinaveis)) {
      if (p.auto > 0) p.auto -= dt;                       // toque na alca: levanta, segura um instante e solta
      p.alvo = p.auto > 0 ? p.cfg.max * 0.85 : p.segura ? p.alvo : 0;
      if (p.ang === 0 && p.vel === 0 && p.alvo === 0) continue;
      ativo = true;
      const k = 140, c = 2 * Math.sqrt(k) * (p.alvo > 0 ? 0.95 : 0.55); // levantando: firme; caindo: solta, quica de leve
      for (let passos = Math.ceil(dt / (1 / 240)), h = dt / passos, i = 0; i < passos; i++) {
        p.vel += (k * (p.alvo - p.ang) - c * p.vel) * h; p.ang += p.vel * h;
        if (p.ang < 0) {                                  // a panela bate na mesa
          const t = agoraS();
          if (p.vel < -0.2 && t - p.bateu > 0.15) {
            const f = Math.min(1, -p.vel / 1.4); p.bateu = t;
            som.pousa(f);
            { const Cc = p.est.mat.uniforms.uC.value; respinga(p.est, Cc.x - p.dir.x * p.cfg.borda * 0.6, p.est.ySup, Cc.y - p.dir.y * p.cfg.borda * 0.6, Math.round(4 + 8 * f), 0.5 + 0.6 * f); }
            empurra(p.est, -p.dir.x, -p.dir.y, 0.9 * f);  // o molho continua indo para o lado baixo e volta balancando
          }
          p.ang = 0; p.vel = p.vel < -0.05 ? -p.vel * 0.2 : 0;
        }
        if (p.ang > p.cfg.max) { p.ang = p.cfg.max; if (p.vel > 0) p.vel = 0; }
      }
      if (p.alvo === 0 && p.ang < 1e-4 && Math.abs(p.vel) < 2e-3) { p.ang = 0; p.vel = 0; }
      const C = p.est.mat.uniforms.uC.value, d = p.dir;
      const apx = C.x - d.x * p.cfg.borda, apz = C.y - d.y * p.cfg.borda; // apoio: a borda do lado oposto a alca
      eixo.set(-d.y, 0, d.x);                                               // girar neste eixo levanta o lado da alca
      p.piv.matrix.copy(mA.makeTranslation(apx, 0, apz).multiply(mB.makeRotationAxis(eixo, p.ang)).multiply(mC.makeTranslation(-apx, 0, -apz)));
      p.piv.matrixWorldNeedsUpdate = true;
      const tg = -Math.tan(p.ang) * p.cfg.fluidez;
      p.est.incAlvo.set(d.x * tg, d.y * tg);
    }
    return ativo;
  }

  /* ---------- bombinha solta: a da frente sai do prato, vai ate o potinho, mergulha a ponta no molho claro, pinga e volta.
     Toque/clique: faz o caminho sozinha. Mouse: da para arrastar; soltar em cima do potinho mergulha, soltar fora devolve.
     Depois do mergulho a ponta fica com o molho (mais clara e brilhante, com a linha do molho irregular) */
  /* textura da sombra de contato das pecas soltas: uma so para todas (forca de cada uma vai na opacidade) */
  let _texMancha = null;
  function texMancha() {
    if (_texMancha) return _texMancha;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(16,7,2,1)"); gr.addColorStop(0.58, "rgba(16,7,2,.48)"); gr.addColorStop(1, "rgba(16,7,2,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return (_texMancha = new THREE.CanvasTexture(c));
  }
  const POTE = { x: -0.04, z: 0.24, y: 0.0326 }; // centro do molho do potinho (three) e a altura da superficie
  let bomba = null;          // a bombinha da interacao atual (a que foi tocada ou esta sendo arrastada)
  const bombas = [];         // todas as bombinhas soltas
  function prepBolinha(mat, nivel = 0.025, cor = [0.62, 0.47, 0.27]) {
    // cada peca tem o seu molho (uMolho 0 a 1); o molho gruda um pouco acima de onde entrou (uNivelM)
    const U = mat.userData.U = { uMolho: { value: 0 }, uNivelM: { value: nivel }, uCorM: { value: new THREE.Vector3(...cor) } };
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U, { uLuz: { value: luzU } });
      s.vertexShader = "varying float vAltM; varying vec3 vWpM;\n" + s.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float angM = atan(position.z, position.x);
        vAltM = position.y - 0.0028 * sin(angM * 5.0) - 0.0016 * sin(angM * 11.0 + 1.3);
        vWpM = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      s.fragmentShader = "uniform float uMolho, uNivelM; uniform vec3 uCorM; uniform vec4 uLuz[4]; varying float vAltM; varying vec3 vWpM;\n" +
        s.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float km = uMolho * (1.0 - smoothstep(uNivelM - 0.0025, uNivelM + 0.0012, vAltM));
        vec3 corM = uCorM;
        // molho fino por cima da farinha: a textura dos farelos continua aparecendo por baixo
        totalEmissiveRadiance = mix(totalEmissiveRadiance, corM * (0.45 + 1.3 * totalEmissiveRadiance.g), km * 0.62);
        vec3 NwM = inverseTransformDirection(normal, viewMatrix), VwM = normalize(cameraPosition - vWpM);
        float spM = 0.0;
        for (int i = 0; i < 4; i++) { vec3 Hm = normalize(normalize(uLuz[i].xyz - vWpM) + VwM); spM += uLuz[i].w * pow(max(dot(NwM, Hm), 0.0), 60.0); }
        float FM = 0.04 + 0.96 * pow(1.0 - max(dot(NwM, VwM), 0.0), 5.0);
        totalEmissiveRadiance += vec3(1.0, 0.88, 0.7) * spM * (0.3 + FM) * km * 0.55;`);
    };
    mat.customProgramCacheKey = () => "bolinha-molho";
  }
  function montaBombinha(grupo) {
    const ms = [];
    grupo.traverse((o) => { if (o.isMesh && /^bolinha\d*$/.test(o.material.userData.parte || "")) ms.push(o); });
    for (const m of ms) montaUmaBombinha(grupo, m);
  }
  function montaUmaBombinha(grupo, m) {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    m.geometry.translate(-cx, -bb.min.y, -cz); // origem no ponto de baixo: a altura do molho na bolinha e so position.y
    m.position.set(cx, bb.min.y, cz);
    const casa = m.position.clone();
    /* sombra de contato (o assado do prato ja nao tem a bolinha): mancha escura que some quando ela sobe */
    const sombraB = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: texMancha(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    sombraB.position.set(casa.x, casa.y + 0.0006, casa.z); sombraB.renderOrder = 1;
    grupo.add(sombraB);
    const b = { m, casa, sombraB, seq: null, pega: false, gotas: [], gira: new THREE.Vector3(), velV: new THREE.Vector3(), antes: casa.clone() };
    bombas.push(b);
    // a da frente (mais perto da camera da parada) continua sendo a "padrao" dos testes
    if (!bomba || m.position.z > bomba.m.position.z) bomba = b;
  }
  /* o potinho e um so: enquanto uma bombinha esta indo, mergulhando ou pingando, outra nao comeca */
  const poteLivre = (b) => !bombas.some((o) => o !== b && o.seq && o.seq.mergulho && o.seq.i < o.seq.passos.length - 2);
  const est4 = () => caldos.find((c) => c.prato === "bombinha");
  const pv = (x, y, z) => new THREE.Vector3(x, y, z);
  /* caminho: lista de [duracao, posicao final, evento ao chegar]; entre pontos, curva suave (comeca e termina devagar) */
  function mergulho(de, b = bomba) {
    if (!b) return false;
    if (!poteLivre(b)) { if (de !== "casa") devolve(b); return false; } // potinho ocupado: volta para o lugar
    const fundo = POTE.y - 0.02, topo = POTE.y + 0.05, alto = b.casa.y + 0.045;
    const passos = [];
    if (de === "casa") passos.push([0.35, pv(b.casa.x, alto, b.casa.z)]);
    passos.push([de === "casa" ? 0.65 : 0.3, pv(POTE.x, topo, POTE.z)]);
    passos.push([0.5, pv(POTE.x, fundo, POTE.z), "entra"]);
    passos.push([0.55, pv(POTE.x, fundo, POTE.z), "gira"]);
    passos.push([0.5, pv(POTE.x, POTE.y + 0.032, POTE.z), "sai"]);
    passos.push([1.2, pv(POTE.x, POTE.y + 0.034, POTE.z), "pinga"]);
    passos.push([0.75, pv(b.casa.x, alto, b.casa.z)]);
    passos.push([0.32, b.casa.clone(), "pousa"]);
    b.seq = { passos, i: 0, t: 0, de: b.m.position.clone(), entrou: false, saiu: false, pingos: 0, mergulho: true };
    return true;
  }
  function devolve(b = bomba) {
    if (!b) return;
    const alto = b.casa.y + 0.045;
    b.seq = { passos: [[0.5, pv(b.casa.x, alto, b.casa.z)], [0.32, b.casa.clone(), "pousa"]], i: 0, t: 0, de: b.m.position.clone(), entrou: true, saiu: true, pingos: 0 };
  }
  /* ---------- respingos: gotinhas de molho que saltam (camarao caindo, panela batendo, bombinha entrando, clique no molho)
     e caem de volta fazendo ondinha. Cor do molho de cada prato; no maximo 60 no ar */
  const CORES_MOLHO = { heroi: [0.62, 0.48, 0.22], alho: [0.6, 0.33, 0.07], bombinha: [0.72, 0.58, 0.36] };
  const matsGota = {}, geoRespingo = new THREE.SphereGeometry(1, 8, 6), respingos = [];
  function respinga(est, x, y, z, n, forca = 1) {
    if (CALMO || !est) return;
    const p = est.prato;
    matsGota[p] ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(...(CORES_MOLHO[p] || [0.6, 0.45, 0.2])), toneMapped: false });
    for (let i = 0; i < n && respingos.length < 60; i++) {
      const g = new THREE.Mesh(geoRespingo, matsGota[p]), a = Math.random() * 6.283, vy = (0.35 + Math.random() * 0.5) * forca;
      let h = (0.06 + Math.random() * 0.22) * forca;
      g.scale.setScalar(0.0008 + Math.random() * 0.0013);
      g.position.set(x + Math.cos(a) * 0.004, y + 0.002, z + Math.sin(a) * 0.004);
      /* a gota cai dentro do molho: se o arco passaria da borda, encurta (nunca atravessa a parede nem cai na mesa) */
      const Cm = est.mat?.uniforms?.uC?.value;
      if (Cm) {
        const tv = (vy + Math.sqrt(vy * vy + 0.04)) / 9.81, Rl = est.c.R * 0.88;
        const dx = Math.cos(a) * h * tv, dz = Math.sin(a) * h * tv, qx = g.position.x - Cm.x, qz = g.position.z - Cm.y;
        const A2 = dx * dx + dz * dz, B = 2 * (qx * dx + qz * dz), C2 = qx * qx + qz * qz - Rl * Rl;
        let s = 1;
        if (C2 >= 0) s = B < 0 ? Math.min(1, -B / A2 * 0.5) : 0;            // ja na borda: so vai para dentro
        else if (A2 > 1e-12) s = Math.min(1, (-B + Math.sqrt(B * B - 4 * A2 * C2)) / (2 * A2));
        h *= s;
      }
      g.userData = { vx: Math.cos(a) * h, vz: Math.sin(a) * h, vy, chao: y, est };
      scene.add(g); respingos.push(g);
    }
  }
  function fisicaRespingos(dt) {
    for (let i = respingos.length - 1; i >= 0; i--) {
      const g = respingos[i], u = g.userData;
      u.vy -= 9.81 * dt;
      g.position.x += u.vx * dt; g.position.y += u.vy * dt; g.position.z += u.vz * dt;
      if (g.position.y < u.chao && u.vy < 0) { ondinha(u.est, g.position.x, g.position.z, 0.3); scene.remove(g); respingos.splice(i, 1); }
    }
    return respingos.length > 0;
  }

  const geoGota = new THREE.SphereGeometry(0.0019, 10, 8);
  const matGota = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.55, 0.33), toneMapped: false });
  function fisicaBomba(dt) {
    let ativo = false;
    for (const b of bombas) ativo = fisicaUmaBomba(b, dt) || ativo;
    return ativo;
  }
  function fisicaUmaBomba(b, dt) {
    const m = b.m, e = est4();
    let ativo = b.pega || !!b.seq || b.gotas.length > 0;
    b.antes.copy(m.position);
    if (b.seq) {
      const s = b.seq, [dur, alvo, ev] = s.passos[s.i];
      s.t += dt;
      const k = liso(Math.min(1, s.t / dur));
      m.position.lerpVectors(s.de, alvo, k);
      // dentro do molho: gira um pouco (mexe no molho) e solta correnteza que leva a cebolinha
      if (ev === "gira" && e) {
        const a = s.t * 9, r = 0.004 * Math.sin(Math.PI * Math.min(1, s.t / dur));
        m.position.x += Math.cos(a) * r; m.position.z += Math.sin(a) * r;
        correnteza(e, POTE.x + Math.cos(a) * 0.012, POTE.z + Math.sin(a) * 0.012, -Math.sin(a) * 0.05, Math.cos(a) * 0.05);
      }
      const baixo = m.position.y;
      if (!s.entrou && baixo < POTE.y && e) {             // a ponta toca o molho
        s.entrou = true;
        ondinha(e, POTE.x + 0.006, POTE.z, 1.6); ondinha(e, POTE.x - 0.008, POTE.z + 0.004, 1.0);
        respinga(e, POTE.x, POTE.y, POTE.z, 6, 0.55);
        empurra(e, Math.random() - 0.5, Math.random() - 0.5, 0.9);
        correnteza(e, POTE.x, POTE.z, 0, 0, 0.1);           // o molho deslocado afasta a cebolinha
        som.mergulha();
      }
      if (s.entrou && !s.saiu && ev === "sai" && baixo > POTE.y && e) { // saiu do molho: a ponta vem coberta
        s.saiu = true; m.material.userData.U.uMolho.value = 1;
        ondinha(e, POTE.x, POTE.z, 0.9);
      }
      if (ev === "pinga" && s.pingos < 3 && s.t > [0.12, 0.5, 0.95][s.pingos]) { // gotas caindo da ponta
        s.pingos++;
        const g = new THREE.Mesh(geoGota, matGota), a = Math.random() * 6.28, r = 0.003 + Math.random() * 0.004;
        g.position.set(m.position.x + Math.cos(a) * r, m.position.y - 0.001, m.position.z + Math.sin(a) * r);
        g.userData.v = 0; scene.add(g); b.gotas.push(g);
      }
      if (s.t >= dur) {
        if (ev === "pousa") { som.tok(); }
        s.i++; s.t = 0; s.de = m.position.clone();
        if (s.i >= s.passos.length) b.seq = null;
      }
    }
    for (let i = b.gotas.length - 1; i >= 0; i--) {
      const g = b.gotas[i];
      g.userData.v += 9.81 * dt; g.position.y -= g.userData.v * dt;
      g.scale.set(1, 1 + Math.min(1.4, g.userData.v * 1.6), 1); // esticada pela queda
      if (g.position.y <= POTE.y) {
        if (e) ondinha(e, g.position.x, g.position.z, 0.45);
        som.pinga();
        scene.remove(g); b.gotas.splice(i, 1);
      }
    }
    // inclina na direcao do movimento (o peso fica para tras) e volta reta quando para
    const v = b.velV.subVectors(m.position, b.antes).divideScalar(Math.max(dt, 1e-3));
    const alvoX = Math.max(-0.3, Math.min(0.3, v.z * 2.2)), alvoZ = Math.max(-0.3, Math.min(0.3, -v.x * 2.2));
    const kk = 1 - Math.exp(-dt * 8);
    m.rotation.x += (alvoX - m.rotation.x) * kk; m.rotation.z += (alvoZ - m.rotation.z) * kk;
    if (Math.abs(m.rotation.x) + Math.abs(m.rotation.z) > 1e-4) ativo = true;
    const sobe = m.position.y - b.casa.y;
    b.sombraB.material.opacity = 0.75 * Math.max(0, 1 - sobe / 0.05) * (Math.hypot(m.position.x - b.casa.x, m.position.z - b.casa.z) < 0.03 ? 1 : 0.4);
    b.sombraB.position.set(m.position.x, b.casa.y + 0.0006, m.position.z);
    b.sombraB.scale.setScalar(1 + sobe * 6);
    return ativo;
  }
  /* bombinha embaixo do cursor (ou null) */
  function bolinhaSob(x, y) {
    if (!bombas.length || naParada() !== 4) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const hit = raio3d.intersectObjects(bombas.map((b) => b.m), false)[0];
    return hit ? bombas.find((b) => b.m === hit.object) : null;
  }
  const planoPega = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pontoPega = new THREE.Vector3();
  function arrastaBolinha(x, y) {
    const alto = bomba.casa.y + 0.045;
    planoPega.constant = -alto;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    if (raio3d.ray.intersectPlane(planoPega, pontoPega)) {
      bomba.alvoPega = pontoPega.clone();
      if (bomba.offPega) { bomba.alvoPega.x += bomba.offPega.x; bomba.alvoPega.z += bomba.offPega.z; } // pega do ponto onde clicou, sem pulo
    }
  }
  function seguePega(dt) {
    if (!bomba || !bomba.pega || !bomba.alvoPega) return;
    const m = bomba.m, a = bomba.alvoPega, k = 1 - Math.exp(-dt * 14);
    // fica dentro do prato (nao sai voando pela mesa)
    const dx = a.x - POTE.x, dz = a.z - POTE.z, r = Math.hypot(dx, dz), lim = 0.13;
    if (r > lim) { a.x = POTE.x + (dx / r) * lim; a.z = POTE.z + (dz / r) * lim; }
    m.position.x += (a.x - m.position.x) * k; m.position.z += (a.z - m.position.z) * k; m.position.y += (a.y - m.position.y) * k;
  }

  /* ---------- camaroes soltos do camarao ao alho: cada um boia no molho (sobe e desce com o balanco, inclina com a superficie),
     e levado pela mexida, pelo balanco e pela panela inclinada, nao entra no outro, e da para pegar com o mouse e arrastar
     pelo molho; um toque faz pular e cair com respingo. O alho e a salsinha que estao em cima de um camarao andam com ele */
  /* parede de dentro da panela, medida no proprio aco: raio minimo por faixa de 2 mm de altura (coordenadas da panela).
     A parede abre para cima, entao o limite depende da altura de cada ponto da peca */
  function paredeDe(piv, C) {
    let aco = null;
    piv.traverse((o) => { if (o.isMesh && o.material.userData.parte === "aco") aco = o; });
    if (!aco) return null;
    const p = aco.geometry.attributes.position, o = aco.position, N = 40, tab = new Float32Array(N).fill(9);
    let rmax = 0;
    for (let i = 0; i < p.count; i++) rmax = Math.max(rmax, Math.hypot(p.getX(i) + o.x - C.x, p.getZ(i) + o.z - C.y));
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i) + o.x - C.x, p.getZ(i) + o.z - C.y), k = Math.floor((p.getY(i) + o.y) / 0.002);
      if (r > rmax * 0.5 && k >= 0 && k < N) tab[k] = Math.min(tab[k], r);
    }
    // faixas sem vertice: interpola entre as vizinhas; abaixo do fundo e acima da borda, repete a ultima
    const ok = []; for (let k = 0; k < N; k++) if (tab[k] < 9) ok.push(k);
    if (!ok.length) return null;
    for (let k = 0; k < N; k++) {
      if (tab[k] < 9) continue;
      const a = ok.filter((j) => j < k).pop(), b = ok.find((j) => j > k);
      tab[k] = a === undefined ? tab[b] : b === undefined ? tab[a] : tab[a] + (tab[b] - tab[a]) * (k - a) / (b - a);
    }
    return (y) => { const f = Math.max(0, Math.min(N - 1.001, y / 0.002 - 0.5)), k = Math.floor(f); return tab[k] + (tab[k + 1] - tab[k]) * (f - k); };
  }
  /* pontos de suporte da peca em planta (32 direcoes) em faixas de altura. Com a parede (rIn), o ponto de cada direcao e o
     que mais passaria dela: um ponto mais baixo encosta antes, porque ali a parede e mais fechada */
  function suporteXZ(geo, rIn = null, n = 32, faixas = 3) {
    const p = geo.attributes.position, ys = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) ys[i] = p.getY(i);
    const ord = Float32Array.from(ys).sort(), cortes = [];
    for (let f = 1; f < faixas; f++) cortes.push(ord[Math.floor((p.count * f) / faixas)]);
    const faixaDe = (y) => { let f = 0; while (f < cortes.length && y > cortes[f]) f++; return f; };
    const fx = new Uint8Array(p.count); for (let i = 0; i < p.count; i++) fx[i] = faixaDe(ys[i]);
    const pts = [];
    for (let f = 0; f < faixas; f++) for (let a = 0; a < n; a++) {
      const dx = Math.cos((a / n) * 6.2832), dz = Math.sin((a / n) * 6.2832);
      let best = -9, bi = -1;
      for (let i = 0; i < p.count; i++) { if (fx[i] !== f) continue; const d = p.getX(i) * dx + p.getZ(i) * dz - (rIn ? rIn(ys[i]) : 0); if (d > best) { best = d; bi = i; } }
      if (bi >= 0) pts.push(p.getX(bi), ys[bi], p.getZ(bi));
    }
    return Float32Array.from(pts);
  }
  /* quanto a peca passa da parede (pontos girados como a malha, ordem YXZ: inclinacao rx/rz e giro g; no lugar px,pz,
     subida py); dirP = sentido do pior ponto */
  const dirP = new THREE.Vector2();
  function passaParede(pts, px, py, pz, g, C, rIn, folga, rx = 0, rz = 0) {
    const co = Math.cos(g), si = Math.sin(g), cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
    let pior = 0;
    for (let k = 0; k < pts.length; k += 3) {
      const x1 = pts[k] * cz - pts[k + 1] * sz, y1 = pts[k] * sz + pts[k + 1] * cz;
      const y2 = y1 * cx - pts[k + 2] * sx, z2 = y1 * sx + pts[k + 2] * cx;
      const x = px + x1 * co + z2 * si - C.x, z = pz - x1 * si + z2 * co - C.y, r = Math.hypot(x, z);
      const ex = r - (rIn(y2 + py) - folga);
      if (ex > pior) { pior = ex; dirP.set(x / r, z / r); }
    }
    return pior;
  }

  let camaroes = null;
  function montaCamaroes(prato, grupo, est) {
    const piv = inclinaveis[prato]?.piv || grupo;
    const ms = [];
    piv.traverse((o) => { if (o.isMesh && /^cam\d+$/.test(o.material.userData.parte || "")) ms.push(o); });
    if (!ms.length) return;
    const parede = paredeDe(piv, est.mat.uniforms.uC.value);
    const lista = ms.map((m) => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      m.geometry.translate(-cx, 0, -cz); m.position.set(cx, 0, cz); m.rotation.order = "YXZ";
      const raio = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
      const sombra = new THREE.Mesh(new THREE.PlaneGeometry(raio * 2.3, raio * 2.3).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: texMancha(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, opacity: 0 }));
      sombra.position.set(cx, bb.min.y + 0.002, cz); sombra.renderOrder = 1;
      piv.add(sombra);
      return { m, sombra, cx, cz, raio: raio * 0.62, yChao: bb.min.y + 0.002, dx: 0, dz: 0, dy: 0, g: 0, vx: 0, vz: 0, vy: 0, vg: 0, pega: false, sup: suporteXZ(m.geometry, parede) };
    });
    camaroes = { prato, est, piv, lista, mexendo: true, alvo: null, ultSom: 0, parede };
  }
  const inv2 = new THREE.Matrix4(), raioLocal = new THREE.Ray(), planoMolho = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pLocal = new THREE.Vector3();
  function camaraoSob(x, y) {
    if (!camaroes || naParada() !== PRATOS.indexOf(camaroes.prato) + 1) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const hit = raio3d.intersectObjects(camaroes.lista.map((c) => c.m), false)[0];
    return hit ? camaroes.lista.find((c) => c.m === hit.object) : null;
  }
  /* ponto do cursor no molho, em coordenadas da panela (sem a inclinacao da alca) */
  function molhoLocal(x, y, altura, piv = camaroes.piv) {
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    raioLocal.copy(raio3d.ray).applyMatrix4(inv2.copy(piv.matrixWorld).invert());
    planoMolho.constant = -altura;
    return raioLocal.intersectPlane(planoMolho, pLocal);
  }
  function pulaCamarao(c) {
    if (CALMO) return;
    c.sacode = 6; // o pulo sacode o que esta em cima: boa parte cai no molho
    c.vy = 0.2 + Math.random() * 0.08; c.vg += (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4);
    c.vx += (Math.random() - 0.5) * 0.06; c.vz += (Math.random() - 0.5) * 0.06;
    camaroes.mexendo = true; camaroes.est.ultimaMexida = agoraS();
    som.croc(0.35);
  }
  function fisicaCamaroes(dt) {
    const K = camaroes; if (!K) return false;
    const e = K.est, C = e.mat.uniforms.uC.value, t = agoraS();
    const ativo = K.mexendo || K.lista.some((c) => c.pega) || Math.abs(e.vel.x) + Math.abs(e.vel.y) > 2e-4 || Math.abs(e.incAlvo.x) + Math.abs(e.incAlvo.y) > 1e-4 || e.correntes.length > 0 || e.fogo > 0.01;
    if (!ativo) { for (const c of K.lista) c.sacode = 0; return false; } // parado: nada cai sozinho
    const calmo = t - (e.ultimaMexida ?? -99), xs = Math.min(1, Math.max(0, (calmo - VOLTA_PAUSA - 1) / VOLTA_RAMPA)), volta = xs * xs * (3 - 2 * xs);
    const visc = e.c.visc, sx = e.vel.x * 0.5, sz = e.vel.y * 0.5, ax = (e.incAlvo.x * 0.25) / visc, az = (e.incAlvo.y * 0.25) / visc;
    const bs = e.correntes.map((b) => ({ ...b, k: Math.exp(-(t - b.t0) * visc) }));
    let maxV = 0, maxD = 0;
    for (const c of K.lista) {
      let px = c.cx + c.dx, pz = c.cz + c.dz;
      if (c.pega && K.alvo) {   // arrastado pelo mouse: segue o cursor com mola, levantado um pouco
        const kk = 1 - Math.exp(-dt * 12);
        const nvx = (K.alvo.x - px) * kk / dt, nvz = (K.alvo.z - pz) * kk / dt;
        c.vx = nvx; c.vz = nvz; c.vy = 0; c.dy += (0.012 - c.dy) * kk;
        if (Math.hypot(nvx, nvz) > 0.02 && t - (c.ultOnda || 0) > 0.06) { c.ultOnda = t; ondinha(e, px, pz, 0.9); correnteza(e, px, pz, nvx * 0.6, nvz * 0.6); }
        if (Math.hypot(nvx, nvz) > 0.01) sulco(e, px, pz, 1.3); // o camarao arrastado abre um rastro no molho
      } else {
        const qx = px - C.x, qz = pz - C.y, rr = (qx * qx + qz * qz) / (e.c.R * e.c.R);
        let ux = sx * (1 - rr) + ax, uz = sz * (1 - rr) + az, mx2 = 0, mz2 = 0, sw = 0;
        for (const b of bs) {
          const dx = px - b.x, dz = pz - b.z, d2 = dx * dx + dz * dz, r2 = (b.r + c.raio) ** 2;
          if (d2 > r2 * 2) continue;
          const w = Math.exp(-d2 / r2);
          if (b.rad) { const dd = Math.sqrt(d2) + 1e-4; ux += (dx / dd) * b.rad * w * b.k * 0.6; uz += (dz / dd) * b.rad * w * b.k * 0.6; }
          else { mx2 += b.vx * w * b.k; mz2 += b.vz * w * b.k; sw += w; c.vg += (dx * b.vz - dz * b.vx) * w * b.k * 40 * dt; }
        }
        if (sw > 0) { ux += mx2 / Math.max(1, sw) * 0.7; uz += mz2 / Math.max(1, sw) * 0.7; }
        if (e.fogo > 0.01) { ux += e.fogo * 0.004 * Math.sin(t * 0.9 + c.cx * 40); uz += e.fogo * 0.004 * Math.cos(t * 0.8 + c.cz * 40); }
        if (volta > 0) { ux -= c.dx / 1.6 * volta; uz -= c.dz / 1.6 * volta; c.g -= c.g * Math.min(1, dt * 1.5 * volta); }
        const no = c.dy <= 1e-4 && c.vy <= 0;
        const arr = no ? 2.2 : 0.3;                       // no molho: arrasto do molho; no ar: quase nada
        c.vx += (ux - c.vx) * arr * dt; c.vz += (uz - c.vz) * arr * dt;
        if (!no) c.vy -= 9.81 * dt;
        c.dy += c.vy * dt;
        if (c.dy < 0) {                                   // cai de volta no molho: respingo
          if (c.vy < -0.3) { ondinha(e, px, pz, 1.6); ondinha(e, px + 0.012, pz - 0.008, 1.0); empurra(e, Math.random() - 0.5, Math.random() - 0.5, 0.5); correnteza(e, px, pz, 0, 0, 0.08); som.mergulha(); respinga(e, px, e.ySup, pz, 7, Math.min(1.2, -c.vy * 1.4)); }
          c.dy = 0; c.vy = 0;
        }
        c.vg *= Math.exp(-dt * (no ? 3 : 0.5));
      }
      c.dx += c.vx * dt; c.dz += c.vz * dt; c.g += c.vg * dt;
      // quanto o camarao sacode o que esta em cima: arrasto rapido, giro forte (o pulo ja liga no toque); vai acalmando
      const sp = Math.hypot(c.vx, c.vz);
      c.sacode = Math.max((c.sacode || 0) * Math.exp(-dt * 4), sp > 0.06 ? (sp - 0.06) * 25 : 0, Math.abs(c.vg) > 5 ? 0.8 : 0);
      if (c.sacode < 0.02) c.sacode = 0;
      c.dxv = c.vx; c.dzv = c.vz;
    }
    /* um camarao nao entra no outro; todos ficam dentro da panela */
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < K.lista.length; i++) for (let j = i + 1; j < K.lista.length; j++) {
        const a = K.lista[i], b = K.lista[j];
        const ax2 = a.cx + a.dx, az2 = a.cz + a.dz, bx2 = b.cx + b.dx, bz2 = b.cz + b.dz;
        const ddx = bx2 - ax2, ddz = bz2 - az2, d = Math.hypot(ddx, ddz), min = (a.raio + b.raio) * 0.8;
        // so empurra quem saiu do lugar (no repouso eles ja se encostam, como no prato montado)
        const repouso = Math.hypot(b.cx - a.cx, b.cz - a.cz), lim2 = Math.min(min, repouso);
        if (d < lim2 && d > 1e-5) {
          const p = (lim2 - d) / d * 0.5, wa = a.pega ? 0 : b.pega ? 1 : 0.5, wb = 1 - wa;
          a.dx -= ddx * p * wa * 2; a.dz -= ddz * p * wa * 2; b.dx += ddx * p * wb * 2; b.dz += ddz * p * wb * 2;
        }
      }
      for (const c of K.lista) {
        if (K.parede) { // o formato do camarao (rabo e cabeca, girado) nao passa da parede da panela
          const px = c.cx + c.dx, pz = c.cz + c.dz, hInc = (px - C.x) * e.inc.x + (pz - C.y) * e.inc.y;
          const rx = -e.inc.y * 0.8 + Math.max(-0.18, Math.min(0.18, c.vz * 0.6)), rz = e.inc.x * 0.8 - Math.max(-0.18, Math.min(0.18, c.vx * 0.6));
          const ex = passaParede(c.sup, px, c.dy + hInc, pz, c.g, C, K.parede, 0.003, rx, rz);
          if (ex > 0) {
            c.dx -= dirP.x * ex; c.dz -= dirP.y * ex;
            const vr = c.vx * dirP.x + c.vz * dirP.y; if (vr > 0) { c.vx -= dirP.x * vr; c.vz -= dirP.y * vr; }
            c.vg *= 0.6;
          }
          continue;
        }
        const ox = c.cx + c.dx - C.x, oz = c.cz + c.dz - C.y, r = Math.hypot(ox, oz);
        const lim = Math.max(e.c.R - c.raio * 0.55, Math.hypot(c.cx - C.x, c.cz - C.y));
        if (r > lim) { c.dx -= (ox / r) * (r - lim); c.dz -= (oz / r) * (r - lim); const vr = (c.vx * ox + c.vz * oz) / r; if (vr > 0) { c.vx -= (ox / r) * vr; c.vz -= (oz / r) * vr; } }
      }
    }
    for (const c of K.lista) {
      const px = c.cx + c.dx, pz = c.cz + c.dz;
      const hInc = (px - C.x) * e.inc.x + (pz - C.y) * e.inc.y;
      const bob = CALMO ? 0 : 0.0007 * Math.sin(t * 1.6 + c.cx * 90) * (1 + 2 * e.fogo);
      c.m.position.set(px, hInc + c.dy + bob, pz);
      // acompanha a superficie do molho e inclina um pouco para o lado que anda (limitado: arrastado rapido nao tomba)
      const tz = Math.max(-0.18, Math.min(0.18, c.vz * 0.6)), tx = Math.max(-0.18, Math.min(0.18, c.vx * 0.6));
      c.m.rotation.set(-e.inc.y * 0.8 + tz, c.g, e.inc.x * 0.8 - tx);
      c.sombra.position.set(px, c.yChao + hInc, pz);
      c.sombra.material.opacity = 0.55 * Math.exp(-c.dy * 60) * (camaroes.alfa ?? 1); // o molho foi assado sem eles: a sombra vem daqui
      const v2 = c.vx * c.vx + c.vz * c.vz + c.vy * c.vy + c.vg * c.vg * 1e-4; if (v2 > maxV) maxV = v2;
      const d2 = c.dx * c.dx + c.dz * c.dz + c.dy * c.dy + c.g * c.g * 1e-4; if (d2 > maxD) maxD = d2;
    }
    K.mexendo = maxV > 1e-8 || maxD > 4e-8 || K.lista.some((c) => c.pega);
    return true;
  }

  /* ---------- camaroes empanados soltos (prato principal): toque faz pular e cair de volta no lugar (crocante, respingo);
     com o mouse da para pegar e passar no creme: em cima do creme (fora do monte de batata palha) a ponta afunda,
     abre rastro, faz onda e empurra o arroz; quanto mais passa, mais creme gruda embaixo. Ao soltar, volta para o lugar */
  let empanados = null;
  function montaEmpanados(prato, grupo, est) {
    const piv = inclinaveis[prato]?.piv || grupo;
    const ms = [];
    piv.traverse((o) => { if (o.isMesh && /^emp\d+$/.test(o.material.userData.parte || "")) ms.push(o); });
    if (!ms.length) return;
    const parede = paredeDe(piv, est.mat.uniforms.uC.value);
    const lista = ms.map((m) => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      // fundo do camarao: 3o percentil da altura (algumas migalhas da farinha ficaram caidas no fundo da panela)
      const py = m.geometry.attributes.position, ys = new Float32Array(py.count);
      for (let i = 0; i < py.count; i++) ys[i] = py.getY(i);
      ys.sort(); const fundo = ys[Math.floor(py.count * 0.03)];
      m.geometry.translate(-cx, -fundo, -cz); m.position.set(cx, fundo, cz); m.rotation.order = "YXZ"; // origem no fundo (o creme gruda pela altura)
      bb.min.y = fundo;
      const raio = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
      const sombra = new THREE.Mesh(new THREE.PlaneGeometry(raio * 2.2, raio * 2.2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: texMancha(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, opacity: 0 }));
      sombra.position.set(cx, bb.min.y + 0.0015, cz); sombra.renderOrder = 1; piv.add(sombra);
      return { m, sombra, casa: m.position.clone(), raio, pos: m.position.clone(), vy: 0, modo: "casa", t: 0, de: null, antes: m.position.clone(), sup: suporteXZ(m.geometry, parede && ((y) => parede(y + fundo))) };
    });
    empanados = { prato, est, piv, lista, alvo: null, pegado: null, alfa: 0, parede };
  }
  function empanadoSob(x, y) {
    if (!empanados || naParada() !== PRATOS.indexOf(empanados.prato) + 1) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const hit = raio3d.intersectObjects(empanados.lista.map((c) => c.m), false)[0];
    return hit ? empanados.lista.find((c) => c.m === hit.object) : null;
  }
  function pulaEmpanado(c) {
    if (CALMO || c.modo !== "casa") return;
    c.modo = "pulo"; c.vy = 0.24 + Math.random() * 0.06; c.giro = (Math.random() - 0.5) * 0.8;
    som.croc(0.6);
  }
  function fisicaEmpanados(dt) {
    const K = empanados; if (!K) return false;
    const e = K.est, C = e.mat.uniforms.uC.value, nivelCreme = e.ySup, t = agoraS();
    let ativo = false;
    for (const c of K.lista) {
      c.antes.copy(c.pos);
      if (c.modo === "pega" && K.alvo) {
        const ox = K.alvo.x - C.x, oz = K.alvo.z - C.y, r = Math.hypot(ox, oz);
        const lim = e.c.R * 0.92; let ax = K.alvo.x, az = K.alvo.z;
        if (r > lim) { ax = C.x + (ox / r) * lim; az = C.y + (oz / r) * lim; }
        const noCreme = r > 0.07 && r < e.c.R * 0.95;            // fora do monte de batata palha do centro
        const alturaAlvo = noCreme ? nivelCreme - 0.006 : c.casa.y + 0.022;
        const k = 1 - Math.exp(-dt * 12);
        const vx = (ax - c.pos.x) * k / dt, vz = (az - c.pos.z) * k / dt;
        c.pos.x += vx * dt; c.pos.z += vz * dt; c.pos.y += (alturaAlvo - c.pos.y) * k;
        const sp = Math.hypot(vx, vz);
        if (noCreme && c.pos.y < nivelCreme && sp > 0.01) {           // passando no creme
          if (t - (c.ultOnda || 0) > 0.07) { c.ultOnda = t; ondinha(e, c.pos.x, c.pos.z, 0.8); correnteza(e, c.pos.x, c.pos.z, vx * 0.7, vz * 0.7); }
          sulco(e, c.pos.x, c.pos.z, 1.4);
          const U = c.m.material.userData.U; U.uMolho.value = Math.min(1, U.uMolho.value + sp * dt * 9);
        }
        ativo = true;
      } else if (c.modo === "volta") {
        c.t += dt; const k = liso(Math.min(1, c.t / 0.6));
        c.pos.lerpVectors(c.de, c.casa, k); c.pos.y += Math.sin(Math.PI * k) * 0.02;
        if (c.t >= 0.6) { c.modo = "casa"; c.pos.copy(c.casa); som.tok(); }
        ativo = true;
      } else if (c.modo === "pulo") {
        c.vy -= 9.81 * dt; c.pos.y += c.vy * dt;
        c.m.rotation.y += (c.giro || 0) * dt;
        if (c.pos.y <= c.casa.y && c.vy < 0) {
          c.pos.y = c.casa.y; c.modo = "casa";
          ondinha(e, c.pos.x, c.pos.z, 1.0); respinga(e, c.pos.x, nivelCreme, c.pos.z, 5, 0.6); correnteza(e, c.pos.x, c.pos.z, 0, 0, 0.06);
          som.croc(0.4);
        }
        ativo = true;
      }
      if (K.parede && c.modo !== "casa") { // o camarao inteiro (rabo incluido, girado) fica dentro da panela
        const ex = passaParede(c.sup, c.pos.x, c.pos.y, c.pos.z, c.m.rotation.y, C, K.parede, 0.002, c.m.rotation.x, c.m.rotation.z);
        if (ex > 0) { c.pos.x -= dirP.x * ex; c.pos.z -= dirP.y * ex; }
      }
      c.m.position.copy(c.pos);
      // inclina na direcao do movimento e volta reto
      const vx = (c.pos.x - c.antes.x) / Math.max(dt, 1e-3), vz = (c.pos.z - c.antes.z) / Math.max(dt, 1e-3), kk = 1 - Math.exp(-dt * 8);
      c.m.rotation.x += (Math.max(-0.25, Math.min(0.25, vz * 1.6)) - c.m.rotation.x) * kk;
      c.m.rotation.z += (Math.max(-0.25, Math.min(0.25, -vx * 1.6)) - c.m.rotation.z) * kk;
      if (c.modo === "casa") c.m.rotation.y *= Math.exp(-dt * 2);
      if (Math.abs(c.m.rotation.x) + Math.abs(c.m.rotation.z) + Math.abs(c.m.rotation.y) > 1e-4) ativo = true;
      const sobe = Math.max(0, c.pos.y - c.casa.y);
      c.sombra.position.set(c.pos.x, c.casa.y + 0.0015, c.pos.z);
      c.sombra.material.opacity = 0.6 * Math.exp(-sobe * 50) * K.alfa;
    }
    return ativo;
  }

  /* ---------- pecas soltas do bacalhau */
  let soltos = null;
  async function carregaSoltos(prato) {
    try {
      const [meta, bin] = await Promise.all([fetch(`${DIR}${prato}-soltos.json`).then((q) => q.json()), fetch(`${DIR}${prato}-soltos.bin`).then((q) => q.arrayBuffer())]);
      const n = meta.n, larg = Math.ceil(Math.sqrt(n));
      const cen = new Float32Array(bin, meta.centros, n * 4);
      const dCen = new Float32Array(larg * larg * 4); dCen.set(cen);
      /* sombra de cada peca no canal w: codigo (forca e "sempre") + raio. O raio vem do tamanho da peca no seu tipo */
      for (const t of meta.tipos) {
        const cfg = SOLTOS_CFG[t.nome]; if (!cfg) continue;
        const mats = t.modo === "inst" ? new Float32Array(bin, t.moff, t.n * 12) : null;
        for (let i = 0; i < t.n; i++) {
          const k = (t.base + i) * 4, w = cen[k + 3];
          const e = mats ? [0, 3, 6].map((o) => Math.hypot(mats[i * 12 + o], mats[i * 12 + o + 1], mats[i * 12 + o + 2])) : [w, w, w];
          const raio = Math.min(0.06, Math.max(0.002, cfg.raio(e, w)));
          dCen[k + 3] = Math.round(cfg.sombra * 20) * 2 + cfg.sempre + raio;
        }
      }
      const tCentro = new THREE.DataTexture(dCen, larg, larg, THREE.RGBAFormat, THREE.FloatType); tCentro.needsUpdate = true;
      const dDesl = new Float32Array(larg * larg * 4);
      const tDesl = new THREE.DataTexture(dDesl, larg, larg, THREE.RGBAFormat, THREE.FloatType); tDesl.needsUpdate = true;
      const A = meta.altura, alt = new Float32Array(bin, A.off, A.n * A.n);
      const tAlt = new THREE.DataTexture(Uint16Array.from(alt, (v) => THREE.DataUtils.toHalfFloat(v)), A.n, A.n, THREE.RedFormat, THREE.HalfFloatType);
      tAlt.magFilter = tAlt.minFilter = THREE.LinearFilter; tAlt.needsUpdate = true;
      const uAlfa = { value: 0 };
      const comuns = { tDesl: { value: tDesl }, tCentro: { value: tCentro }, uLarg: { value: larg }, uLuz: { value: luzU }, uAlfa };
      const malhas = [];
      /* cor de sombra assada: o pedaco que estava escondido embaixo de outra peca veio do Cycles quase preto e aparece quando
         o prato e mexido. Clareia o que esta bem abaixo da cor tipica (por tipo; nas pecas de malha propria, por peca) */
      const lumU8 = (a, k) => 0.2126 * a[k] + 0.7152 * a[k + 1] + 0.0722 * a[k + 2];
      const sRGBlin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const meio = new Float32Array(n), borda = new Uint8Array(n), oculto = new Uint8Array(n), RPAN = 0.145; // meio comprimento; 1 = encostada na parede; 1 = nao desenhada (celular)
      const tipicaDe = {};
      for (const t of meta.tipos) {
        if (t.modo === "inst") {
          const cores = new Uint8Array(bin, t.coff, t.n * 3), ordem = Array.from({ length: t.n }, (_, i) => i).sort((a, b) => lumU8(cores, a * 3) - lumU8(cores, b * 3));
          const tip = ordem[Math.floor(t.n * 0.6)], lt = lumU8(cores, tip * 3);
          for (let i = 0; i < t.n; i++) if (lumU8(cores, i * 3) < lt * 0.8) { const k = 0.82 + ((i * 7919) % 100) / 600; for (let c = 0; c < 3; c++) cores[i * 3 + c] = Math.min(255, cores[tip * 3 + c] * k); }
          tipicaDe[t.nome] = [0, 1, 2].map((c) => sRGBlin(cores[tip * 3 + c]));
          const mats = new Float32Array(bin, t.moff, t.n * 12);
          for (let i = 0; i < t.n; i++) meio[t.base + i] = Math.hypot(mats[i * 12], mats[i * 12 + 1], mats[i * 12 + 2]);
          const fino = (SOLTOS_CFG[t.nome] || {}).fino ?? 1; // a sombra acompanha a largura do fio afinado
          if (fino !== 1) for (let i = 0; i < t.n; i++) { const k = (t.base + i) * 4 + 3, raio = dCen[k] - Math.floor(dCen[k]); dCen[k] = Math.floor(dCen[k]) + Math.max(0.002, raio * fino); }
        } else {
          /* referencia = cor clara do TIPO (percentil 85 de todos os vertices): muitas lascas estavam quase inteiras
             escondidas embaixo de outras, entao a cor "tipica" de cada uma podia ser toda escura */
          const cor = new Uint8Array(bin, t.coff, t.nv * 4);
          const ordem = Array.from({ length: t.nv }, (_, v) => v).sort((a, b) => lumU8(cor, a * 4) - lumU8(cor, b * 4));
          const rv = ordem[Math.floor(t.nv * 0.85)], lt = lumU8(cor, rv * 4), ref = [cor[rv * 4], cor[rv * 4 + 1], cor[rv * 4 + 2]];
          for (let v = 0; v < t.nv; v++) {
            const l = lumU8(cor, v * 4);
            if (l < lt * 0.6) { const w = Math.min(1, (lt * 0.6 - l) / (lt * 0.3)); for (let c = 0; c < 3; c++) cor[v * 4 + c] = Math.round(cor[v * 4 + c] + (ref[c] * 0.62 - cor[v * 4 + c]) * w); }
          }
          tipicaDe[t.nome] = ref.map(sRGBlin);
          for (let i = 0; i < t.n; i++) meio[t.base + i] = cen[(t.base + i) * 4 + 3];
        }
      }
      for (let i = 0; i < n; i++) if (Math.hypot(cen[i * 4] - B(POS[prato][0], POS[prato][1], 0).x, cen[i * 4 + 2] - B(POS[prato][0], POS[prato][1], 0).z) + meio[i] > RPAN - 0.003) borda[i] = 1;
      for (const t of meta.tipos) {
        const cfg = SOLTOS_CFG[t.nome] || { molhado: 0.5 };
        const uTip = { value: new THREE.Vector3(...tipicaDe[t.nome]).multiplyScalar(cfg.ganho ?? 1) };
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, t.off, t.nv * 3), 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(bin, t.noff, t.nv * 3), 3));
        let m;
        if (t.modo === "inst") {
          geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, t.ioff, t.ni), 1));
          m = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT_PECA_INST, fragmentShader: FRAG_GRAO, toneMapped: false,
            uniforms: { ...comuns, uBase: { value: t.base }, uMolhado: { value: cfg.molhado }, uTip, uGanho: { value: cfg.ganho ?? 1 } } }), t.n);
          const mats = new Float32Array(bin, t.moff, t.n * 12), cores = new Uint8Array(bin, t.coff, t.n * 3), M = new THREE.Matrix4(), cor = new THREE.Color();
          const fino = cfg.fino ?? 1; // fios de palha: o molde saia grosso perto dos fios finos do Cycles; afina largura e espessura
          for (let i = 0; i < t.n; i++) {
            const k = i * 12;
            M.set(mats[k], mats[k + 3] * fino, mats[k + 6] * fino, mats[k + 9], mats[k + 1], mats[k + 4] * fino, mats[k + 7] * fino, mats[k + 10], mats[k + 2], mats[k + 5] * fino, mats[k + 8] * fino, mats[k + 11], 0, 0, 0, 1);
            m.setMatrixAt(i, M);
            m.setColorAt(i, cor.setRGB(cores[i * 3] / 255, cores[i * 3 + 1] / 255, cores[i * 3 + 2] / 255, THREE.SRGBColorSpace));
          }
          if (cfg.leve && FRACAO < 1) { m.count = Math.ceil(t.n * FRACAO); for (let i = m.count; i < t.n; i++) oculto[t.base + i] = 1; } // aparelho mais fraco: so parte dos fios
        } else {
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, t.ioff, t.ni), 1));
          geo.setAttribute("aCor", new THREE.BufferAttribute(new Uint8Array(bin, t.coff, t.nv * 4), 4, true));
          geo.setAttribute("aId", new THREE.BufferAttribute(Float32Array.from(new Uint16Array(bin, t.doff, t.nv)), 1));
          m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT_PECA_UNICA, fragmentShader: FRAG_GRAO, toneMapped: false, defines: { COR_ASSADA: 1 },
            uniforms: { ...comuns, uMolhado: { value: cfg.molhado }, uGanho: { value: cfg.ganho ?? 1 }, uTip, uPiso: { value: cfg.piso ?? 0.4 } } }));
        }
        m.renderOrder = 1; recorta(m, prato);
        malhas.push(m);
      }
      /* sombra de contato de cada peca, no chao da comida embaixo dela */
      const geoS = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const sombraP = new THREE.InstancedMesh(geoS, new THREE.ShaderMaterial({
        vertexShader: VERT_SOMBRA_PECA, fragmentShader: FRAG_SOMBRA_PECA, transparent: true, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
        uniforms: { ...comuns, tAlt: { value: tAlt }, uAlt: { value: new THREE.Vector4(A.x0, A.z0, A.passo, A.n) } },
      }), n);
      sombraP.renderOrder = 1; recorta(sombraP, prato);
      for (const m of malhas) await renderer.compileAsync(m, camera, scene);
      scene.add(sombraP); for (const m of malhas) scene.add(m);
      const C = B(POS[prato][0], POS[prato][1], 0);
      /* fundo de palha embaixo da cama: onde sairam os fios soltos ficaram vaos que mostravam o inox preto da panela */
      // raio do fundo da panela (a parede abre para fora: com o raio da boca, o disco aparecia por baixo, do lado de fora)
      const fundo = new THREE.Mesh(new THREE.CircleGeometry(0.108, 72).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
        toneMapped: false, uniforms: { uAlfa },
        vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uAlfa; varying vec3 vW;
          float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float fios(vec2 p, float a) { vec2 d = vec2(cos(a), sin(a)); vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x))) * vec2(60.0, 520.0);
            vec2 id = floor(q); return step(0.45, h(id + floor(q.x * 0.0))) * smoothstep(0.5, 0.1, abs(fract(q.y) - 0.5)) * (0.6 + 0.4 * h(vec2(id.y, 3.0))); }
          void main() {
            vec2 p = vW.xz;
            float f = max(max(fios(p, 0.3), fios(p, 1.4)), max(fios(p, 2.3), fios(p + 0.37, 2.9)));
            vec3 c = mix(vec3(0.05, 0.022, 0.006), vec3(0.32, 0.15, 0.035), f);   // palha na sombra, embaixo da cama
            gl_FragColor = vec4(c * uAlfa, 1.0);
            #include <colorspace_fragment>
          }`,
      }));
      fundo.position.set(C.x, 0.0075, C.z); fundo.renderOrder = 0;
      scene.add(fundo);
      soltos = { n, larg, cen, d: dDesl, v: new Float32Array(n * 4), tDesl, uAlfa, alt, A, cx: C.x, cz: C.z, ultimaMexida: -99, mexendo: true, ult: null, malhas, sombraP, meio, borda, oculto, RPAN };
      pede();
    } catch (e) { console.warn("soltos", prato, e); }
  }
  /* altura da comida (m) num ponto, do mapa do Blender (bilinear) */
  function alturaComida(x, z) {
    const s = soltos, A = s.A, N = A.n;
    const gx = Math.min(N - 1.001, Math.max(0, (x - A.x0) / A.passo)), gz = Math.min(N - 1.001, Math.max(0, (z - A.z0) / A.passo));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, a = s.alt;
    return (a[j * N + i] * (1 - fx) + a[j * N + i + 1] * fx) * (1 - fz) + (a[(j + 1) * N + i] * (1 - fx) + a[(j + 1) * N + i + 1] * fx) * fz;
  }
  /* ponto da comida embaixo do cursor: anda pelo raio ate passar para baixo do relevo e refina */
  const pComida = new THREE.Vector3();
  function pontoComida(x, y) {
    if (!soltos || naParada() !== 3) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const o = raio3d.ray.origin, d = raio3d.ray.direction;
    if (d.y > -0.05) return null;
    let a = (0.12 - o.y) / d.y, b = (0.0 - o.y) / d.y, antes = a, achou = false;
    for (let k = 1; k <= 48; k++) {
      const t = a + ((b - a) * k) / 48, px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      if (py <= alturaComida(px, pz)) { b = t; a = antes; achou = true; break; }
      antes = t;
    }
    if (!achou) return null;
    for (let k = 0; k < 6; k++) { const t = (a + b) / 2, py = o.y + d.y * t; if (py <= alturaComida(o.x + d.x * t, o.z + d.z * t)) b = t; else a = t; }
    pComida.copy(d).multiplyScalar(b).add(o);
    return Math.hypot(pComida.x - soltos.cx, pComida.z - soltos.cz) < 0.135 ? pComida : null;
  }
  /* toque/clique na comida: as pecas em volta pulam (crocante) e caem de volta, quicando de leve */
  function pula(x, z) {
    const s = soltos; if (!s || CALMO) return;
    const R = 0.05; let n = 0;
    for (let i = 0; i < s.n; i++) {
      if (s.oculto[i]) continue;
      const px = s.cen[i * 4] + s.d[i * 4], pz = s.cen[i * 4 + 2] + s.d[i * 4 + 2], dx = px - x, dz = pz - z, dd = Math.hypot(dx, dz);
      if (dd > R) continue;
      const w = 1 - dd / R, rnd = ((i * 2654435761) % 1000) / 1000;
      s.v[i * 4 + 1] = Math.max(s.v[i * 4 + 1], (0.3 + 0.42 * rnd) * w + 0.08); // pico de ~1 a 3 cm
      s.v[i * 4] += (dx / (dd + 1e-4)) * 0.06 * w + (rnd - 0.5) * 0.04; s.v[i * 4 + 2] += (dz / (dd + 1e-4)) * 0.06 * w + (0.5 - rnd) * 0.04;
      s.v[i * 4 + 3] += (rnd - 0.5) * 18 * w;
      n++;
    }
    s.ultimaMexida = agoraS(); s.mexendo = true;
    som.croc(Math.min(1, n / 120));
  }
  /* garfo (arrastar com o botao): leva as pecas em volta na direcao do arraste, levantando um pouco as de cima */
  function garfo(x, z) {
    const s = soltos; if (!s || CALMO) return;
    const agora = agoraS(), u = s.ult;
    s.ult = { x, z, t: agora };
    if (!u || agora - u.t > 0.25) return;
    const dt = Math.max(1 / 240, agora - u.t);
    let vx = (x - u.x) / dt, vz = (z - u.z) / dt; const sp = Math.hypot(vx, vz), lim = 0.35;
    if (sp > lim) { vx *= lim / sp; vz *= lim / sp; }
    if (sp < 0.01) return;
    const R = 0.02;
    for (let i = 0; i < s.n; i++) {
      if (s.oculto[i]) continue;
      const px = s.cen[i * 4] + s.d[i * 4], pz = s.cen[i * 4 + 2] + s.d[i * 4 + 2], dd = Math.hypot(px - x, pz - z);
      if (dd > R) continue;
      const w = 1 - dd / R, k = i * 4;
      s.v[k] += (vx * 0.85 - s.v[k]) * w * 0.7; s.v[k + 2] += (vz * 0.85 - s.v[k + 2]) * w * 0.7;
      s.v[k + 1] = Math.max(s.v[k + 1], Math.min(0.18, sp * 0.35) * w);
      s.v[k + 3] += (((i * 7919) % 100) / 100 - 0.5) * sp * 60 * w;
    }
    s.ultimaMexida = agora; s.mexendo = true;
    if (sp > 0.08 && agora - (s.ultSom || 0) > 0.09) { s.ultSom = agora; som.croc(0.25); }
  }
  function fisicaSoltos(dt) {
    const s = soltos; if (!s) return false;
    let ativo = false;
    if (s.uAlfa.value < 1) { s.uAlfa.value = Math.min(1, s.uAlfa.value + dt * 1.6); ativo = true; }
    if (!s.mexendo) return ativo;
    const t = agoraS(), calmo = t - s.ultimaMexida, xs = Math.min(1, Math.max(0, (calmo - 1.6) / 1.4)), volta = xs * xs * (3 - 2 * xs);
    const d = s.d, v = s.v, cen = s.cen, Rlim = 0.128;
    let maxV = 0, maxD = 0;
    for (let i = 0; i < s.n; i++) {
      const k = i * 4, rx = cen[k], ry = cen[k + 1], rz = cen[k + 2];
      let dx = d[k], dy = d[k + 1], dz = d[k + 2], g = d[k + 3], vx = v[k], vy = v[k + 1], vz = v[k + 2], vg = v[k + 3];
      if (dx === 0 && dy === 0 && dz === 0 && vx === 0 && vy === 0 && vz === 0 && vg === 0 && g === 0) continue;
      const chao = alturaComida(rx + dx, rz + dz) - alturaComida(rx, rz); // relevo novo menos o do lugar de origem
      const noChao = dy <= chao + 1e-4 && vy <= 0;
      if (!noChao) vy -= 9.81 * dt;
      if (noChao) {
        const f = Math.exp(-dt * 14); vx *= f; vz *= f; vg *= Math.exp(-dt * 10);  // comida seca: atrito alto
        if (volta > 0) { const h = (i * 0.618) % 1, tau = 1.1 * (0.7 + 0.6 * h); vx += (-dx / tau * volta - vx) * Math.min(1, dt * 8); vz += (-dz / tau * volta - vz) * Math.min(1, dt * 8); g -= g * Math.min(1, dt * 2 * volta); }
      }
      dx += vx * dt; dz += vz * dt; dy += vy * dt; g += vg * dt;
      const chao2 = alturaComida(rx + dx, rz + dz) - alturaComida(rx, rz);
      if (dy < chao2) { dy = chao2; vy = vy < -0.35 ? -vy * 0.28 : 0; } // quica de leve e assenta
      // parede da panela: o centro para a meio comprimento da parede (o fio inteiro fica dentro);
      // pecas que ja nasceram encostadas nao giram (girando, a ponta atravessaria a parede) e nao passam do proprio lugar
      if (s.borda[i]) { vg = 0; g *= 0.8; }
      const ox = rx + dx - s.cx, oz = rz + dz - s.cz, r = Math.hypot(ox, oz);
      const lim = s.borda[i] ? Math.hypot(rx - s.cx, rz - s.cz) : Math.max(0.02, s.RPAN - s.meio[i]);
      if (r > lim) { dx -= (ox / r) * (r - lim); dz -= (oz / r) * (r - lim); const vr = (vx * ox + vz * oz) / r; if (vr > 0) { vx -= (ox / r) * vr; vz -= (oz / r) * vr; } }
      if (volta >= 1 && Math.abs(dx) + Math.abs(dz) < 2e-4 && Math.abs(vy) < 1e-3 && Math.abs(dy - chao2) < 1e-4) { dx = dz = 0; dy = 0; vx = vz = vy = vg = 0; g *= 0.9; if (Math.abs(g) < 1e-3) g = 0; }
      d[k] = dx; d[k + 1] = dy; d[k + 2] = dz; d[k + 3] = g; v[k] = vx; v[k + 1] = vy; v[k + 2] = vz; v[k + 3] = vg;
      const v2 = vx * vx + vy * vy + vz * vz; if (v2 > maxV) maxV = v2;
      const d2 = dx * dx + dz * dz + g * g * 1e-4; if (d2 > maxD) maxD = d2;
    }
    s.tDesl.needsUpdate = true;
    s.mexendo = maxV > 1e-8 || maxD > 1e-9;
    return true;
  }

  const loader = new GLTFLoader();
  let feitos = 0;
  const entrando = []; // pratos acendendo aos poucos quando chegam

  async function carrega(prato) {
    const glb = await loader.loadAsync(DIR + prato + ".glb");
    const grupo = glb.scene;
    const pedidos = [];
    grupo.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name.replace(/\.\d+$/, "");
      const parte = n.split("_")[1];
      pedidos.push((async () => {
        if (/^cam\d+$/.test(parte)) {
          o.material = assado(await tex(`${n}-cor${Q}.webp`, true), null, { r: 0.38, e: 0.12 }); // camarao solto: luz do Cycles assada nele
        } else if (parte === "comida" || /^(bolinha|emp)\d*$/.test(parte)) {
          const [l, nm] = await Promise.all([tex(`${n}-cor${Q}.webp`, true), tex(`${n}-normal${Q}.webp`, false)]);
          o.material = assado(l, nm, { r: 0.42, e: 0.1 });
          if (/^bolinha\d*$/.test(parte)) prepBolinha(o.material);
          if (/^emp\d+$/.test(parte)) prepBolinha(o.material, 0.012, [0.66, 0.52, 0.24]); // camarao empanado: creme gruda embaixo
        } else if (parte === "base") {
          o.material = assado(await tex(`${n}-cor${Q}.webp`, true), null, { r: 0.2, e: 0.18 });
        } else if (parte === "cauda") {
          o.material = assado(await tex(`${n}-cor${Q}.webp`, true), null, { r: 0.4, e: 0.06 });
        } else if (parte === "louca") {
          o.material = assado(await tex(`${n}-cor${Q}.webp`, true), null, { r: 0.15, e: 0.2 });
        } else if (parte === "cobre") {
          o.material = metal(0xe0906a, 0.22, await tex(`${n}-ao.webp`, false), 0.9);
        } else {
          /* inox: cinza escuro que reflete a sala escura, como no render (nao alaranjado) */
          o.material = metal(0xa9a7a4, 0.34, await tex(`${n}-ao.webp`, false), 0.55);
        }
      })());
    });
    await Promise.all(pedidos);
    grupo.traverse((o) => { if (o.isMesh) { o.material.userData.nome = o.name.replace(/\.\d+$/, ""); o.material.userData.parte = o.name.split("_")[1]?.replace(/\.\d+$/, ""); } });
    /* o caldo nasce antes de compilar: o molho assado ganha o nivel que balanca e ja compila assim */
    const filme = CALDOS[prato] ? criaCaldo(prato, grupo) : null;
    if (filme && INCLINA[prato]) montaInclina(prato, grupo, filme);
    if (filme) montaCamaroes(prato, grupo, filme);
    if (filme) montaEmpanados(prato, grupo, filme);
    if (prato === "bombinha") montaBombinha(grupo);
    /* sobe as texturas e compila antes de entrar em cena: sem travar o primeiro quadro */
    const mats = [];
    grupo.traverse((o) => { if (o.isMesh) mats.push(o.material); });
    await sobe(mats.flatMap((m) => [m.emissiveMap, m.normalMap, m.aoMap]));
    await renderer.compileAsync(grupo, camera, scene);
    for (const m of mats) {
      m.userData.alvoE = m.emissiveIntensity; m.userData.alvoEnv = m.envMapIntensity; m.userData.alvoCor = m.color.clone();
      m.emissiveIntensity = 0; m.envMapIntensity = 0;
    }
    panelas[prato] = grupo;
    if (filme) carregaGraos(prato, filme);
    if (prato === "bacalhau") carregaSoltos(prato);
    entrando.push({ mats, filme, prato, t0: performance.now() });
    scene.add(grupo);
    feitos++;
    carga.textContent = `Pondo a mesa ${Math.round((feitos / PRATOS.length) * 100)}%`;
    pede();
  }

  /* vapor: um plano por prato quente, sempre de frente para a camera, com ruido subindo; o cursor perto empurra o vapor */
  const fumos = [];
  if (!CALMO) {
    const ruido = texturaRuido();
    const geoFumo = new THREE.PlaneGeometry(0.17, 0.36, 12, 48); geoFumo.translate(0, 0.18, 0);
    Object.entries(FUMOS).forEach(([n, op], i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT_FUMO, fragmentShader: FRAG_FUMO, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        uniforms: { uT: { value: 0 }, uVento: { value: 0 }, uOp: { value: 0 }, uRuido: { value: ruido } },
      });
      const m = new THREE.Mesh(geoFumo, mat);
      m.position.copy(B(POS[n][0], POS[n][1], 0.045)); m.renderOrder = 3;
      m.userData = { op, prato: n, vento: 0, fase: i * 17.3 };
      scene.add(m); fumos.push(m);
    });
  }

  /* camera de cinema: a cena vai para uma textura (com profundidade) e o passe de foco desenha na tela.
     Marcada como "XR" para o three aplicar ali dentro o tone mapping do metal, como faria direto na tela */
  // celular (modo leve): sem o passe de foco, o mais caro de desenhar; ?foco forca ligar para testar
  const DOF = !new URLSearchParams(location.search).has("semfoco") && (NIVEL === 2 || new URLSearchParams(location.search).has("foco"));
  const MAXR = CEL ? 7 : 12, PASSO = CEL ? 2.4 : 2.0;
  let rtCena = null, cenaDof = null, matDof = null, lenteFoco = 0, lenteK = 0;
  if (DOF) {
    rtCena = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: CEL ? 0 : 4, depthTexture: new THREE.DepthTexture(4, 4) });
    rtCena.isXRRenderTarget = true;
    rtCena.texture.colorSpace = THREE.LinearSRGBColorSpace;
    matDof = new THREE.ShaderMaterial({
      vertexShader: VERT_TELA, fragmentShader: FRAG_DOF(PASSO, MAXR), depthTest: false, depthWrite: false,
      uniforms: { tCor: { value: rtCena.texture }, tProf: { value: rtCena.depthTexture }, uTexel: { value: new THREE.Vector2() },
        uFoco: { value: 0.5 }, uK: { value: 0 }, uPerto: { value: camera.near }, uLonge: { value: camera.far }, uVinheta: { value: 0.22 }, uZona: { value: 0.06 } },
    });
    cenaDof = new THREE.Scene();
    const tela = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matDof); tela.frustumCulled = false;
    cenaDof.add(tela);
  }

  /* camada de tela (por cima da cena): a luz que segue o cursor na abertura e a mesa montada na reserva */
  const hud = new THREE.Scene();
  const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const plano = new THREE.PlaneGeometry(1, 1);
  const camadaTela = (map, aditivo) => {
    const m = new THREE.Mesh(plano, new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.visible = false; hud.add(m); return m;
  };
  const SOMBRA_EXT = 2.5; // a sombra escurece ate 40% do raio e segue escura ate a borda da textura (cobre a tela toda)
  const sombra = camadaTela(mancha([[0.12 / SOMBRA_EXT, "rgba(16,7,3,0)"], [1 / SOMBRA_EXT, "rgba(16,7,3,.62)"], [1, "rgba(16,7,3,.62)"]], 512), false);
  const brilho = camadaTela(mancha([[0, "rgba(255,200,150,1)"], [1, "rgba(255,200,150,0)"]]), true);
  const apagaTex = mancha([[0, "rgba(12,6,3,.8)"], [0.55, "rgba(12,6,3,.6)"], [1, "rgba(12,6,3,0)"]]);
  const acendeTex = mancha([[0, "rgba(255,190,130,1)"], [1, "rgba(255,190,130,0)"]]);
  const reserva = Object.fromEntries(PRATOS.map((n) => [n, { apaga: camadaTela(apagaTex, false), acende: camadaTela(acendeTex, true) }]));
  const poe = (m, x, y, tam, op) => { m.visible = op > 0.004; m.material.opacity = op; m.position.set(x, H - y, 0); m.scale.set(tam, tam, 1); };

  /* rota */
  let retrato = false, chaves = [], curvaP, curvaT, marcos = [], W = innerWidth, H = innerHeight;
  function monta() {
    W = innerWidth; H = canvas.clientHeight || innerHeight;
    retrato = innerHeight > W * 1.05;
    chaves = paradas(retrato);
    curvaP = new THREE.CatmullRomCurve3(chaves.map((k) => k.p), false, "catmullrom", 0.5);
    curvaT = new THREE.CatmullRomCurve3(chaves.map((k) => k.t), false, "catmullrom", 0.5);
    const py = scrollY, h = innerHeight;
    const seg = (id) => { const el = document.getElementById(id); return { a: el.getBoundingClientRect().top + py, h: el.offsetHeight }; };
    marcos = [{ y0: 0, y1: h * 0.12, r: 0 }];
    Object.values(ANCORA).forEach((id, i) => {
      const s = seg(id);
      marcos.push({ y0: s.a + s.h * 0.24, y1: s.a + s.h * 0.74 - h * 0.2, r: i + 1 });
    });
    const res = seg("reservar");
    marcos.push({ y0: res.a - h * 0.2, y1: res.a + res.h, r: 5 });
    dimensiona();
    pede();
  }
  function rotaEm(y) {
    if (y <= marcos[0].y1) return 0;
    for (let i = 1; i < marcos.length; i++) {
      const m = marcos[i];
      if (y <= m.y1) {
        if (y >= m.y0) return m.r;
        const p = marcos[i - 1];
        return p.r + liso((y - p.y1) / (m.y0 - p.y1)) * (m.r - p.r);
      }
    }
    return marcos[marcos.length - 1].r;
  }

  /* densidade adaptativa: so desce quando o aparelho sofre */
  const DPR_MAX = Math.min(devicePixelRatio || 1, [1.3, 1.5, 2][NIVEL]);
  let dpr = DPR_MAX;
  const DPR_MIN = 0.85;
  function dimensiona() {
    /* so recria a tela se o tamanho mudou (no celular a barra de endereco dispara resize o tempo todo) */
    if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
    }
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    hudCam.right = W; hudCam.top = H; hudCam.updateProjectionMatrix();
    if (rtCena) {
      const w = canvas.width, h = canvas.height;
      if (rtCena.width !== w || rtCena.height !== h) rtCena.setSize(w, h);
      matDof.uniforms.uTexel.value.set(1 / w, 1 / h);
    }
  }

  /* ---------- da cena para a tela */
  const tmp = new THREE.Vector3();
  const naTela = (v) => { tmp.copy(v).project(camera); return tmp.z < 1 ? [(tmp.x + 1) / 2 * W, (1 - tmp.y) / 2 * H] : null; };
  const CENTROS = Object.fromEntries(PRATOS.map((n) => [n, B(POS[n][0], POS[n][1], 0.03)]));
  const PONTOS = Object.fromEntries(PRATOS.map((n) => [n, Object.entries(LOCAIS[n]).map(([nome, l]) => [nome, noPrato(n, l)])]));

  /* ---------- ingredientes: botoes no lugar certo do prato, so com a camera parada.
     Ficam dentro do artigo do prato (depois da ficha), para o Tab chegar neles na ordem da pagina */
  const botoes = new Map();
  let paradaPontos = -1;
  function posicionaPontos(destino) {
    const k = Math.round(r);
    const parado = k >= 1 && k <= 4 && Math.abs(r - k) < 0.05 && Math.abs(destino - r) < 0.02;
    const alvo = parado ? k : -1;
    if (alvo !== paradaPontos) {
      for (const b of botoes.values()) b.remove();
      botoes.clear();
      paradaPontos = alvo;
      const camada = alvo > 0 ? document.getElementById(ANCORA[PRATOS[alvo - 1]]) : null;
      if (alvo > 0) for (const [nome] of PONTOS[PRATOS[alvo - 1]]) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "ponto"; b.setAttribute("aria-expanded", "false");
        b.innerHTML = `<span class="ponto-marca" aria-hidden="true"></span><span class="ponto-nome">${nome}</span>`;
        b.addEventListener("click", () => { const ab = b.getAttribute("aria-expanded") !== "true"; b.setAttribute("aria-expanded", String(ab)); som.tok(); });
        camada.appendChild(b); botoes.set(nome, b);
        requestAnimationFrame(() => b.classList.add("ver"));
      }
    }
    if (alvo > 0) for (const [nome, v] of PONTOS[PRATOS[alvo - 1]]) {
      const p = naTela(v), b = botoes.get(nome);
      if (b && p) {
        b.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
        b.classList.toggle("esq", p[0] > W * 0.58); // perto da borda direita, o nome abre para a esquerda
      }
    }
  }

  /* ---------- abertura: passar o cursor num prato mostra o nome; clicar leva a camera ate ele */
  const dica = document.getElementById("dica-prato");
  function pratoSob(x, y) {
    if (r > 0.25) return null;
    let melhor = null, dmin = Math.min(W, H) * 0.14;
    for (const n of PRATOS) { const p = naTela(CENTROS[n]); if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - y); if (d < dmin) { dmin = d; melhor = n; } }
    return melhor;
  }
  const naoTexto = (el) => !el?.closest || !el.closest("a, button, input, select, label, .topo, .trilho, .ficha, .cartao, .cardapio, .casa, .rodape, .abertura-txt, h1, .pratos-intro");

  let r = 0, destino = 0, rolou = true, sujo = true, visivel = true, ultimo = performance.now(), somaT = 0, nT = 0, acumula = 0, ultimaParada = -1;
  let mx = 0, my = 0, px = 0, py2 = 0, lx = 0.5, ly = 0.45, sobre = false, sel = escolhidos();
  let cursorX = -1, cursorY = -1, ptrX = 0, ptrY = 0, ptrMudou = false, dedoNaTela = false, botaoMouse = false, sobreAlca = false;
  const pede = () => { sujo = true; };

  /* ---------- tocar no caldo: o cursor (ou o dedo arrastando) deixa ondinhas; clicar na panela balanca o caldo */
  const raio3d = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const panelas = {};
  const naParada = () => { const k = Math.round(r); return k >= 1 && k <= 4 && Math.abs(r - k) < 0.3 ? k : 0; };
  function caldoEm(x, y) {
    if (!naParada() || !caldos.length) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const hit = raio3d.intersectObjects(caldos.map((c) => c.mesh), false)[0];
    return hit ? { est: caldos.find((c) => c.mesh === hit.object), p: hit.point } : null;
  }
  /* alca da panela do prato parado embaixo do cursor: devolve a panela e a direcao da alca (do centro para fora) */
  const inv = new THREE.Matrix4(), q3 = new THREE.Vector3();
  function alcaSob(x, y) {
    const k = naParada(), p = k && inclinaveis[PRATOS[k - 1]];
    if (!p || !p.cobre) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const hit = raio3d.intersectObject(p.cobre, false)[0];
    if (!hit) return null;
    q3.copy(hit.point).applyMatrix4(inv.copy(p.piv.matrixWorld).invert()); // tira a inclinacao: ponto na panela parada
    const C = p.est.mat.uniforms.uC.value, dx = q3.x - C.x, dz = q3.z - C.y, rr = Math.hypot(dx, dz);
    return rr > p.cfg.alca ? { p, dx: dx / rr, dz: dz / rr } : null;
  }
  function tocaCaldo(x, y, forca, empurrar = false) {
    const achou = caldoEm(x, y);
    if (!achou) return false;
    const { est, p } = achou;
    if (empurrar || !est.ultimaOnda || est.ultimaOnda.distanceTo(p) > (botaoMouse ? 0.009 : 0.014)) {
      ondinha(est, p.x, p.z, forca * (botaoMouse ? 1.2 : 1));
      est.ultimaOnda = (est.ultimaOnda || new THREE.Vector3()).copy(p);
    }
    /* mexer: a velocidade do cursor sobre o caldo vira correnteza que leva os graos (arrastando com o botao, mexe forte) */
    const agora = agoraS(), u0 = est.ultimoToque;
    if (u0 && agora - u0.t < 0.25) {
      const dtt = Math.max(1 / 240, agora - u0.t);
      let vx = (p.x - u0.x) / dtt, vz = (p.z - u0.z) / dtt;
      const sp = Math.hypot(vx, vz), lim = 0.22;
      if (sp > lim) { vx *= lim / sp; vz *= lim / sp; }
      if (sp > 0.004) { const k = botaoMouse ? 0.8 : 0.22; correnteza(est, p.x, p.z, vx * k, vz * k); if (botaoMouse || dedoNaTela) sulco(est, p.x, p.z); }
    }
    est.ultimoToque = { x: p.x, z: p.z, t: agora };
    if (empurrar) {
      const c = est.mat.uniforms.uC.value; empurra(est, c.x - p.x, c.y - p.z, forca);
      correnteza(est, p.x, p.z, 0, 0, 0.12); // a batida do clique afasta os graos em volta
      respinga(est, p.x, est.ySup, p.z, 4, 0.45);
    }
    return true;
  }
  function tocaPanela(x, y) {
    const k = naParada(); if (!k) return false;
    const prato = PRATOS[k - 1], est = caldos.find((c) => c.prato === prato);
    if (!est || !panelas[prato]) return false;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raio3d.setFromCamera(ndc, camera);
    const hit = raio3d.intersectObject(panelas[prato], true)[0];
    if (!hit) return false;
    const c = est.mat.uniforms.uC.value;
    empurra(est, c.x - hit.point.x, c.y - hit.point.z, 1.2); // a batida na panela empurra o caldo para o outro lado
    ondinha(est, c.x, c.y, 0.6);
    return true;
  }

  addEventListener("scroll", () => { rolou = true; }, { passive: true });
  let desceuX = 0, desceuY = 0;
  /* segurar parado no molho aumenta o fogo; puxar a alca (mouse) inclina a panela */
  let segura = null, segurouMs = 0, arrasto = null, garfoAtivo = false;
  const orbita = { yaw: 0, pitch: 0, ay: 0, ap: 0, arr: null };
  const solta = () => {
    dedoNaTela = false;
    if (orbita.arr) { orbita.arr = null; document.body.classList.remove("arrastando"); }
    if (empanados && empanados.pegado) {
      const c = empanados.pegado; empanados.pegado = null; empanados.alvo = null; document.body.classList.remove("arrastando");
      if (Math.hypot(ptrX - desceuX, ptrY - desceuY) > 6) { c.modo = "volta"; c.t = 0; c.de = c.pos.clone(); } // solto: volta para o lugar
      else { c.modo = "casa"; c.pos.copy(c.casa); }                                                         // so um clique: o clique faz pular
    }
    if (garfoAtivo) { garfoAtivo = false; document.body.classList.remove("arrastando"); }
    if (camaroes) for (const c of camaroes.lista) if (c.pega) { c.pega = false; camaroes.alvo = null; document.body.classList.remove("arrastando"); }
    if (segura) { segura.est.fogoAlvo = 0; segurouMs = performance.now() - segura.t0; segura = null; }
    if (arrasto) { arrasto.p.segura = false; arrasto = null; document.body.classList.remove("arrastando"); }
    if (bomba && bomba.pega) {
      bomba.pega = false; document.body.classList.remove("arrastando");
      const moveu = Math.hypot(ptrX - desceuX, ptrY - desceuY) > 6;
      if (moveu) { // soltou em cima do potinho: mergulha; fora dele: volta para o lugar
        const p = bomba.m.position;
        if (Math.hypot(p.x - POTE.x, p.z - POTE.z) < 0.035) mergulho("ar"); else devolve();
      } // sem arrastar, o clique (logo depois) faz o caminho sozinho
    }
  };
  addEventListener("pointerdown", (e) => {
    desceuX = e.clientX; desceuY = e.clientY; segurouMs = 0;
    if (e.pointerType !== "mouse") { dedoNaTela = true; ptrMudou = true; }
    ptrX = e.clientX; ptrY = e.clientY; // segurar compara com o ponto onde apertou
    if (CALMO || !naParada() || !naoTexto(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
    const emp = empanadoSob(e.clientX, e.clientY);
    if (emp) { // camarao empanado: com o mouse, pega e passa no creme (o toque simples faz pular, no clique)
      if (e.pointerType === "mouse" && emp.modo === "casa") {
        const p = molhoLocal(e.clientX, e.clientY, emp.casa.y + 0.02, empanados.piv);
        if (p) { emp.modo = "pega"; empanados.pegado = emp; emp.off = { x: emp.pos.x - p.x, z: emp.pos.z - p.z }; empanados.alvo = { x: emp.pos.x, z: emp.pos.z }; document.body.classList.add("arrastando"); }
      }
      return;
    }
    const cam = camaraoSob(e.clientX, e.clientY);
    if (cam) { // camarao ao alho: com o mouse, pega e arrasta pelo molho (o toque simples faz pular, no clique)
      if (e.pointerType === "mouse") {
        const p = molhoLocal(e.clientX, e.clientY, 0.03);
        if (p) { cam.pega = true; cam.offPega = { x: cam.cx + cam.dx - p.x, z: cam.cz + cam.dz - p.z }; camaroes.alvo = { x: p.x + cam.offPega.x, z: p.z + cam.offPega.z }; camaroes.mexendo = true; document.body.classList.add("arrastando"); }
      }
      return;
    }
    if (e.pointerType === "mouse" && pontoComida(e.clientX, e.clientY)) { // bacalhau: arrastar com o botao e o garfo
      garfoAtivo = true; soltos.ult = null; garfo(pComida.x, pComida.z);
      document.body.classList.add("arrastando");
      return;
    }
    const bb = bolinhaSob(e.clientX, e.clientY);
    if (bb) {
      bomba = bb;
      if (e.pointerType === "mouse" && !bomba.seq) {
        bomba.pega = true; bomba.offPega = null; arrastaBolinha(e.clientX, e.clientY);
        if (bomba.alvoPega) bomba.offPega = { x: bomba.m.position.x - bomba.alvoPega.x, z: bomba.m.position.z - bomba.alvoPega.z };
        arrastaBolinha(e.clientX, e.clientY);
        document.body.classList.add("arrastando");
      }
      return;
    }
    const a = alcaSob(e.clientX, e.clientY);
    if (a) {
      if (e.pointerType === "mouse") {
        if (a.p.ang < 0.005) a.p.dir.set(a.dx, a.dz);
        a.p.segura = true; arrasto = { p: a.p, y0: e.clientY };
        document.body.classList.add("arrastando");
      }
      return;
    }
    const c = caldoEm(e.clientX, e.clientY);
    if (c) { segura = { est: c.est, t0: performance.now(), x: e.clientX, y: e.clientY, mexeu: false }; return; }
    // nada para pegar embaixo do mouse: arrastar gira a camera em volta do prato
    if (e.pointerType === "mouse") { orbita.arr = { x0: e.clientX, y0: e.clientY, ay0: orbita.ay, ap0: orbita.ap }; document.body.classList.add("arrastando"); }
  }, { passive: true });
  addEventListener("pointerup", solta, { passive: true });
  addEventListener("pointercancel", solta, { passive: true });
  addEventListener("contextmenu", (e) => { if (segura || arrasto) e.preventDefault(); }); // toque longo no celular: sem menu
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") { cursorX = e.clientX; cursorY = e.clientY; botaoMouse = (e.buttons & 1) === 1; }
    if (e.pointerType === "mouse" || dedoNaTela) { ptrX = e.clientX; ptrY = e.clientY; ptrMudou = true; }
    if (arrasto) { arrasto.p.alvo = Math.min(1, Math.max(0, (arrasto.y0 - e.clientY) / (H * 0.28))) * arrasto.p.cfg.max; return; }
    if (bomba && bomba.pega) { arrastaBolinha(e.clientX, e.clientY); return; }
    if (garfoAtivo) { const p = pontoComida(e.clientX, e.clientY); if (p) garfo(p.x, p.z); return; }
    if (orbita.arr) {
      const o = orbita.arr;
      orbita.ay = Math.max(-0.7, Math.min(0.7, o.ay0 - ((e.clientX - o.x0) / W) * 1.6));
      orbita.ap = Math.max(-0.12, Math.min(0.3, o.ap0 + ((e.clientY - o.y0) / H) * 0.8));
      pede(); return;
    }
    if (empanados && empanados.pegado) { const c = empanados.pegado, p = molhoLocal(e.clientX, e.clientY, c.casa.y + 0.02, empanados.piv); if (p) empanados.alvo = { x: p.x + c.off.x, z: p.z + c.off.z }; return; }
    const pegado = camaroes && camaroes.lista.find((c) => c.pega);
    if (pegado) { const p = molhoLocal(e.clientX, e.clientY, 0.03); if (p) camaroes.alvo = { x: p.x + pegado.offPega.x, z: p.z + pegado.offPega.z }; return; }
    if (!CEL && !CALMO) { mx = e.clientX / W - 0.5; my = e.clientY / H - 0.5; }
    if (r > 0.6) { if (sobre) { sobre = false; document.body.classList.remove("sobre-prato"); dica.classList.remove("ver"); } return; }
    if (!TOQUE) { lx = e.clientX / W; ly = e.clientY / H; }
    pede();
    /* nome do prato so com mouse: com o dedo, o arraste da rolagem deixava a dica presa na tela */
    const n = e.pointerType === "mouse" && naoTexto(e.target) ? pratoSob(e.clientX, e.clientY) : null;
    if (!!n !== sobre) { sobre = !!n; document.body.classList.toggle("sobre-prato", sobre); dica.classList.toggle("ver", sobre); }
    if (n) { if (dica.textContent !== NOMES[n]) dica.textContent = NOMES[n]; dica.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`; }
  }, { passive: true });
  addEventListener("pointerdown", (e) => { if (TOQUE && r < 0.6) { lx = e.clientX / W; ly = e.clientY / H; pede(); } }, { passive: true });
  /* ir ate um prato para no meio da parada (camera ja assentada), nao no topo da secao */
  const irPara = (i) => { const m = marcos[i]; if (m) scrollTo({ top: (m.y0 + m.y1) / 2, behavior: CALMO ? "auto" : "smooth" }); };
  addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#p-"]');
    if (a) { const i = Object.values(ANCORA).indexOf(a.getAttribute("href").slice(1)); if (i >= 0) { e.preventDefault(); history.replaceState(null, "", a.getAttribute("href")); irPara(i + 1); } return; }
    if (!naoTexto(e.target)) return;
    /* parado num prato: clicar no caldo faz onda e balanca; clicar na panela balanca o caldo */
    const arrastou = Math.hypot(e.clientX - desceuX, e.clientY - desceuY) > 6; // fim de uma mexida: nao conta como batida
    if (naParada()) {
      if (arrastou || segurouMs > 350) return; // fim de uma mexida ou de uma fervura: nao e batida
      if (!CALMO) { const c = empanadoSob(e.clientX, e.clientY); if (c) { pulaEmpanado(c); pede(); return; } } // toque num empanado: pula
      if (!CALMO) { const c = camaraoSob(e.clientX, e.clientY); if (c) { pulaCamarao(c); pede(); return; } } // toque num camarao: pula e cai no molho
      if (!CALMO && pontoComida(e.clientX, e.clientY)) { pula(pComida.x, pComida.z); pede(); return; } // toque no bacalhau: pula
      { const bb = !CALMO && bolinhaSob(e.clientX, e.clientY); if (bb) { bomba = bb; if (!bb.seq && mergulho("casa", bb)) som.tok(); pede(); return; } }
      const a = !CALMO && alcaSob(e.clientX, e.clientY);
      if (a) { if (a.p.ang < 0.005) a.p.dir.set(a.dx, a.dz); a.p.auto = 0.8; som.tok(); pede(); return; } // toque na alca: inclina e solta
      if (tocaCaldo(e.clientX, e.clientY, 1.6, true) || tocaPanela(e.clientX, e.clientY)) { som.tok(); pede(); return; }
    }
    const n = pratoSob(e.clientX, e.clientY);
    if (n) { som.tok(); irPara(PRATOS.indexOf(n) + 1); }
  });
  document.getElementById("form-reserva")?.addEventListener("change", () => { sel = escolhidos(); pede(); });
  let tRs; addEventListener("resize", () => { clearTimeout(tRs); tRs = setTimeout(() => { monta(); rolou = true; }, 120); });
  addEventListener("load", () => { monta(); rolou = true; });
  document.fonts?.ready.then(() => { monta(); rolou = true; });

  /* cardapio e casa cobrem a mesa: nao desenha o que ninguem ve */
  const vis = new Set();
  const ob = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? vis.add(e.target) : vis.delete(e.target); visivel = vis.size > 0; pede(); });
  ["abertura", "pratos", "reservar"].forEach((id) => ob.observe(document.getElementById(id)));

  const pos = new THREE.Vector3(), alvo = new THREE.Vector3();
  const offO = new THREE.Vector3(), alvoO = new THREE.Vector3(), eixoO = new THREE.Vector3(), qO = new THREE.Quaternion(), qO2 = new THREE.Quaternion();
  let tUlt = null;
  /* foco da lente: parado num prato, foca nele; com o mouse em cima de outro prato ao fundo, o foco corre ate la
     (como um foquista de cinema); andando entre pratos, segue o ponto para onde a camera olha.
     Na abertura (vista de cima) quase sem desfoque; na reserva, desfoque menor */
  const pFoco = new THREE.Vector3(), planoComida = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.035);
  function ajustaLente(dtd) {
    camera.updateMatrixWorld();
    const k = Math.round(r), parado = k >= 1 && k <= 4 && Math.abs(r - k) < 0.35;
    pFoco.copy(alvo);
    if (parado) {
      pFoco.copy(CENTROS[PRATOS[k - 1]]);
      // ponto da mesa (na altura da comida) embaixo do cursor: se cai em algum prato, mesmo cortado na borda, foca ali
      if (!TOQUE && cursorX >= 0 && !segura && !arrasto && !(bomba && bomba.pega)) {
        ndc.set((cursorX / W) * 2 - 1, -(cursorY / H) * 2 + 1);
        raio3d.setFromCamera(ndc, camera);
        if (raio3d.ray.intersectPlane(planoComida, q3)) {
          for (const n of PRATOS) { const c = CENTROS[n]; if (Math.hypot(q3.x - c.x, q3.z - c.z) < 0.19) { pFoco.copy(q3); break; } }
        }
      }
    }
    const zAlvo = -tmp.copy(pFoco).applyMatrix4(camera.matrixWorldInverse).z; // distancia ao longo do olhar (a mesma da profundidade)
    const kBase = 0.022 * canvas.height;
    const fator = r < 1 ? 0.2 + 0.8 * liso(r) : r > 4 ? 1 - 0.4 * liso(r - 4) : 1;
    const kAlvo = kBase * fator;
    if (!lenteFoco || CALMO) { lenteFoco = zAlvo; lenteK = kAlvo; }
    const andando = Math.abs(destino - r) > 0.01;
    lenteFoco += (zAlvo - lenteFoco) * (1 - Math.exp(-dtd * (andando ? 10 : 4)));
    lenteK += (kAlvo - lenteK) * (1 - Math.exp(-dtd * 4));
    if (Math.abs(zAlvo - lenteFoco) > 0.002 * zAlvo || Math.abs(kAlvo - lenteK) > 0.05) pede(); // foco ainda correndo: continua desenhando
    matDof.uniforms.uFoco.value = lenteFoco;
    matDof.uniforms.uK.value = lenteK;
  }
  function desenha(t, dt) {
    const dtd = tUlt === null ? 0 : Math.min(0.1, Math.max(0, t - tUlt)); tUlt = t; // tempo desde o ultimo desenho (o vapor anda a 30 quadros)
    const u = r / (chaves.length - 1);
    curvaP.getPoint(u, pos); curvaT.getPoint(u, alvo);
    const i = Math.min(chaves.length - 2, Math.floor(r)), f = r - i, a = chaves[i], b = chaves[i + 1], e = liso(f);
    camera.fov = a.fov + (b.fov - a.fov) * e;
    const ox = a.ox + (b.ox - a.ox) * e, oy = a.oy + (b.oy - a.oy) * e;
    px += (mx - px) * (1 - Math.exp(-dt * 3)); py2 += (my - py2) * (1 - Math.exp(-dt * 3));
    camera.position.copy(pos); camera.position.x += px * 0.022; camera.position.y -= py2 * 0.014;
    camera.up.copy(a.up || CIMA).lerp(b.up || CIMA, e).normalize();
    camera.lookAt(alvo);
    /* girar em volta do prato parado (arrastar no fundo): gira a posicao e o alvo da camera em volta do centro do prato */
    const kO = Math.round(r), pesoO = kO >= 1 && kO <= 4 ? liso(1 - Math.abs(r - kO) / 0.4) : 0;
    orbita.yaw += (orbita.ay - orbita.yaw) * (1 - Math.exp(-dtd * 8)); orbita.pitch += (orbita.ap - orbita.pitch) * (1 - Math.exp(-dtd * 8));
    if (Math.abs(orbita.ay - orbita.yaw) + Math.abs(orbita.ap - orbita.pitch) > 1e-4) pede();
    if (pesoO > 0 && Math.abs(orbita.yaw) + Math.abs(orbita.pitch) > 1e-5) {
      const P = CENTROS[PRATOS[kO - 1]];
      offO.copy(camera.position).sub(P);
      qO.setFromAxisAngle(CIMA, orbita.yaw * pesoO);
      eixoO.crossVectors(offO, CIMA).normalize();
      qO2.setFromAxisAngle(eixoO, orbita.pitch * pesoO); qO.premultiply(qO2);
      camera.position.copy(P).add(offO.applyQuaternion(qO));
      alvoO.copy(alvo).sub(P).applyQuaternion(qO).add(P);
      camera.lookAt(alvoO);
    }
    camera.setViewOffset(W, H, W * ox, H * oy, W, H);
    camera.updateProjectionMatrix();
    for (const f of fumos) {
      const d = f.userData, u = f.material.uniforms;
      f.rotation.y = Math.atan2(camera.position.x - f.position.x, camera.position.z - f.position.z); // de frente para a camera
      // visto de cima o vapor quase some (nao cobre os pratos na abertura); de lado aparece
      const dir = tmp.copy(camera.position).sub(f.position).normalize();
      const lado = 0.25 + 0.75 * liso((1 - Math.abs(dir.y)) / 0.55);
      // o cursor perto da coluna de vapor empurra o vapor para o outro lado
      let alvoVento = 0;
      const p = naTela(f.position);
      if (p && cursorX >= 0) { const dx = p[0] - cursorX, raio = Math.min(W, H) * 0.2; if (Math.abs(dx) < raio && Math.abs(p[1] - cursorY) < raio * 1.6) alvoVento = Math.sign(dx || 1) * 0.045 * (1 - Math.abs(dx) / raio); }
      d.vento += (alvoVento - d.vento) * (1 - Math.exp(-dt * 2.5));
      // fogo alto: mais vapor, subindo mais rapido e mais alto
      const fogo = caldos.find((c) => c.prato === d.prato)?.fogo || 0;
      d.tempo = (d.tempo || 0) + dtd * (1 + 0.9 * fogo);
      f.scale.y = 1 + 0.3 * fogo;
      u.uT.value = d.tempo + d.fase; u.uVento.value = d.vento; u.uOp.value = d.op * lado * (d.pronto || 0) * (1 + 1.2 * fogo);
    }

    // abertura: um pendente de luz segue o cursor (no celular, passeia sozinho ou segue o dedo)
    const foco = 1 - liso(r / 0.55);
    const R = Math.max(W, H) * 0.55;
    poe(sombra, lx * W, ly * H, R * SOMBRA_EXT * 2, foco);
    poe(brilho, lx * W, ly * H, R * 0.7, 0.13 * foco);
    // reserva: os pratos escolhidos ficam acesos, os outros recuam no escuro
    const naReserva = sel.size ? liso((r - 4.6) / 0.35) : 0;
    const Rr = Math.min(W, H) * 0.48;
    for (const n of PRATOS) {
      const p = naReserva > 0 ? naTela(CENTROS[n]) : null, c = reserva[n];
      if (!p) { c.apaga.visible = c.acende.visible = false; continue; }
      poe(c.apaga, p[0], p[1], Rr, sel.has(n) ? 0 : naReserva);
      poe(c.acende, p[0], p[1], Rr, sel.has(n) ? 0.24 * naReserva : 0);
    }

    if (rtCena) {
      ajustaLente(dtd);
      renderer.setRenderTarget(rtCena); renderer.clear(); renderer.render(scene, camera);
      renderer.setRenderTarget(null); renderer.clear(); renderer.render(cenaDof, camera);
    } else {
      renderer.clear();
      renderer.render(scene, camera);
    }
    renderer.render(hud, hudCam);
    posicionaPontos(destino);
  }

  /* o aparelho continua lento mesmo com a nitidez no minimo: desce um nivel. Primeiro tira o foco de lente (o mais caro);
     depois desenha e simula so parte dos graos de arroz e dos fios de palha */
  let rebaixado = false, ultimoTesteCursor = 0;
  function baixaNivel() {
    somaT = 0; nT = 0;
    if (rtCena) { rtCena.dispose(); rtCena = null; NIVEL = Math.min(NIVEL, 1); console.info("mesa: sem foco de lente (aparelho lento)"); return; }
    if (rebaixado) return;
    rebaixado = true; NIVEL = 0;
    for (const e of caldos) for (const g of e.graos) if (g.m.count > 1000) { g.n = g.m.count = g.sombra.count = Math.ceil(g.m.count * 0.6); }
    if (soltos) {
      const palha = soltos.malhas[0];
      if (palha?.isInstancedMesh) { const novo = Math.ceil(palha.count * 0.6); for (let i = novo; i < palha.count; i++) soltos.oculto[i] = 1; palha.count = novo; }
    }
    console.info("mesa: menos graos e fios (aparelho lento)");
    pede();
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora;
    if (document.hidden || !visivel) return;
    if (rolou) { rolou = false; destino = rotaEm(scrollY); if (Math.abs(destino - r) > 0.05) { orbita.ay = 0; orbita.ap = 0; } } // saiu do prato: a camera volta para a rota
    const antes = r;
    r = CALMO ? destino : r + (destino - r) * (1 - Math.exp(-dt * 5));
    if (Math.abs(destino - r) < 0.0004) r = destino;
    const andou = r !== antes;
    if (andou) {
      som.cozinha(r);
      const parada = Math.round(r);
      if (Math.abs(r - parada) < 0.02 && parada !== ultimaParada) { ultimaParada = parada; if (parada >= 1 && parada <= 4) som.tim(); }
    }
    const passeia = TOQUE && !CALMO && r < 0.6;
    if (passeia) { lx = 0.5 + Math.sin(agora / 2600) * 0.22; ly = 0.42 + Math.cos(agora / 3400) * 0.14; }
    const mexendo = andou || Math.abs(mx - px) > 0.001 || Math.abs(my - py2) > 0.001;
    for (let i = entrando.length - 1; i >= 0; i--) {
      const e = entrando[i], k = CALMO ? 1 : liso((agora - e.t0) / 900);
      for (const m of e.mats) { m.emissiveIntensity = m.userData.alvoE * k; m.envMapIntensity = m.userData.alvoEnv * k; }
      if (e.filme) e.filme.mat.uniforms.uAlfa.value = k;
      if (camaroes && camaroes.prato === e.prato) { camaroes.alfa = k; camaroes.mexendo = true; }
      if (empanados && empanados.prato === e.prato) empanados.alfa = k;
      for (const f of fumos) if (f.userData.prato === e.prato) f.userData.pronto = k;
      if (k >= 1) entrando.splice(i, 1);
      sujo = true;
    }
    if (ptrMudou) {
      ptrMudou = false; tocaCaldo(ptrX, ptrY, 0.8);
      // cursor de "pegar" em cima de algo que da para pegar; os testes de raio rodam no maximo a cada 50 ms
      if (agora - (ultimoTesteCursor || 0) > 50) {
        ultimoTesteCursor = agora;
        const naAlca = !CALMO && !TOQUE && !arrasto && !(bomba && bomba.pega) && cursorX >= 0 && naParada() > 0 && (!!alcaSob(cursorX, cursorY) || !!bolinhaSob(cursorX, cursorY) || !!pontoComida(cursorX, cursorY) || !!camaraoSob(cursorX, cursorY) || !!empanadoSob(cursorX, cursorY));
        if (naAlca !== sobreAlca) { sobreAlca = naAlca; document.body.classList.toggle("sobre-alca", naAlca); }
      }
    }
    /* segurando parado no molho (sem arrastar): depois de um quarto de segundo o fogo comeca a subir */
    if (segura) {
      if (Math.hypot(ptrX - segura.x, ptrY - segura.y) > 14) segura.mexeu = true;
      segura.est.fogoAlvo = naParada() && !segura.mexeu && agora - segura.t0 > 260 ? 1 : 0;
    }
    seguePega(dt);
    const liquido = fisicaInclina(dt) | fisicaRespingos(Math.min(dt, 1 / 30)) | fisicaBomba(Math.min(dt, 1 / 20)) | fisicaSoltos(Math.min(dt, 1 / 30)) | fisicaCamaroes(Math.min(dt, 1 / 30)) | fisicaEmpanados(Math.min(dt, 1 / 30)) | fisicaCaldos(dt) | fisicaGraos(Math.min(dt, 1 / 30)); // algo se mexendo: desenha em todo quadro
    let fo = 0, fc = 0;
    for (const e of caldos) if (e.c.oleo) fo = Math.max(fo, e.fogo); else fc = Math.max(fc, e.fogo);
    som.ferve(fo, fc);
    acumula += dt;
    const anima = (fumos.length > 0 || caldos.length > 0 || passeia) && acumula >= 1 / 30; // parado, so vapor e calor animam, a 30 quadros
    if (!(mexendo || sujo || anima || liquido)) return;
    acumula = 0; sujo = false;
    desenha(agora / 1000, dt);
    /* so conta quadros seguidos de verdade: pausas do navegador (aba ou janela escondida) nao sao lentidao */
    if (mexendo && dt < 0.06) {
      somaT += dt; nT++;
      if (nT >= 60) {
        if (somaT / nT > 1 / 38 && dpr > DPR_MIN) { dpr = Math.max(DPR_MIN, dpr * 0.85); dimensiona(); }
        else if (somaT / nT > 1 / 30 && dpr <= DPR_MIN) baixaNivel(); // ja no minimo de nitidez e ainda lento: tira efeitos
        /* quadros voltaram ao normal (a queda era o navegador segurando a janela): devolve a nitidez */
        else if (somaT / nT < 1 / 55 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr / 0.85); dimensiona(); }
        somaT = 0; nT = 0;
      }
    }
  }

  monta();
  r = destino = rotaEm(scrollY);
  /* a mesa acende assim que a madeira e o prato heroi chegam; os outros acendem ao chegar */
  const t0 = performance.now();
  if (mesaTex) renderer.initTexture(mesaTex);
  await renderer.compileAsync(scene, camera);
  const todos = PRATOS.map((p) => carrega(p).catch((e) => console.warn("prato", p, e)));
  await Promise.race([todos[0], new Promise((ok) => setTimeout(ok, 8000))]);
  canvas.classList.add("pronta");
  monta();
  requestAnimationFrame(quadro);
  carga.classList.add("fim");
  window.__mesa = { renderer, scene, camera, rota: () => r, primeiro: Math.round(performance.now() - t0), escolha: () => [...sel],
    caldos, toca: (x, y) => tocaCaldo(x, y, 1.6, true), panela: (x, y) => tocaPanela(x, y), fisica: (dt) => fisicaCaldos(dt),
    mexe: (x, y, botao = true) => { botaoMouse = botao; const r0 = tocaCaldo(x, y, 0.8); botaoMouse = false; return r0; }, fisicaGraos: (dt) => fisicaGraos(dt),
    lente: () => ({ foco: lenteFoco, k: lenteK, ativa: !!rtCena }),
    nivel: () => ({ nivel: NIVEL, gpu: GPU, foco: !!rtCena, rebaixado, dprMax: DPR_MAX, fracao: FRACAO }), baixaNivel: () => baixaNivel(),
    empanados: () => empanados, pulaEmpanado: (i) => pulaEmpanado(empanados.lista[i]), fisicaEmpanados: (dt) => fisicaEmpanados(dt), empanadoSob: (x, y) => empanadoSob(x, y),
    orbita: () => orbita, respingos: () => respingos.length,
    camaroes: () => camaroes, camaraoSob: (x, y) => camaraoSob(x, y), pulaCamarao: (i) => pulaCamarao(camaroes.lista[i]), fisicaCamaroes: (dt) => fisicaCamaroes(dt),
    soltos: () => soltos, pula: (x, z) => pula(x, z), garfo: (x, z) => garfo(x, z), fisicaSoltos: (dt) => fisicaSoltos(dt), pontoComida: (x, y) => pontoComida(x, y),
    mergulho: (i) => mergulho("casa", i === undefined ? bomba : bombas[i]), bomba: () => bomba, bombas, bolinha: (x, y) => bolinhaSob(x, y), fisicaBomba: (dt) => fisicaBomba(dt),
    ferve: (prato, v) => { const e = caldos.find((c) => c.prato === prato); if (e) e.fogoAlvo = v; }, inclinaveis, alca: (x, y) => alcaSob(x, y), fisicaInclina: (dt) => fisicaInclina(dt),
    salta: () => { destino = r = rotaEm(scrollY); px = mx; py2 = my; desenha(performance.now() / 1000, 0); } }; // para testes: camera direto no destino
  Promise.allSettled(todos).then(async () => {
    window.__mesa.pronto = Math.round(performance.now() - t0);
    /* computador com placa folgada: depois de tudo pronto, troca a comida pela versao 4K (luz e relevo), uma textura por quadro */
    const folga = NIVEL === 2 && renderer.capabilities.maxTextureSize >= 8192 && (navigator.deviceMemory || 8) >= 8;
    if (!folga) return;
    const mats = [];
    scene.traverse((o) => { if (o.isMesh && ["comida", "base"].includes(o.material.userData.parte)) mats.push(o.material); });
    let trocadas = 0;
    for (const m of mats) {
      const n = m.userData.nome;
      const [l, nm] = await Promise.all([tex(`${n}-cor-4k.webp`, true), m.userData.parte === "comida" ? tex(`${n}-normal-4k.webp`, false) : null]);
      for (const [chave, t] of [["emissiveMap", l], ["normalMap", nm]]) {
        if (!t) continue;
        await sobe([t]);
        const velha = m[chave]; m[chave] = t; velha?.dispose(); trocadas++;
        pede();
      }
    }
    window.__mesa.texturas4k = trocadas;
  });
}
