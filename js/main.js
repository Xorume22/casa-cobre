// Casa Cobre: interface da pagina (entradas, trilho de pratos, som, reserva de demonstracao) e arranque da mesa.
import * as som from "./som.js";

const raiz = document.documentElement;

/* o nome entra letra a letra junto com a luz da mesa */
const h1 = document.querySelector(".abertura h1");
if (h1 && h1.firstChild && h1.firstChild.nodeType === 3) {
  const texto = h1.firstChild.textContent;
  const letras = document.createElement("span");
  letras.className = "letras";
  letras.setAttribute("aria-hidden", "true");
  [...texto].forEach((ch, i) => { const s = document.createElement("span"); s.textContent = ch; s.style.setProperty("--i", i); letras.appendChild(s); });
  h1.replaceChild(letras, h1.firstChild);
  const vh = h1.querySelector(".vh");
  if (vh) vh.textContent = texto + vh.textContent;
}

/* entradas: cada parte aparece uma vez ao chegar na tela */
const rev = document.querySelectorAll(".rev");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("ver"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  rev.forEach((el) => io.observe(el));
} else rev.forEach((el) => el.classList.add("ver"));

/* barra do topo ganha fundo nas partes de leitura; trilho marca o prato atual */
const topo = document.querySelector(".topo");
const trilho = document.getElementById("trilho");
const links = [...trilho.querySelectorAll("a")];
const pratos = [...document.querySelectorAll(".prato")];
const blocoPratos = document.getElementById("pratos");
const cheias = [document.getElementById("cardapio"), document.getElementById("casa")];
let pendente = false;
function atualiza() {
  pendente = false;
  const h = innerHeight, meio = h / 2;
  const b = blocoPratos.getBoundingClientRect();
  trilho.classList.toggle("ver", b.top < h * 0.35 && b.bottom > h * 0.6);
  let atual = -1;
  pratos.forEach((p, i) => { const r = p.getBoundingClientRect(); if (r.top <= meio && r.bottom > meio) atual = i; });
  links.forEach((a, i) => (i === atual ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
  topo.classList.toggle("cheia", cheias.some((s) => { const r = s.getBoundingClientRect(); return r.top <= 40 && r.bottom > 40; }));
}
addEventListener("scroll", () => { if (!pendente) { pendente = true; requestAnimationFrame(atualiza); } }, { passive: true });
addEventListener("resize", atualiza);
atualiza();

/* som: so liga quando a pessoa pede */
const botaoSom = document.getElementById("som");
botaoSom.addEventListener("click", () => {
  const on = som.alterna();
  botaoSom.setAttribute("aria-pressed", String(on));
  botaoSom.textContent = on ? "Som ligado" : "Som";
  som.tok();
});
document.addEventListener("click", (e) => { if (e.target.closest("a, .botao, .trilho a, .escolhas input")) som.tok(); });

/* reserva de demonstracao: monte a mesa (os pratos escolhidos acendem na cena) e confira; nada sai do navegador */
const form = document.getElementById("form-reserva");
const ok = document.getElementById("r-ok");
const data = document.getElementById("r-data");
const escolhas = [...form.querySelectorAll('input[name="prato"]')];
const NOMES = { heroi: "camarão empanado", alho: "camarão ao alho", bacalhau: "bacalhau à Brás", bombinha: "bombinha de camarão" };
const escolhidos = () => new Set(escolhas.filter((c) => c.checked).map((c) => c.value));
const hoje = new Date();
data.min = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const [a, m, d] = data.value.split("-");
  const n = Number(form.pessoas.value);
  const lista = [...escolhidos()].map((k) => NOMES[k]);
  const pedido = lista.length ? ` Na mesa: ${lista.length > 1 ? lista.slice(0, -1).join(", ") + " e " + lista.at(-1) : lista[0]}.` : "";
  ok.textContent = `Mesa para ${n} ${n === 1 ? "pessoa" : "pessoas"} em ${d}/${m}/${a}, às ${form.hora.value}.${pedido}`;
  som.tim();
});

/* a mesa: quadros renderizados no Blender; se algo falhar, a pagina segue com as fotos */
const carga = document.getElementById("carga");
/* a mesa e o modelo 3D em tempo real; ?quadros abre a versao antiga de quadros renderizados, so para comparar */
import(location.search.includes("quadros") ? "./sequencia.js" : "./mesa3d.js")
  .then((m) => m.iniciar({ canvas: document.getElementById("mesa"), carga, escolhidos }))
  .catch((e) => {
    console.warn("mesa indisponivel:", e);
    raiz.classList.add("sem-3d");
    carga.classList.add("fim");
  });
