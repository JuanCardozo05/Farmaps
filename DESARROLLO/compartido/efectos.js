/* ==========================================================
   FARMAPS - Efectos compartidos de interfaz
   - Sombra de la barra superior al desplazarse.
   - Onda al pulsar botones.
   - Aparición escalonada del contenido que llega de Firestore.
   - Aparición al desplazarse (si el navegador lo admite).
   - Conteo animado de los indicadores numéricos.
   Nada de esto cambia datos ni comportamiento de las páginas.
   ========================================================== */

const reducir = window.matchMedia("(prefers-reduced-motion: reduce)");
const raiz = document.documentElement;
const conScroll = window.CSS?.supports?.("animation-timeline: view()") ?? false;

/* ---------- Barra superior ---------- */
let pendienteScroll = false;
function revisarScroll() {
  raiz.classList.toggle("fx-desplazado", window.scrollY > 8);
  pendienteScroll = false;
}
window.addEventListener("scroll", () => {
  if (pendienteScroll) return;
  pendienteScroll = true;
  requestAnimationFrame(revisarScroll);
}, { passive: true });
revisarScroll();

/* ---------- Onda al pulsar ---------- */
const SELECTOR_ONDA = [
  ".btn", ".btn-edit", ".btn-icon", ".btn-public", ".chip", ".tabs__item", ".sort__btn",
  ".action", ".pager button", ".user-btn", ".back-btn", ".segment__item span"
].join(",");

document.addEventListener("pointerdown", (e) => {
  if (reducir.matches || e.button !== 0) return;
  const el = e.target.closest?.(SELECTOR_ONDA);
  if (!el || el.disabled || el.matches(".btn--disabled, [aria-disabled='true'], input, select, textarea")) return;

  const caja = el.getBoundingClientRect();
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  const capa = document.createElement("span");
  capa.className = "fx-onda";
  capa.setAttribute("aria-hidden", "true");
  const punto = document.createElement("span");
  punto.style.left = `${e.clientX - caja.left}px`;
  punto.style.top = `${e.clientY - caja.top}px`;
  punto.style.setProperty("--fx-escala", String(Math.ceil(Math.hypot(caja.width, caja.height) / 5)));
  capa.appendChild(punto);
  el.appendChild(capa);
  setTimeout(() => capa.remove(), 650);
}, { passive: true });

/* ---------- Aparición al desplazarse ---------- */
const SELECTOR_REVELAR = [
  ".pg-p01 .card", ".pg-p01 .stats", ".pg-p02 .pres", ".pg-p02 .callout",
  ".pg-p03 .offer", ".pg-p03 .disclaimer", ".pg-p05 .warning"
].join(",");

/** Solo se aplica a lo que aún no se ve, para que nada parpadee. */
function revelarSiEstaAbajo(el) {
  if (!conScroll || reducir.matches || !el.isConnected) return;
  if (el.getBoundingClientRect().top > window.innerHeight) el.classList.add("fx-revelar");
}

function prepararRevelado(contenedor = document) {
  if (!conScroll) return;
  contenedor.querySelectorAll?.(SELECTOR_REVELAR).forEach(revelarSiEstaAbajo);
}

/* ---------- Contenido nuevo ---------- */
const SELECTOR_NUEVO = [".pres", ".offer", "tbody > tr", ".others__list > *", ".check"].join(",");
const firmas = new WeakMap();

function firmaTabla(tbody) {
  return [...tbody.rows].map((f) => `${f.cells[0]?.textContent.trim().slice(0, 60)}|${f.cells[1]?.textContent.trim().slice(0, 60)}`).join("¦");
}

function animarNuevo(el, indice) {
  el.style.setProperty("--fx-i", String(indice));
  el.classList.add("fx-nuevo");
  let listo = false;
  const terminar = (e) => {
    if (listo || (e && e.target !== el)) return;
    listo = true;
    el.removeEventListener("animationend", terminar);
    el.classList.remove("fx-nuevo");
    el.style.removeProperty("--fx-i");
    if (el.matches(SELECTOR_REVELAR)) revelarSiEstaAbajo(el);
  };
  el.addEventListener("animationend", terminar);
  setTimeout(terminar, 1600);
}

const vigilante = new MutationObserver((cambios) => {
  if (reducir.matches) return;
  const grupos = new Map();
  const sumar = (el) => {
    const padre = el.parentElement;
    if (!padre || !el.isConnected) return;
    if (!grupos.has(padre)) grupos.set(padre, []);
    grupos.get(padre).push(el);
  };
  for (const cambio of cambios) {
    for (const nodo of cambio.addedNodes) {
      if (nodo.nodeType !== 1) continue;
      if (nodo.matches(SELECTOR_NUEVO)) sumar(nodo);
      else nodo.querySelectorAll(SELECTOR_NUEVO).forEach(sumar);
    }
  }
  grupos.forEach((hijos, padre) => {
    if (padre.tagName === "TBODY") {
      // Si solo cambió el estado de una fila (por ejemplo "Editando"), no se repite la animación.
      const firma = firmaTabla(padre);
      if (firmas.get(padre) === firma) return;
      firmas.set(padre, firma);
    }
    hijos.forEach((el, i) => animarNuevo(el, Math.min(i, 12)));
  });
});
vigilante.observe(document.body, { childList: true, subtree: true });

/* ---------- Conteo animado de indicadores ---------- */
const SELECTOR_CONTAR = ".stat__value, .hero__stat strong, .count-box strong, #statMedicamentos, #statFarmacias";
const formato = new Intl.NumberFormat("es-CO");
const actuales = new WeakMap();
const cuadros = new WeakMap();

function primerNumero(el) {
  const recorrido = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
    const m = nodo.data.match(/^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+)(?![\d,])([\s\S]*)$/);
    if (m) return { nodo, antes: m[1], valor: Number(m[2].replace(/\./g, "")), despues: m[3] };
  }
  return null;
}

const contador = new MutationObserver((cambios) => {
  const elementos = new Set();
  cambios.forEach((c) => {
    const base = c.target.nodeType === 1 ? c.target : c.target.parentElement;
    const el = base?.closest(SELECTOR_CONTAR);
    if (el) elementos.add(el);
  });
  elementos.forEach(contar);
});

function contar(el) {
  cancelAnimationFrame(cuadros.get(el));
  const dato = primerNumero(el);
  if (!dato) { actuales.delete(el); return; }
  const desde = actuales.get(el) ?? 0;
  actuales.set(el, dato.valor);
  if (reducir.matches || desde === dato.valor || dato.valor > 1e7) return;

  const duracion = Math.min(1100, 450 + Math.abs(dato.valor - desde) * 8);
  const inicio = performance.now();
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const suave = 1 - Math.pow(1 - t, 3);
    const v = Math.round(desde + (dato.valor - desde) * suave);
    if (!dato.nodo.isConnected) return;
    dato.nodo.data = `${dato.antes}${formato.format(v)}${dato.despues}`;
    contador.takeRecords();
    if (t < 1) cuadros.set(el, requestAnimationFrame(paso));
  };
  cuadros.set(el, requestAnimationFrame(paso));
}

document.querySelectorAll(SELECTOR_CONTAR).forEach((el) => {
  const dato = primerNumero(el);
  if (dato) actuales.set(el, dato.valor);
  contador.observe(el, { childList: true, characterData: true, subtree: true });
});

/* ---------- Tablas del administrador en celulares ---------- */
// Cada celda recibe el nombre de su columna para mostrarse como tarjeta en pantallas pequeñas.
function etiquetarTabla(tabla) {
  const titulos = [...tabla.querySelectorAll("thead th")].map((th) => ({
    texto: th.textContent.trim().replace(/\s+/g, " "),
    oculto: !!th.querySelector(".sr-only, .visually-hidden") || !th.textContent.trim()
  }));
  if (!titulos.length) return;
  const ultima = titulos.length - 1;
  const esAccion = titulos[ultima].oculto || /^acci[oó]n$/i.test(titulos[ultima].texto);
  // En A02 la primera columna es solo el módulo; la principal es la presentación.
  const principal = /^m[oó]dulo$/i.test(titulos[0].texto) ? 1 : 0;
  tabla.querySelectorAll("tbody > tr").forEach((fila) => {
    if (fila.classList.contains("row-empty")) return;
    [...fila.cells].forEach((celda, i) => {
      if (celda.colSpan > 1) return;
      celda.classList.toggle("fx-td-principal", i === principal);
      celda.classList.toggle("fx-td-accion", esAccion && i === ultima);
      const t = titulos[i];
      if (t && !t.oculto && i !== principal && !(principal === 1 && i === 0)) celda.dataset.label = t.texto;
      else delete celda.dataset.label;
    });
  });
}

document.querySelectorAll(".fx-admin .table").forEach((tabla) => {
  etiquetarTabla(tabla);
  const cuerpo = tabla.tBodies[0];
  if (cuerpo) new MutationObserver(() => etiquetarTabla(tabla)).observe(cuerpo, { childList: true, subtree: true });
});

/* ---------- Barras con desplazamiento horizontal ---------- */
function vigilarDesborde(el) {
  const actualizar = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.style.setProperty("--fx-mi", max > 2 && el.scrollLeft > 2 ? "28px" : "0px");
    el.style.setProperty("--fx-md", max > 2 && el.scrollLeft < max - 2 ? "28px" : "0px");
  };
  el.addEventListener("scroll", actualizar, { passive: true });
  new ResizeObserver(actualizar).observe(el);
  if (el.firstElementChild) new ResizeObserver(actualizar).observe(el.firstElementChild);
  actualizar();
}

document.querySelectorAll(".tabs, .fx-admin .table-wrap").forEach(vigilarDesborde);

// La pestaña de la sección actual siempre queda a la vista en pantallas angostas.
function centrarPestanas() {
  document.querySelectorAll(".tabs").forEach((tabs) => {
    const activa = tabs.querySelector(".is-active, [aria-current='page']");
    if (!activa || tabs.scrollWidth <= tabs.clientWidth) return;
    tabs.style.scrollBehavior = "auto";
    tabs.scrollLeft = activa.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft - (tabs.clientWidth - activa.offsetWidth) / 2;
    tabs.style.removeProperty("scroll-behavior");
  });
}
centrarPestanas();
document.fonts?.ready.then(centrarPestanas);
window.addEventListener("orientationchange", () => setTimeout(centrarPestanas, 300));

/* ---------- Inicio ---------- */
prepararRevelado();
