// Casa Cobre: sons sintetizados na hora (Web Audio), sem arquivos. Desligado ate a pessoa ligar.
// Salao ao fundo, chiado do alho na panelinha, crocancia da fritura, toque de madeira nos cliques e um "tim" de cobre ao chegar num prato.
let ctx = null, mestre = null, chiadoG = null, fritaG = null, chiadoFogoG = null, bolhaG = null, ligado = false, proximoTim = 0;

function ruido(seg, fn) {
  const n = Math.floor(ctx.sampleRate * seg), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  fn(d, n);
  return b;
}

function monta() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  mestre = ctx.createGain(); mestre.gain.value = 0; mestre.connect(ctx.destination);
  // salao: ruido marrom bem baixo e abafado
  const marrom = ruido(4, (d, n) => { let u = 0; for (let i = 0; i < n; i++) { u = (u + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = u * 3.2; } });
  const s1 = ctx.createBufferSource(); s1.buffer = marrom; s1.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
  const g1 = ctx.createGain(); g1.gain.value = 0.05;
  s1.connect(lp).connect(g1).connect(mestre); s1.start();
  // chiado: chiadeira aguda com estalos (oleo quente com alho)
  const chi = ruido(3, (d, n) => { for (let i = 0; i < n; i++) { let v = (Math.random() * 2 - 1) * 0.35; if (Math.random() < 0.0016) v += (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8); d[i] = v; } });
  const s2 = ctx.createBufferSource(); s2.buffer = chi; s2.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2400;
  const pk = ctx.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = 6200; pk.gain.value = 6;
  chiadoG = ctx.createGain(); chiadoG.gain.value = 0;
  s2.connect(hp).connect(pk).connect(chiadoG).connect(mestre); s2.start();
  // fritura recente: estalinhos esparsos, mais graves
  const fr = ruido(3, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) : d[i] * 0; });
  const s3 = ctx.createBufferSource(); s3.buffer = fr; s3.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.8;
  fritaG = ctx.createGain(); fritaG.gain.value = 0;
  s3.connect(bp).connect(fritaG).connect(mestre); s3.start();
  // fogo alto no oleo: mais chiado (mesmo ruido, outro volume)
  const s4 = ctx.createBufferSource(); s4.buffer = chi; s4.loop = true; s4.playbackRate.value = 1.13;
  const hp2 = ctx.createBiquadFilter(); hp2.type = "highpass"; hp2.frequency.value = 2000;
  chiadoFogoG = ctx.createGain(); chiadoFogoG.gain.value = 0;
  s4.connect(hp2).connect(chiadoFogoG).connect(mestre); s4.start();
  // creme fervendo: "blop" de bolha grossa estourando (seno curto que sobe de tom), em tempos ao acaso
  const blop = ruido(4, (d, n) => {
    const sr = ctx.sampleRate;
    for (let t0 = Math.floor(sr * 0.05); t0 < n; t0 += Math.floor(sr * (0.06 + Math.random() * 0.22))) {
      const f0 = 140 + Math.random() * 260, dur = 0.02 + Math.random() * 0.035, m = Math.floor(sr * dur), a = 0.35 + Math.random() * 0.65;
      let fase = 0;
      for (let i = 0; i < m && t0 + i < n; i++) {
        const x = i / m; fase += (2 * Math.PI * f0 * (1 + 1.6 * x)) / sr;
        d[t0 + i] += Math.sin(fase) * a * Math.sin(Math.PI * Math.min(1, x * 6)) * Math.exp(-x * 4);
      }
    }
  });
  const s5 = ctx.createBufferSource(); s5.buffer = blop; s5.loop = true;
  const lp5 = ctx.createBiquadFilter(); lp5.type = "lowpass"; lp5.frequency.value = 1400;
  bolhaG = ctx.createGain(); bolhaG.gain.value = 0;
  s5.connect(lp5).connect(bolhaG).connect(mestre); s5.start();
  agendaTalher();
}

/* um talher distante de vez em quando */
function agendaTalher() {
  setTimeout(() => { if (ligado) metal(2200 + Math.random() * 900, 0.012, 0.7); agendaTalher(); }, 5000 + Math.random() * 7000);
}

function metal(f, vol, dur) {
  const t = ctx.currentTime;
  for (const [k, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f * k; o.type = "sine";
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / Math.sqrt(k));
    o.connect(g).connect(mestre); o.start(t); o.stop(t + dur + 0.1);
  }
}

export function tok() {
  if (!ligado) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.07);
  g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(mestre); o.start(t); o.stop(t + 0.12);
}

export function tim() {
  if (!ligado || performance.now() < proximoTim) return;
  proximoTim = performance.now() + 900;
  metal(1320, 0.035, 1.6);
}

/* intensidade dos sons de cozinha conforme o prato que a camera esta vendo (r: posicao na rota) */
let ultChiado = -1, ultFrita = -1;
export function cozinha(r) {
  if (!ligado) return;
  const perto = (c, raio) => Math.max(0, 1 - Math.abs(r - c) / raio);
  // so agenda quando o volume muda de verdade (nao enche a linha do tempo do audio a cada quadro)
  const ch = Math.round(160 * perto(2, 0.7)) / 1000, fr = Math.round(500 * Math.max(perto(1, 0.6), perto(4, 0.6))) / 1000;
  const t = ctx.currentTime;
  if (ch !== ultChiado) { ultChiado = ch; chiadoG.gain.setTargetAtTime(ch, t, 0.25); }
  if (fr !== ultFrita) { ultFrita = fr; fritaG.gain.setTargetAtTime(fr, t, 0.25); }
}

/* fogo alto segurando no molho: oleo chia mais, creme faz "blop" (0 a 1 cada) */
let ultFogoO = -1, ultFogoC = -1;
export function ferve(oleo, creme) {
  if (!ligado) return;
  const o = Math.round(oleo * 20) / 20, c = Math.round(creme * 20) / 20, t = ctx.currentTime;
  if (o !== ultFogoO) { ultFogoO = o; chiadoFogoG.gain.setTargetAtTime(o * 0.24, t, 0.2); }
  if (c !== ultFogoC) { ultFogoC = c; bolhaG.gain.setTargetAtTime(c * 0.32, t, 0.2); }
}

/* panela de cobre pousando na madeira: baque abafado e um fio de metal (forca de 0 a 1) */
export function pousa(f) {
  if (!ligado) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  g.gain.setValueAtTime(0.22 * f, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(mestre); o.start(t); o.stop(t + 0.2);
  metal(780 + Math.random() * 120, 0.02 * f, 0.5);
}

/* bombinha entrando no molho: "plop" grave e abafado */
export function mergulha() {
  if (!ligado) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 900;
  o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.09);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(f).connect(g).connect(mestre); o.start(t); o.stop(t + 0.18);
}

/* gota de molho caindo no potinho: "plic" curto que sobe de tom */
export function pinga() {
  if (!ligado) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  const f0 = 700 + Math.random() * 500;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.1, t + 0.03);
  g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(mestre); o.start(t); o.stop(t + 0.08);
}

/* batata palha mexida ou pulando: estalinhos secos e agudos (forca de 0 a 1) */
export function croc(f) {
  if (!ligado || f <= 0) return;
  const t = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.18);
  const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let k = 0, q = 3 + Math.floor(f * 14); k < q; k++) {
    const t0 = Math.floor(Math.random() * n * 0.8), m = Math.floor(ctx.sampleRate * (0.002 + Math.random() * 0.004)), a = 0.4 + Math.random() * 0.6;
    for (let i = 0; i < m && t0 + i < n; i++) d[t0 + i] += (Math.random() * 2 - 1) * a * Math.exp(-i / (m * 0.3));
  }
  const s = ctx.createBufferSource(); s.buffer = b;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3800; bp.Q.value = 0.9;
  const g = ctx.createGain(); g.gain.value = 0.1 + 0.18 * f;
  s.connect(bp).connect(g).connect(mestre); s.start(t);
}

export function alterna() {
  if (!ctx) monta();
  ligado = !ligado;
  if (ligado) ctx.resume();
  mestre.gain.setTargetAtTime(ligado ? 1 : 0, ctx.currentTime, 0.3);
  return ligado;
}

export const estaLigado = () => ligado;
