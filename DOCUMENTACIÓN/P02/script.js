/* ==========================================================
   FARMAPS - P02 Selección de presentación
   ========================================================== */

import {
  obtenerCatalogo,
  obtenerResumenOfertas,
  buscarMedicamentos,
  normalizar
} from "../compartido/datos.js";
import { obtenerReferencia } from "../compartido/ubicacion.js";

// Pantalla P03 (resultados y comparación de ofertas)
const PAGINA_COMPARADOR = "../P03/index.html";
// Solo la búsqueda viaja en la URL; el punto de referencia queda en la pestaña (compartido/ubicacion.js)
const PARAMS_CONTEXTO = ["q"];

const $ = (id) => document.getElementById(id);
const form = $("searchForm");
const input = $("searchInput");
const clearBtn = $("clearBtn");
const results = $("results");
const resultsTitle = $("resultsTitle");
const criterio = $("criterio");
const countBox = $("countBox");
const countValue = $("countValue");
const referenceLabel = $("referenceLabel");
const referenceLink = $("referenceLink");
const navbar = document.querySelector(".navbar");
const navToggle = $("navToggle");

const params = new URLSearchParams(location.search);
let medicamentoId = params.get("medicamento");
let datosCargados = null; // { catalogo, ofertas }
let temporizador = null;

/* ---------- Utilidades ---------- */
const escapar = (t = "") =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatoPrecio = (n) => `$ ${Math.round(n).toLocaleString("es-CO")}`;

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const ICONOS = {
  tableta: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  recubierta: '<rect x="5" y="6" width="14" height="15" rx="2"/><path d="M8 3h8v3H8z"/><path d="M12 10v7M8.5 13.5h7"/>',
  liquido: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  efervescente: '<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9.5V3"/><path d="M7 15h10"/>',
  topico: '<path d="M8 3h8l-1 4H9z"/><path d="M9 7h6l1 14H8z"/><path d="M10 12h4"/>',
  inhalador: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>'
};

function iconoForma(forma) {
  const f = normalizar(forma);
  if (/gota|solucion|jarabe|suspension/.test(f)) return ICONOS.liquido;
  if (/efervesc|polvo/.test(f)) return ICONOS.efervescente;
  if (/crema|gel|unguento|topic/.test(f)) return ICONOS.topico;
  if (/aerosol|inhal/.test(f)) return ICONOS.inhalador;
  if (/recubierta/.test(f)) return ICONOS.recubierta;
  return ICONOS.tableta;
}

/** Parámetros de contexto actuales (búsqueda y punto de referencia) para enlazar otras pantallas. */
function contexto(extra = {}) {
  const actual = new URLSearchParams(location.search);
  const p = new URLSearchParams();
  PARAMS_CONTEXTO.forEach((k) => { if (actual.get(k)) p.set(k, actual.get(k)); });
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}

function actualizarEnlacesContexto() {
  document.querySelectorAll("[data-contexto]").forEach((a) => {
    const base = a.getAttribute("href").split("?")[0];
    const qs = contexto({ volver: "seleccion" });
    a.setAttribute("href", qs ? `${base}?${qs}` : base);
  });
}

/* ---------- Menú móvil ---------- */
navToggle.addEventListener("click", () => {
  const abierto = navbar.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", abierto);
});

/* ---------- Punto de referencia (solo en esta pestaña, nunca en la base de datos) ---------- */
function mostrarReferencia() {
  const ref = obtenerReferencia();
  referenceLabel.textContent = ref ? ref.etiqueta : "Sin definir";
  referenceLink.textContent = ref ? "Cambiar" : "Definir";
}

/* ---------- Búsqueda de presentaciones ---------- */
function filtrarPresentaciones(catalogo, texto, idMedicamento) {
  if (idMedicamento) {
    const m = catalogo.medicamentos.find((x) => x.id === idMedicamento);
    if (m) return m.presentaciones.map((p) => ({ m, p }));
  }

  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];

  const lista = [];
  buscarMedicamentos(catalogo.medicamentos, texto, Infinity).forEach((m) => {
    const base = `${m._nombre} ${m._principio}`;
    // Las palabras que no están en el nombre deben coincidir con la presentación (ej. "400 mg")
    const resto = palabras.filter((w) => !base.includes(w));
    m.presentaciones.forEach((p) => {
      const txt = normalizar(`${p.concentracion} ${p.formaFarmaceutica} ${p.contenidoEnvase}`);
      const compacto = txt.replace(/\s+/g, "");
      if (resto.every((w) => txt.includes(w) || compacto.includes(w))) lista.push({ m, p });
    });
  });
  return lista;
}

function resumenDe(ofertas, presentacionId) {
  return ofertas.get(presentacionId) || { total: 0, disponibles: 0, rangos: {} };
}

/* ---------- Render ---------- */
function tarjeta({ m, p, r }) {
  const sinOfertas = r.total === 0;
  const sinDisponibles = !sinOfertas && r.disponibles === 0;

  const badge = sinOfertas
    ? '<span class="badge badge--danger">Sin ofertas activas</span>'
    : sinDisponibles
      ? `<span class="badge badge--warn">Sin disponibilidad reportada · ${plural(r.total, "oferta", "ofertas")}</span>`
      : `<span class="badge">${plural(r.disponibles, "oferta disponible", "ofertas disponibles")}</span>`;

  const rangos = Object.entries(r.rangos).map(([moneda, { min, max }]) =>
    min === max ? `${formatoPrecio(min)} ${escapar(moneda)}` : `${formatoPrecio(min)} - ${formatoPrecio(max)} ${escapar(moneda)}`
  );

  const pie = sinOfertas
    ? `<div>
         <span class="price__label">Disponibilidad</span>
         <span class="price__none">No registrado</span>
       </div>
       <span class="btn btn--disabled" aria-disabled="true">
         Sin stock local
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>
       </span>`
    : `<div>
         <span class="price__label">${sinDisponibles ? "Rango reportado" : "Rango estimado"}</span>
         ${rangos.map((t) => `<span class="price__value">${t}</span>`).join("<br>")}
       </div>
       <a class="btn btn--primary" href="${PAGINA_COMPARADOR}?${contexto({ presentacion: p.id })}">
         Ver detalle
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
       </a>`;

  return `
    <article class="pres${sinOfertas ? " pres--empty" : ""}">
      ${badge}
      <div class="pres__head">
        <span class="pres__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconoForma(p.formaFarmaceutica)}</svg>
        </span>
        <div>
          <h3 class="pres__name">${escapar(m.nombreComercial)}</h3>
          <p class="pres__active">Principio activo: <span>${escapar(m.principioActivo)}</span></p>
        </div>
      </div>
      <dl class="specs">
        <div><dt>Concentración</dt><dd>${escapar(p.concentracion)}</dd></div>
        <div><dt>Forma</dt><dd>${escapar(p.formaFarmaceutica)}</dd></div>
        <div><dt>Envase</dt><dd>${escapar(p.contenidoEnvase)}</dd></div>
      </dl>
      <div class="pres__foot">${pie}</div>
    </article>`;
}

function mostrarEstado({ icono, titulo, texto, boton = "", error = false }) {
  countBox.hidden = true;
  results.setAttribute("aria-busy", "false");
  results.innerHTML = `
    <div class="state${error ? " state--error" : ""}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icono}</svg>
      <h2>${titulo}</h2>
      <p>${texto}</p>
      ${boton}
    </div>`;
}

const ICONO_BUSCAR = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
const ICONO_ERROR = '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>';

function mostrarCarga() {
  results.setAttribute("aria-busy", "true");
  results.innerHTML = '<div class="skeleton"></div>'.repeat(4);
}

function render() {
  const texto = input.value.trim();
  const { catalogo, ofertas } = datosCargados;
  const encontrados = filtrarPresentaciones(catalogo, texto, medicamentoId);
  const etiqueta = texto || (encontrados[0] && encontrados[0].m.nombreComercial) || "";

  resultsTitle.textContent = etiqueta ? `Resultados de búsqueda para “${etiqueta}”` : "Resultados de búsqueda";
  document.title = etiqueta ? `“${etiqueta}” | Farmaps` : "Farmaps | Selección de presentación";

  if (!etiqueta) {
    criterio.textContent = "Criterio: nombre comercial o principio activo";
    mostrarEstado({
      icono: ICONO_BUSCAR,
      titulo: "Escribe un medicamento para comenzar",
      texto: "Busca por nombre comercial o principio activo, por ejemplo “Ibuprofeno 400 mg”."
    });
    return;
  }

  if (!encontrados.length) {
    criterio.textContent = "Criterio: nombre comercial o principio activo";
    mostrarEstado({
      icono: ICONO_BUSCAR,
      titulo: `No encontramos presentaciones para “${escapar(etiqueta)}”`,
      texto: "Revisa la ortografía, prueba solo con el principio activo o quita la concentración de la búsqueda.",
      boton: '<a class="btn btn--primary" href="../index.html">Volver al inicio</a>'
    });
    return;
  }

  const filas = encontrados
    .map(({ m, p }) => ({ m, p, r: resumenDe(ofertas, p.id) }))
    .sort((a, b) =>
      b.r.disponibles - a.r.disponibles ||
      b.r.total - a.r.total ||
      a.m.nombreComercial.localeCompare(b.m.nombreComercial, "es") ||
      a.p.concentracion.localeCompare(b.p.concentracion, "es", { numeric: true })
    );

  const principios = [...new Set(filas.map((f) => f.m.principioActivo))];
  const medicamentos = new Set(filas.map((f) => f.m.id));
  criterio.textContent = principios.length === 1
    ? `Principio activo: ${principios[0]} · ${plural(medicamentos.size, "medicamento", "medicamentos")}`
    : `Criterio: nombre comercial o principio activo · ${plural(medicamentos.size, "medicamento", "medicamentos")}`;

  countValue.textContent = plural(filas.length, "Presentación", "Presentaciones");
  countBox.hidden = false;
  results.setAttribute("aria-busy", "false");
  results.innerHTML = filas.map(tarjeta).join("");
}

/* ---------- Carga de datos ---------- */
async function cargar() {
  mostrarCarga();
  try {
    const [catalogo, ofertas] = await Promise.all([obtenerCatalogo(), obtenerResumenOfertas()]);
    datosCargados = { catalogo, ofertas };

    if (!input.value && medicamentoId) {
      const m = catalogo.medicamentos.find((x) => x.id === medicamentoId);
      if (m) input.value = m.nombreComercial;
    }
    clearBtn.hidden = !input.value;
    render();
  } catch (error) {
    console.error("Farmaps: error al consultar Firestore.", error);
    mostrarEstado({
      icono: ICONO_ERROR,
      titulo: "No fue posible consultar el catálogo",
      texto: "Hubo un problema de conexión con la base de datos. No se muestran resultados para evitar información incorrecta.",
      boton: '<button type="button" class="btn btn--primary" id="retryBtn">Reintentar</button>',
      error: true
    });
    $("retryBtn").addEventListener("click", cargar);
  }
}

/* ---------- Eventos ---------- */
function aplicarBusqueda() {
  const texto = input.value.trim();
  const url = new URL(location.href);
  if (texto) url.searchParams.set("q", texto); else url.searchParams.delete("q");
  url.searchParams.delete("medicamento");
  history.replaceState(null, "", url);
  actualizarEnlacesContexto();
  if (datosCargados) render();
}

input.addEventListener("input", () => {
  medicamentoId = null; // al editar el texto, se busca por texto libre
  clearBtn.hidden = !input.value;
  clearTimeout(temporizador);
  temporizador = setTimeout(aplicarBusqueda, 200);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(temporizador);
  medicamentoId = null;
  aplicarBusqueda();
  input.blur();
});

clearBtn.addEventListener("click", () => {
  input.value = "";
  clearBtn.hidden = true;
  medicamentoId = null;
  aplicarBusqueda();
  input.focus();
});

/* ---------- Inicio ---------- */
input.value = params.get("q") || "";
clearBtn.hidden = !input.value;
mostrarReferencia();
actualizarEnlacesContexto();
cargar();

// Si el navegador restaura la página desde caché (botón Atrás), refresca el punto de referencia
window.addEventListener("pageshow", (e) => { if (e.persisted) mostrarReferencia(); });
