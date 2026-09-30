/* ==========================================================
   FARMAPS - P03 Resultados y comparación (comparador y mapa)
   - Solo se comparan ofertas de la misma presentación y moneda (RI-05).
   - Solo entran en la comparación las ofertas con disponibilidad
     reportada explícitamente (RI-07).
   - Las distancias se calculan en el navegador, en línea recta,
     desde el punto guardado en la pestaña (RI-11).
   ========================================================== */

import {
  obtenerCatalogo,
  obtenerFarmacias,
  obtenerOfertasDePresentacion
} from "../compartido/datos.js";
import {
  BOGOTA,
  coordenadasValidas,
  distanciaKm,
  formatoDistancia,
  obtenerReferencia
} from "../compartido/ubicacion.js";

const PAGINA_DETALLE = "../P05/index.html"; // P05
const PAGINA_REFERENCIA = "../P04/index.html"; // P04
const PAGINA_SELECCION = "../P02/index.html"; // P02

const $ = (id) => document.getElementById(id);
const navbar = document.querySelector(".navbar");
const navToggle = $("navToggle");
const presentationName = $("presentationName");
const changePresentation = $("changePresentation");
const sortButtons = [...document.querySelectorAll(".sort__btn")];
const referenceBox = document.querySelector(".reference");
const referenceLabel = $("referenceLabel");
const referenceState = $("referenceState");
const referenceLink = $("referenceLink");
const resultsTitle = $("resultsTitle");
const currencyBox = $("currencyBox");
const currencySelect = $("currencySelect");
const notice = $("notice");
const list = $("list");
const others = $("others");
const othersSummary = $("othersSummary");
const othersList = $("othersList");
const mapCard = $("mapCard");
const mapChip = $("mapChip");
const mapError = $("mapError");

const params = new URLSearchParams(location.search);
const presentacionId = params.get("presentacion");
let orden = params.get("orden") === "distancia" ? "distancia" : "precio";
let moneda = params.get("moneda");
let referencia = obtenerReferencia();

let datos = null;      // { medicamento, presentacion, ofertas }
let actuales = [];     // filas comparadas en el orden actual
let activa = null;     // id de la oferta resaltada
let mapa = null;
let capa = null;
const marcadores = new Map();

/* ---------- Utilidades ---------- */
const escapar = (t = "") =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatoPrecio = (n) => `$ ${Math.round(n).toLocaleString("es-CO")}`;

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function formatoFecha(fecha) {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) return "Fecha no registrada";
  const texto = fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hoy = new Date();
  const dias = Math.round(
    (new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) -
      new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())) / 86400000
  );
  let relativo = "";
  if (dias <= 0) relativo = "Hoy";
  else if (dias === 1) relativo = "Ayer";
  else if (dias < 30) relativo = `Hace ${dias} días`;
  else if (dias < 60) relativo = "Hace 1 mes";
  else if (dias < 365) relativo = `Hace ${Math.floor(dias / 30)} meses`;
  else relativo = "Hace más de un año";
  return `${texto} (${relativo})`;
}

/** Parámetros que se conservan entre pantallas (la ubicación nunca viaja en la URL). */
function consulta(extra = {}) {
  const p = new URLSearchParams();
  if (params.get("q")) p.set("q", params.get("q"));
  if (presentacionId) p.set("presentacion", presentacionId);
  if (orden === "distancia") p.set("orden", "distancia");
  if (moneda && moneda !== "COP") p.set("moneda", moneda);
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}

const conConsulta = (pagina, extra) => {
  const qs = consulta(extra);
  return qs ? `${pagina}?${qs}` : pagina;
};

const urlReferencia = (extra = {}) => conConsulta(PAGINA_REFERENCIA, { volver: "comparador", ...extra });
const urlDetalle = (ofertaId) => conConsulta(PAGINA_DETALLE, { oferta: ofertaId });

function actualizarEnlaces() {
  history.replaceState(null, "", conConsulta(location.pathname));
  document.querySelectorAll("[data-referencia]").forEach((a) => { a.href = urlReferencia(); });

  const q = params.get("q");
  changePresentation.href = q
    ? `${PAGINA_SELECCION}?${new URLSearchParams({ q })}`
    : datos?.medicamento
      ? `${PAGINA_SELECCION}?${new URLSearchParams({ medicamento: datos.medicamento.id })}`
      : "../index.html";
}

/* ---------- Menú móvil ---------- */
navToggle.addEventListener("click", () => {
  const abierto = navbar.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", abierto);
});

/* ---------- Punto de referencia ---------- */
function mostrarReferencia() {
  referenceBox.classList.toggle("is-set", !!referencia);
  if (referencia) {
    // "Cerca de Zona T · Chapinero, Bogotá D.C." -> "Zona T"
    const corto = referencia.etiqueta.split(" · ")[0].replace(/^Cerca de /, "");
    referenceLabel.textContent = corto;
    referenceLabel.title = referencia.etiqueta;
    referenceState.textContent = referencia.origen === "gps" ? "(GPS)" : "(Definida)";
    referenceLink.textContent = "[Cambiar]";
  } else {
    referenceLabel.textContent = "Sin definir";
    referenceLabel.removeAttribute("title");
    referenceState.textContent = "";
    referenceLink.textContent = "[Definir]";
  }
}

/* ---------- Orden ---------- */
function marcarOrden() {
  sortButtons.forEach((b) => {
    const activo = b.dataset.orden === orden;
    b.classList.toggle("is-active", activo);
    b.setAttribute("aria-pressed", activo);
  });
}

sortButtons.forEach((b) =>
  b.addEventListener("click", () => {
    const nuevo = b.dataset.orden;
    // CU-05: sin punto de referencia primero se define la ubicación (CU-04)
    if (nuevo === "distancia" && !referencia) {
      location.href = urlReferencia({ orden: "distancia" });
      return;
    }
    if (nuevo === orden) return;
    orden = nuevo;
    activa = null;
    render({ ajustarMapa: false });
  })
);

currencySelect.addEventListener("change", () => {
  moneda = currencySelect.value;
  activa = null;
  render({ ajustarMapa: true });
});

/* ---------- Comparación ---------- */
function prepararFilas() {
  const deMoneda = datos.ofertas.filter((o) => o.moneda === moneda && o.farmacia);
  const conDistancia = (o) => {
    const f = o.farmacia;
    const ok = referencia && coordenadasValidas(f.latitud, f.longitud);
    return { ...o, distancia: ok ? distanciaKm(referencia, { lat: f.latitud, lng: f.longitud }) : null };
  };

  const comparables = deMoneda
    .filter((o) => o.disponibilidadReportada === true && typeof o.precio === "number" && o.precio > 0)
    .map(conDistancia);
  const sinDisponibilidad = deMoneda
    .filter((o) => !comparables.some((c) => c.id === o.id))
    .map(conDistancia)
    .sort((a, b) => a.farmacia.nombre.localeCompare(b.farmacia.nombre, "es"));

  const porNombre = (a, b) => a.farmacia.nombre.localeCompare(b.farmacia.nombre, "es");
  const porDistancia = (a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity);
  const porPrecio = (a, b) => a.precio - b.precio;
  comparables.sort((a, b) =>
    orden === "distancia"
      ? porDistancia(a, b) || porPrecio(a, b) || porNombre(a, b)
      : porPrecio(a, b) || porDistancia(a, b) || porNombre(a, b)
  );

  // Distintivos: todas las empatadas en el menor precio o la menor distancia (al metro)
  if (comparables.length > 1) {
    const minPrecio = Math.min(...comparables.map((o) => o.precio));
    const distancias = comparables.map((o) => o.distancia).filter((d) => d !== null);
    const minDist = distancias.length ? Math.min(...distancias) : null;
    comparables.forEach((o) => {
      o.menorPrecio = o.precio === minPrecio;
      o.masCercana = minDist !== null && o.distancia !== null && Math.round(o.distancia * 1000) === Math.round(minDist * 1000);
    });
  }
  comparables.forEach((o, i) => { o.numero = i + 1; });
  return { comparables, sinDisponibilidad };
}

/* ---------- Render de la lista ---------- */
const ICONO_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICONO_RELOJ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
const ICONO_REGLA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7v4M10 7v3M14 7v4M18 7v3"/></svg>';
const ICONO_FLECHA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 19-9-9 19-2-8-8-2z"/></svg>';

function celdaDistancia(o) {
  if (o.distancia === null) {
    return referencia
      ? '<dd><span class="distance distance--none">No disponible</span><small>Coordenadas sin registrar</small></dd>'
      : `<dd><span class="distance distance--none">Sin referencia</span><small><a href="${escapar(urlReferencia())}">Definir punto</a></small></dd>`;
  }
  return `<dd>
      <span class="distance${o.masCercana ? " is-near" : ""}">${o.masCercana ? ICONO_FLECHA : ICONO_REGLA}Aprox. ${formatoDistancia(o.distancia)}</span>
      <small>En línea recta</small>
    </dd>`;
}

function tarjeta(o) {
  const f = o.farmacia;
  const flags = [
    o.menorPrecio ? '<span class="flag flag--price"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>Menor precio</span>' : "",
    o.masCercana ? '<span class="flag flag--near"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3z"/></svg>Más cercana entre las coincidencias</span>' : ""
  ].join("");

  return `
    <article class="offer${o.menorPrecio ? " is-best" : ""}${o.id === activa ? " is-active" : ""}" id="oferta-${escapar(o.id)}" data-id="${escapar(o.id)}">
      ${flags ? `<div class="offer__flags">${flags}</div>` : ""}
      <div class="offer__head">
        <span class="offer__num" aria-label="Posición ${o.numero}">${o.numero}</span>
        <div>
          <h2 class="offer__name">${escapar(f.nombre)}</h2>
          <p class="offer__addr">${ICONO_PIN}${escapar(f.direccion)}</p>
        </div>
      </div>
      <dl class="stats">
        <div>
          <dt>Precio reportado</dt>
          <dd class="price">${formatoPrecio(o.precio)} <small>${escapar(o.moneda)}</small></dd>
        </div>
        <div>
          <dt>Disponibilidad</dt>
          <dd><span class="stock">Disponible</span><small>Reportada por la farmacia</small></dd>
        </div>
        <div>
          <dt>Distancia aproximada</dt>
          ${celdaDistancia(o)}
        </div>
      </dl>
      <div class="offer__foot">
        <p class="updated">${ICONO_RELOJ}Actualizado: ${formatoFecha(o.fechaActualizacion)}</p>
        <div class="offer__actions">
          <button type="button" class="btn btn--soft" data-mapa="${escapar(o.id)}"${coordenadasValidas(f.latitud, f.longitud) ? "" : " disabled"}>${ICONO_PIN}Ver en mapa</button>
          <a class="btn btn--primary" href="${escapar(urlDetalle(o.id))}">Ver detalles
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
        </div>
      </div>
    </article>`;
}

function filaSinDisponibilidad(o) {
  const estado = o.disponibilidadReportada === false ? "No disponible" : "Disponibilidad no reportada";
  const precio = typeof o.precio === "number" && o.precio > 0 ? `${formatoPrecio(o.precio)} ${escapar(o.moneda)}` : "Precio no registrado";
  return `
    <li>
      <div>
        <strong>${escapar(o.farmacia.nombre)}</strong>
        <span>${escapar(estado)}${o.distancia !== null ? ` · Aprox. ${formatoDistancia(o.distancia)}` : ""}</span>
      </div>
      <div class="others__meta">
        <b>${precio}</b>
        <a href="${escapar(urlDetalle(o.id))}">Ver detalles</a>
      </div>
    </li>`;
}

function mostrarAviso(html) {
  notice.hidden = !html;
  notice.innerHTML = html || "";
}

function mostrarEstado({ icono, titulo, texto, botones = "", error = false }) {
  list.setAttribute("aria-busy", "false");
  list.innerHTML = `
    <div class="state${error ? " state--error" : ""}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icono}</svg>
      <h2>${titulo}</h2>
      <p>${texto}</p>
      ${botones ? `<div class="state__actions">${botones}</div>` : ""}
    </div>`;
}

const ICONO_BUSCAR = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
const ICONO_ERROR = '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>';
const ICONO_VACIO = '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 7V4h8v3M9 14h6"/>';

function render({ ajustarMapa = true } = {}) {
  marcarOrden();
  mostrarReferencia();
  actualizarEnlaces();

  const { comparables, sinDisponibilidad } = prepararFilas();
  actuales = comparables;
  if (!comparables.some((o) => o.id === activa)) activa = comparables[0]?.id ?? null;

  resultsTitle.textContent = comparables.length
    ? `${plural(comparables.length, "farmacia", "farmacias")} con disponibilidad reportada`
    : "Farmacias con coincidencias";

  othersSummary.textContent = `${plural(sinDisponibilidad.length, "farmacia", "farmacias")} sin disponibilidad reportada`;
  othersList.innerHTML = sinDisponibilidad.map(filaSinDisponibilidad).join("");
  others.hidden = sinDisponibilidad.length === 0;

  const avisos = [];
  if (params.get("orden") === "distancia" && !referencia) {
    avisos.push(`Para ordenar por cercanía primero define un punto de referencia. <a href="${escapar(urlReferencia({ orden: "distancia" }))}">Definir punto</a>`);
  }
  if (comparables.length === 1) {
    avisos.push("Solo una farmacia reporta disponibilidad para esta presentación, por lo que no hay comparación de precios.");
  }
  if (orden === "distancia" && referencia && comparables.some((o) => o.distancia === null)) {
    avisos.push("Algunas farmacias no tienen coordenadas registradas y se muestran al final.");
  }
  mostrarAviso(avisos.join("<br>"));

  if (!comparables.length) {
    others.open = sinDisponibilidad.length > 0;
    mostrarEstado({
      icono: ICONO_VACIO,
      titulo: sinDisponibilidad.length ? "Ninguna farmacia reporta disponibilidad" : "No hay ofertas registradas",
      texto: sinDisponibilidad.length
        ? "Hay farmacias que registran esta presentación, pero ninguna reporta disponibilidad. Puedes revisarlas abajo o buscar otra presentación."
        : "Todavía no hay ofertas para esta presentación en el catálogo Farmaps. Prueba con otra presentación o medicamento.",
      botones: `<a class="btn btn--primary" href="${escapar(changePresentation.href)}">Cambiar presentación</a>
                <a class="btn btn--outline" href="../index.html">Nueva búsqueda</a>`
    });
  } else {
    list.setAttribute("aria-busy", "false");
    list.innerHTML = comparables.map(tarjeta).join("");
  }

  pintarMapa({ ajustar: ajustarMapa });
}

list.addEventListener("click", (e) => {
  const boton = e.target.closest("[data-mapa]");
  if (!boton) return;
  activar(boton.dataset.mapa, { abrirPopup: true });
  const r = mapCard.getBoundingClientRect();
  if (r.bottom < 80 || r.top > innerHeight - 80) mapCard.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- Mapa ---------- */
function iniciarMapa() {
  if (!window.L) {
    mapError.hidden = false;
    return;
  }
  try {
    mapa = L.map("map", {
      center: BOGOTA.centro,
      zoom: 12,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: BOGOTA.limitesMapa,
      maxBoundsViscosity: 1,
      scrollWheelZoom: false
    });
  } catch (error) {
    console.error("Farmaps: no se pudo iniciar el mapa.", error);
    mapError.hidden = false;
    return;
  }

  mapa.attributionControl.setPrefix(false);
  let cargadas = 0;
  let fallidas = 0;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  })
    .on("tileload", () => { cargadas++; })
    .on("tileerror", () => {
      fallidas++;
      if (cargadas === 0 && fallidas >= 4) mapError.hidden = false;
    })
    .addTo(mapa);

  // La rueda del ratón solo hace zoom cuando el visitante interactúa con el mapa
  mapa.on("focus click", () => mapa.scrollWheelZoom.enable());
  mapa.on("blur mouseout", () => mapa.scrollWheelZoom.disable());

  capa = L.layerGroup().addTo(mapa);
}

function iconoFarmacia(o) {
  const clases = ["marcador"];
  if (o.menorPrecio) clases.push("marcador--best");
  if (o.id === activa) clases.push("is-active");
  return L.divIcon({
    className: clases.join(" "),
    iconSize: [40, 48],
    iconAnchor: [20, 48],
    popupAnchor: [0, -50],
    html: `<span class="marcador__pin">${o.numero}</span>`
  });
}

function contenidoPopup(o) {
  const etiqueta = o.menorPrecio ? "Menor precio" : o.masCercana ? "Más cercana" : `N.º ${o.numero}`;
  return `
    <div class="pop">
      <div class="pop__top">
        <span class="pop__flag">${etiqueta}</span>
        ${o.distancia !== null ? `<span class="pop__dist">${formatoDistancia(o.distancia)}</span>` : ""}
      </div>
      <p class="pop__name">${escapar(o.farmacia.nombre)}</p>
      <p class="pop__price">${formatoPrecio(o.precio)} <small>${escapar(o.moneda)}</small></p>
      <p class="pop__stock">Disponibilidad reportada</p>
      <a class="pop__btn" href="${escapar(urlDetalle(o.id))}">Ver oferta completa</a>
    </div>`;
}

let linea = null;

function dibujarLinea() {
  if (linea) { linea.remove(); linea = null; }
  const o = actuales.find((x) => x.id === activa);
  if (!mapa || !referencia || !o || o.distancia === null) return;
  linea = L.polyline([[referencia.lat, referencia.lng], [o.farmacia.latitud, o.farmacia.longitud]], {
    color: "#0A7BC4", weight: 2.5, dashArray: "6 7", interactive: false
  }).addTo(capa);
}

function pintarMapa({ ajustar }) {
  if (!mapa) return;
  capa.clearLayers();
  marcadores.clear();
  linea = null;

  const puntos = [];
  // Se dibujan en orden inverso para que el N.º 1 quede encima
  [...actuales].reverse().forEach((o) => {
    const f = o.farmacia;
    if (!coordenadasValidas(f.latitud, f.longitud)) return;
    const m = L.marker([f.latitud, f.longitud], {
      icon: iconoFarmacia(o),
      title: `${o.numero}. ${f.nombre} · ${formatoPrecio(o.precio)} ${o.moneda}`,
      riseOnHover: true,
      zIndexOffset: o.numero === 1 ? 500 : 0
    })
      .bindPopup(contenidoPopup(o), { autoPanPaddingTopLeft: [24, 56], autoPanPaddingBottomRight: [24, 48], closeButton: true })
      .on("click", () => activar(o.id, { desdeMapa: true }))
      .addTo(capa);
    marcadores.set(o.id, m);
    puntos.push([f.latitud, f.longitud]);
  });

  if (referencia) {
    L.marker([referencia.lat, referencia.lng], {
      icon: L.divIcon({
        className: "ref-pin",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>'
      }),
      keyboard: false,
      interactive: false,
      zIndexOffset: 1000
    })
      .bindTooltip("Tu referencia", { permanent: true, direction: "bottom", offset: [0, 18], className: "ref-tooltip" })
      .addTo(capa);
    puntos.push([referencia.lat, referencia.lng]);
  }

  dibujarLinea();

  const distancias = actuales.map((o) => o.distancia).filter((d) => d !== null);
  if (distancias.length) {
    mapChip.textContent = `Radio ${formatoDistancia(Math.max(...distancias))}`;
    mapChip.title = "Distancia en línea recta hasta la farmacia más lejana de los resultados";
  } else {
    mapChip.textContent = plural(marcadores.size, "farmacia en el mapa", "farmacias en el mapa");
    mapChip.removeAttribute("title");
  }
  mapChip.hidden = marcadores.size === 0;

  if (ajustar) {
    if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [48, 48], maxZoom: 15 });
    else if (puntos.length === 1) mapa.setView(puntos[0], 15);
    else mapa.setView(BOGOTA.centro, 12);
  }
}

function activar(id, { abrirPopup = false, desdeMapa = false } = {}) {
  activa = id;
  document.querySelectorAll(".offer").forEach((el) => el.classList.toggle("is-active", el.dataset.id === id));
  actuales.forEach((o) => { const m = marcadores.get(o.id); if (m) m.setIcon(iconoFarmacia(o)); });
  dibujarLinea();

  const m = marcadores.get(id);
  if (m && abrirPopup) {
    mapa.panTo(m.getLatLng());
    m.openPopup();
  }
  if (desdeMapa) {
    const tarjetaEl = document.querySelector(`.offer[data-id="${CSS.escape(id)}"]`);
    if (tarjetaEl && innerWidth > 1024) tarjetaEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* ---------- Carga de datos ---------- */
function mostrarCarga() {
  list.setAttribute("aria-busy", "true");
  list.innerHTML = '<div class="skeleton"></div>'.repeat(3);
}

function nombrePresentacion(m, p) {
  return `${m.nombreComercial} ${p.concentracion} - ${p.formaFarmaceutica} (${p.contenidoEnvase})`;
}

async function cargar() {
  marcarOrden();
  mostrarReferencia();
  actualizarEnlaces();

  if (!presentacionId) {
    presentationName.textContent = "Ninguna";
    resultsTitle.textContent = "Comparador de ofertas";
    mostrarEstado({
      icono: ICONO_BUSCAR,
      titulo: "Selecciona una presentación para comparar",
      texto: "Busca un medicamento y elige su presentación exacta (concentración, forma y envase). Solo se comparan ofertas de la misma presentación.",
      botones: '<a class="btn btn--primary" href="../index.html">Buscar medicamento</a>'
    });
    pintarMapa({ ajustar: true });
    return;
  }

  mostrarCarga();
  try {
    const [catalogo, farmacias, ofertas] = await Promise.all([
      obtenerCatalogo(),
      obtenerFarmacias(),
      obtenerOfertasDePresentacion(presentacionId)
    ]);

    const presentacion = catalogo.presentaciones.find((p) => p.id === presentacionId);
    const medicamento = presentacion && catalogo.medicamentos.find((m) => m.id === presentacion.medicamentoId);
    if (!presentacion || !medicamento) {
      presentationName.textContent = "No encontrada";
      resultsTitle.textContent = "Comparador de ofertas";
      mostrarEstado({
        icono: ICONO_BUSCAR,
        titulo: "No encontramos esta presentación",
        texto: "El enlace puede estar incompleto o la presentación ya no está en el catálogo. Realiza una nueva búsqueda.",
        botones: '<a class="btn btn--primary" href="../index.html">Buscar medicamento</a>'
      });
      pintarMapa({ ajustar: true });
      return;
    }

    datos = {
      medicamento,
      presentacion,
      ofertas: ofertas.map((o) => ({ ...o, farmacia: farmacias.get(o.farmaciaId) || null }))
    };

    const nombre = nombrePresentacion(medicamento, presentacion);
    presentationName.textContent = nombre;
    document.title = `${nombre} | Farmaps`;

    // Monedas disponibles: se comparan por separado (RI-05)
    const monedas = [...new Set(datos.ofertas.map((o) => o.moneda).filter(Boolean))]
      .sort((a, b) => (a === "COP" ? -1 : b === "COP" ? 1 : a.localeCompare(b)));
    if (!monedas.includes(moneda)) moneda = monedas[0] || "COP";
    currencySelect.innerHTML = monedas.map((m) => `<option value="${escapar(m)}">${escapar(m)}</option>`).join("");
    currencySelect.value = moneda;
    currencyBox.hidden = monedas.length < 2;

    if (orden === "distancia" && !referencia) orden = "precio";
    render({ ajustarMapa: true });
  } catch (error) {
    console.error("Farmaps: error al consultar Firestore.", error);
    resultsTitle.textContent = "Comparador de ofertas";
    mostrarEstado({
      icono: ICONO_ERROR,
      titulo: "No fue posible cargar las ofertas",
      texto: "Hubo un problema de conexión con la base de datos. No se muestran resultados para evitar información incorrecta.",
      botones: '<button type="button" class="btn btn--primary" id="retryBtn">Reintentar</button>',
      error: true
    });
    $("retryBtn").addEventListener("click", cargar);
  }
}

/* ---------- Inicio ---------- */
iniciarMapa();
cargar();

// Al volver con el botón Atrás desde P04 se recalculan las distancias con el punto nuevo
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  referencia = obtenerReferencia();
  if (datos) render({ ajustarMapa: true });
  else mostrarReferencia();
});
