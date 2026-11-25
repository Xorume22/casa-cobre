// Casa Cobre: a viagem pela mesa renderizada no Blender (Cycles), quadro a quadro, conduzida pela rolagem.
// Por cima: vapor, a luz que segue o cursor na abertura, os pratos clicaveis, os ingredientes e a mesa montada na reserva.
// Desempenho: os quadros ficam guardados comprimidos e so os vizinhos da camera ficam decodificados (fora da linha principal);
// as luzes sao imagens prontas (sem misturas caras); a tela so e redesenhada quando algo muda.
import * as som from "./som.js";

const CALMO = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOQUE = matchMedia("(pointer: coarse)").matches;
const NOMES = { heroi: "Camarão empanado", alho: "Camarão ao alho", bacalhau: "Bacalhau à Brás", bombinha: "Bombinha de camarão" };
const ANCORA = { heroi: "p-empanado", alho: "p-alho", bacalhau: "p-bacalhau", bombinha: "p-bombinha" };
const PRATOS = Object.keys(NOMES);
const liso = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const BITMAP = typeof createImageBitmap === "function";

/* luzes prontas: desenhadas uma vez, depois so carimbadas (drawImage) */
function sprite(tam, paradas) {
  const c = document.createElement("canvas");
  c.width = c.height = tam;
  const x = c.getContext("2d"), g = x.createRadialGradient(tam / 2, tam / 2, 0, tam / 2, tam / 2, tam / 2);
  for (const [o, cor] of paradas) g.addColorStop(o, cor);
  x.fillStyle = g; x.fillRect(0, 0, tam, tam);
  return c;
}
// sombra da abertura: claro no centro, escurece ate 40% do raio e fica escuro dali para fora (cobre a tela toda)
const SOMBRA_EXT = 2.5;
const SOMBRA = sprite(512, [[0.12 / SOMBRA_EXT, "rgba(16,7,3,0)"], [1 / SOMBRA_EXT, "rgba(16,7,3,.62)"], [1, "rgba(16,7,3,.62)"]]);
const BRILHO = sprite(256, [[0, "rgba(255,200,150,1)"], [1, "rgba(255,200,150,0)"]]);
const FUMO = sprite(128, [[0, "rgba(255,242,228,1)"], [1, "rgba(255,242,228,0)"]]);
const APAGA = sprite(256, [[0, "rgba(12,6,3,.8)"], [0.55, "rgba(12,6,3,.6)"], [1, "rgba(12,6,3,0)"]]);
const ACENDE = sprite(256, [[0, "rgba(255,190,130,1)"], [1, "rgba(255,190,130,0)"]]);

export async function iniciar({ canvas, carga, escolhidos }) {
  const c2 = canvas.getContext("2d", { alpha: false });
  const camada = document.getElementById("pontos");
  const dica = document.getElementById("dica-prato");
  let fmt = "", rota = null, r = 0, alvoR = 0, w = 0, h = 0, s = 1, sujo = true;
  let mx = -1, my = -1, lx = 0.5, ly = 0.45, ultimaParada = -1;
  let sel = escolhidos();
  const vapores = Array.from({ length: CALMO ? 0 : 10 }, (_, i) => ({ prato: i < 6 ? "heroi" : "alho", f: Math.random(), v: 0.07 + Math.random() * 0.05, dx: (Math.random() - 0.5) * 0.08, w: Math.random() * 6 }));

  /* ---------- quadros
     blobs: todos os quadros comprimidos (~50 KB cada). vivos: so os decodificados perto da camera (4 MB cada).
     As 6 paradas ficam sempre decodificadas, para um salto (clique num prato) ter imagem na hora. */
  let blobs = [], vivos = new Map(), pedidos = new Set(), paradas = new Set(), centro = 0;
  // celular: janela menor (cada quadro decodificado ocupa ~3,5 MB) => no maximo ~23 quadros vivos, ~80 MB
  const RAIO = TOQUE ? 6 : 10, FOLGA = TOQUE ? 2 : 3, MAX_PEDIDOS = 3;

  async function decodifica(blob) {
    if (BITMAP) return createImageBitmap(blob);
    const im = new Image(), url = URL.createObjectURL(blob);
    im.src = url;
    try { await im.decode(); } finally { URL.revokeObjectURL(url); }
    return im;
  }
  const solta = (im) => { if (im && im.close) im.close(); };

  function janela() {
    if (!rota) return;
    // solta o que ficou longe
    for (const [i, im] of vivos) if (!paradas.has(i) && Math.abs(i - centro) > RAIO + FOLGA) { solta(im); vivos.delete(i); }
    // pede os que faltam, do mais perto para o mais longe
    for (let d = 0; d <= RAIO && pedidos.size < MAX_PEDIDOS; d++) {
      for (const i of d ? [centro + d, centro - d] : [centro]) {
        if (i < 0 || i >= rota.quadros || vivos.has(i) || pedidos.has(i) || !blobs[i]) continue;
        if (pedidos.size >= MAX_PEDIDOS) break;
        pedidos.add(i);
        const meu = fmt;
        decodifica(blobs[i]).then((im) => {
          pedidos.delete(i);
          if (meu !== fmt || (!paradas.has(i) && Math.abs(i - centro) > RAIO + FOLGA)) { solta(im); }
          else { vivos.set(i, im); sujo = true; }
          janela();
        }, () => { pedidos.delete(i); });
      }
    }
  }

  async function carregaFormato() {
    const novo = innerHeight > innerWidth * 1.05 ? "m" : "d";
    if (novo === fmt) return false;
    fmt = novo;
    for (const im of vivos.values()) solta(im);
    vivos = new Map(); pedidos = new Set();
    rota = await (await fetch(`assets/quadros/${fmt}/rota.json`)).json();
    blobs = new Array(rota.quadros).fill(null);
    paradas = new Set(Array.from({ length: Math.floor((rota.quadros - 1) / rota.porTrecho) + 1 }, (_, k) => k * rota.porTrecho));
    const ordem = [], visto = new Set();
    for (const passo of [rota.porTrecho, 8, 4, 2, 1]) for (let i = 0; i < rota.quadros; i += passo) if (!visto.has(i)) { visto.add(i); ordem.push(i); }
    const meu = fmt;
    const um = (i) => fetch(`assets/quadros/${fmt}/${String(i).padStart(4, "0")}.webp`).then((q) => q.blob()).then((b) => { if (meu === fmt) { blobs[i] = b; } }, () => {});
    // as paradas primeiro (decodificadas ja), depois o resto, 4 de cada vez
    const prim = ordem.slice(0, paradas.size);
    await Promise.all(prim.map(um));
    await Promise.all(prim.map(async (i) => { if (blobs[i]) vivos.set(i, await decodifica(blobs[i])); }));
    (async () => {
      for (let k = prim.length; k < ordem.length; k += 4) {
        if (meu !== fmt) return;
        await Promise.all(ordem.slice(k, k + 4).map(um));
        janela();
      }
    })();
    return true;
  }

  /* ---------- rolagem -> posicao na rota (0 abertura, 1..4 pratos, 5 reserva) */
  let marcos = [];
  function mede() {
    const H = innerHeight, py = scrollY;
    const seg = (id) => { const el = document.getElementById(id); return { a: el.getBoundingClientRect().top + py, h: el.offsetHeight }; };
    marcos = [{ y0: 0, y1: H * 0.12, r: 0 }];
    Object.values(ANCORA).forEach((id, i) => { const sg = seg(id); marcos.push({ y0: sg.a + sg.h * 0.24, y1: sg.a + sg.h * 0.74 - H * 0.2, r: i + 1 }); });
    const res = seg("reservar");
    marcos.push({ y0: res.a - H * 0.2, y1: res.a + res.h, r: 5 });
  }
  function rotaEm(y) {
    if (y <= marcos[0].y1) return 0;
    for (let i = 1; i < marcos.length; i++) {
      const m = marcos[i];
      if (y <= m.y1) return y >= m.y0 ? m.r : marcos[i - 1].r + liso((y - marcos[i - 1].y1) / (m.y0 - marcos[i - 1].y1)) * (m.r - marcos[i - 1].r);
    }
    return 5;
  }

  /* ---------- enquadramento "cover" do quadro na tela, e o mesmo para os pontos.
     A tela interna nao passa da resolucao dos quadros: mais pixels so custariam tempo, sem ganhar nitidez. */
  let ox = 0, oy = 0, esc = 1;
  function dimensiona() {
    w = canvas.clientWidth || innerWidth; h = canvas.clientHeight || innerHeight;
    esc = Math.max(w / rota.w, h / rota.h);
    ox = (w - rota.w * esc) / 2; oy = (h - rota.h * esc) / 2;
    s = Math.min(Math.min(devicePixelRatio || 1, 2), Math.max(0.7, 1 / esc));
    const cw = Math.round(w * s), ch = Math.round(h * s);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    chavePontos = "";
    sujo = true;
  }
  const tela = (p) => [ox + p[0] * rota.w * esc, oy + p[1] * rota.h * esc];
  const quadroPerto = (i) => { if (vivos.has(i)) return vivos.get(i); for (let d = 1; d < rota.quadros; d++) { if (vivos.has(i - d)) return vivos.get(i - d); if (vivos.has(i + d)) return vivos.get(i + d); } return null; };

  /* vapor so perto dos pratos quentes (empanado, alho) e na reserva; entre eles some aos poucos */
  const forcaVapor = () => vapores.length ? Math.max(1 - liso((r - 2.4) / 0.5), liso((r - 4.4) / 0.4)) : 0;

  function desenha(t) {
    const f = Math.min(rota.quadros - 1, Math.max(0, r * rota.porTrecho));
    const i0 = Math.floor(f), i1 = Math.min(rota.quadros - 1, i0 + 1), k = f - i0;
    const a = quadroPerto(i0), b = vivos.get(i1);
    if (!a) return;
    const iw = rota.w * esc, ih = rota.h * esc;
    c2.setTransform(s, 0, 0, s, 0, 0);
    c2.globalCompositeOperation = "source-over";
    c2.globalAlpha = 1;
    c2.drawImage(a, ox, oy, iw, ih);
    if (b && k > 0.02 && b !== a) { c2.globalAlpha = k; c2.drawImage(b, ox, oy, iw, ih); c2.globalAlpha = 1; }
    const iq = Math.round(f), pr = rota.pratos[iq] || {};

    // vapor sobre os pratos quentes (soma de luz: barato e parecido com "screen" em baixa intensidade)
    const fv = forcaVapor();
    if (fv > 0.01) {
      c2.globalCompositeOperation = "lighter";
      for (const v of vapores) {
        const p = pr[v.prato]; if (!p) continue;
        const perto = Math.max(0.35, 1 - Math.abs(r - (v.prato === "heroi" ? 1 : 2)) / 1.2);
        const [x, y] = tela(p), base = Math.min(w, h) * (0.06 + 0.16 * perto * (r > 0.5 ? 1 : 0.3));
        const q = (v.f + t * v.v) % 1;
        const px = x + (v.dx + Math.sin(t * 0.8 + v.w) * 0.03 * (1 + q)) * base * 4, py = y - q * base * 2.6;
        const raio = base * (0.35 + q * 0.9);
        c2.globalAlpha = Math.sin(q * Math.PI) * 0.075 * perto * fv;
        c2.drawImage(FUMO, px - raio, py - raio, raio * 2, raio * 2);
      }
      c2.globalCompositeOperation = "source-over"; c2.globalAlpha = 1;
    }

    // abertura: um pendente de luz segue o cursor (no celular, passeia sozinho ou segue o dedo)
    const foco = 1 - liso(r / 0.55);
    if (foco > 0.01) {
      const cx = lx * w, cy = ly * h, R = Math.max(w, h) * 0.55, E = R * SOMBRA_EXT;
      c2.globalAlpha = foco; c2.drawImage(SOMBRA, cx - E, cy - E, E * 2, E * 2);
      const R2 = R * 0.35;
      c2.globalCompositeOperation = "lighter"; c2.globalAlpha = 0.13 * foco; c2.drawImage(BRILHO, cx - R2, cy - R2, R2 * 2, R2 * 2);
      c2.globalCompositeOperation = "source-over"; c2.globalAlpha = 1;
    }

    // reserva: os pratos escolhidos ficam acesos, os outros recuam no escuro
    const naReserva = liso((r - 4.6) / 0.35);
    if (sel.size && naReserva > 0) {
      const R = Math.min(w, h) * 0.24;
      for (const n of PRATOS) {
        const p = pr[n]; if (!p) continue;
        const [x, y] = tela(p);
        if (sel.has(n)) { c2.globalCompositeOperation = "lighter"; c2.globalAlpha = 0.24 * naReserva; c2.drawImage(ACENDE, x - R, y - R, R * 2, R * 2); }
        else { c2.globalCompositeOperation = "source-over"; c2.globalAlpha = naReserva; c2.drawImage(APAGA, x - R, y - R, R * 2, R * 2); }
      }
      c2.globalCompositeOperation = "source-over"; c2.globalAlpha = 1;
    }
    posicionaPontos(iq);
  }

  /* ---------- ingredientes: botoes no lugar certo do prato, so com a camera parada (so mexe no DOM quando muda) */
  const botoes = new Map();
  let chavePontos = "";
  function posicionaPontos(iq) {
    const parado = Math.abs(r - Math.round(r)) < 0.05 && Math.abs(alvoR - r) < 0.02;
    const pts = parado ? rota.pontos[iq] : null;
    const chave = pts ? `${iq}|${w}x${h}` : "-";
    if (chave === chavePontos) return;
    chavePontos = chave;
    const vistos = new Set();
    if (pts) for (const [nome, p] of Object.entries(pts)) {
      if (!p) continue;
      const id = Math.round(r) + nome;
      vistos.add(id);
      let b = botoes.get(id);
      if (!b) {
        b = document.createElement("button");
        b.type = "button"; b.className = "ponto"; b.setAttribute("aria-expanded", "false");
        b.innerHTML = `<span class="ponto-marca" aria-hidden="true"></span><span class="ponto-nome">${nome}</span>`;
        b.addEventListener("click", () => { const ab = b.getAttribute("aria-expanded") !== "true"; b.setAttribute("aria-expanded", String(ab)); som.tok(); });
        camada.appendChild(b); botoes.set(id, b);
        requestAnimationFrame(() => b.classList.add("ver"));
      }
      const [x, y] = tela(p);
      b.style.transform = `translate(${x}px, ${y}px)`;
    }
    for (const [id, b] of botoes) if (!vistos.has(id)) { b.remove(); botoes.delete(id); }
  }

  /* ---------- abertura: passar o cursor num prato mostra o nome; clicar leva a camera ate ele */
  function pratoSob(x, y) {
    if (r > 0.25 || !rota) return null;
    const pr = rota.pratos[0];
    let melhor = null, dmin = Math.min(w, h) * 0.14;
    for (const n of PRATOS) { const p = pr[n]; if (!p) continue; const [px, py] = tela(p); const d = Math.hypot(px - x, py - y); if (d < dmin) { dmin = d; melhor = n; } }
    return melhor;
  }
  const naoTexto = (el) => !el.closest("a, button, input, select, label, .topo, .trilho, .ficha, .cartao, .cardapio, .casa, .rodape, .abertura-txt, h1, .pratos-intro");
  let sobre = false;
  addEventListener("pointermove", (e) => {
    mx = e.clientX; my = e.clientY;
    if (r > 0.6) { if (sobre) { sobre = false; document.body.classList.remove("sobre-prato"); dica.classList.remove("ver"); } return; }
    if (!TOQUE) { lx = mx / w; ly = my / h; sujo = true; }
    const n = naoTexto(e.target) ? pratoSob(mx, my) : null;
    if (!!n !== sobre) { sobre = !!n; document.body.classList.toggle("sobre-prato", sobre); dica.classList.toggle("ver", sobre); }
    if (n) { if (dica.textContent !== NOMES[n]) dica.textContent = NOMES[n]; dica.style.transform = `translate(${mx + 16}px, ${my + 16}px)`; }
  }, { passive: true });
  addEventListener("pointerdown", (e) => { if (TOQUE && r < 0.6) { lx = e.clientX / w; ly = e.clientY / h; sujo = true; } }, { passive: true });
  /* ir ate um prato para no meio da parada (camera ja assentada), nao no topo da secao */
  const irPara = (i) => { const m = marcos[i]; if (m) scrollTo({ top: (m.y0 + m.y1) / 2, behavior: CALMO ? "auto" : "smooth" }); };
  addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#p-"]');
    if (a) { const i = Object.values(ANCORA).indexOf(a.getAttribute("href").slice(1)); if (i >= 0) { e.preventDefault(); history.replaceState(null, "", a.getAttribute("href")); irPara(i + 1); } return; }
    if (!naoTexto(e.target)) return;
    const n = pratoSob(e.clientX, e.clientY);
    if (n) { som.tok(); irPara(PRATOS.indexOf(n) + 1); }
  });

  let rolou = true;
  addEventListener("scroll", () => { rolou = true; }, { passive: true });
  /* no celular a barra de endereco muda a altura toda hora: so refaz o que mudou de verdade */
  let tRs, larg = innerWidth;
  addEventListener("resize", () => {
    clearTimeout(tRs);
    tRs = setTimeout(async () => {
      const mudouLargura = innerWidth !== larg; larg = innerWidth;
      if (await carregaFormato() || mudouLargura) chavePontos = "";
      dimensiona(); mede(); rolou = true;
    }, 150);
  });
  addEventListener("load", () => { mede(); rolou = true; });
  document.fonts?.ready.then(() => { mede(); rolou = true; });

  let ultimo = performance.now(), ultimoAnim = 0, visivel = true;
  const vis = new Set();
  const ob = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? vis.add(e.target) : vis.delete(e.target); visivel = vis.size > 0; sujo = true; });
  ["abertura", "pratos", "reservar"].forEach((id) => ob.observe(document.getElementById(id)));

  function quadro(agora) {
    requestAnimationFrame(quadro);
    const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora;
    if (document.hidden || !visivel || !rota) return;
    if (rolou) { rolou = false; alvoR = rotaEm(scrollY); }
    const antes = r;
    r = CALMO ? alvoR : r + (alvoR - r) * (1 - Math.exp(-dt * 6));
    if (Math.abs(alvoR - r) < 0.0005) r = alvoR;
    const mexeu = r !== antes;
    if (mexeu) {
      som.cozinha(r);
      const c = Math.round(Math.min(rota.quadros - 1, Math.max(0, r * rota.porTrecho)));
      if (c !== centro) { centro = c; janela(); }
      const parada = Math.round(r);
      if (Math.abs(r - parada) < 0.02 && parada !== ultimaParada) { ultimaParada = parada; if (parada >= 1 && parada <= 4) som.tim(); }
    }
    // so a animacao (vapor, luz passeando) sem a camera mexer: basta ~30 quadros por segundo
    const passeia = TOQUE && !CALMO && r < 0.6;
    const anima = forcaVapor() > 0.01 || passeia;
    if (mexeu || sujo || (anima && agora - ultimoAnim > 32)) {
      if (passeia) { lx = 0.5 + Math.sin(agora / 2600) * 0.22; ly = 0.42 + Math.cos(agora / 3400) * 0.14; }
      sujo = false; ultimoAnim = agora;
      desenha(agora / 1000);
    }
  }

  await carregaFormato();
  dimensiona();
  mede();
  r = alvoR = rotaEm(scrollY);
  centro = Math.round(r * rota.porTrecho); janela();
  canvas.classList.add("pronta");
  carga.classList.add("fim");
  requestAnimationFrame(quadro);
  window.__mesa = { rota: () => r, salta: () => { r = alvoR = rotaEm(scrollY); centro = Math.round(r * rota.porTrecho); janela(); desenha(performance.now() / 1000); }, carregados: () => blobs.filter(Boolean).length, vivos: () => vivos.size, escolha: () => [...sel] };
  /* escolher um prato na reserva redesenha a mesa na hora */
  document.getElementById("form-reserva")?.addEventListener("change", () => { sel = escolhidos(); sujo = true; });
}
