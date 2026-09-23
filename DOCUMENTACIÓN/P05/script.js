/* ==========================================================
   FARMAPS - P05 Detalle de oferta
   - Muestra la oferta, su presentación y la farmacia asociada.
   - Los distintivos se calculan solo contra ofertas de la misma
     presentación y moneda con disponibilidad reportada (RI-05, RI-07).
   - La distancia se calcula en el navegador desde el punto de la pestaña (RI-11).
   ========================================================== */

import {
  obtenerCatalogo,
  obtenerFarmacias,
  obtenerOferta,
  obtenerOfertasDePresentacion
} from "../compartido/datos.js";
import {
  coordenadasValidas,
  distanciaKm,
  formatoDistancia,
  obtenerReferencia
} from "../compartido/ubicacion.js";

const $ = (id) => document.getElementById(id);
const navbar = document.querySelector(".navbar");
const navToggle = $("navToggle");
const state = $("state");
const content = $("content");

const params = new URLSearchParams(location.search);
const ofertaId = params.get("oferta");
const referencia = obtenerReferencia();
let presentacionId = params.get("presentacion");
let medicamentoId = null;

/* ---------- Utilidades ---------- */
const escapar = (t = "") =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatoPrecio = (n) => `$ ${Math.round(n).toLocaleString("es-CO")}`;

function formatoFecha(fecha) {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) return "Fecha no registrada";
  return fecha.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ---------- Enlaces (la ubicación nunca viaja en la URL) ---------- */
function consulta(extra = {}) {
  const p = new URLSearchParams();
  if (params.get("q")) p.set("q", params.get("q"));
  if (presentacionId) p.set("presentacion", presentacionId);
  ["orden", "moneda"].forEach((k) => { if (params.get(k)) p.set(k, params.get(k)); });
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

function actualizarEnlaces() {
  document.querySelectorAll("[data-comparador]").forEach((a) => {
    a.href = presentacionId ? `../P03/index.html${consulta()}` : "../P03/index.html";
  });
  document.querySelectorAll("[data-referencia]").forEach((a) => {
    a.href = `../P04/index.html${consulta({ oferta: ofertaId, volver: ofertaId ? "detalle" : "" })}`;
  });
  const q = params.get("q");
  $("actChange").href = q
    ? `../P02/index.html?${new URLSearchParams({ q })}`
    : medicamentoId
      ? `../P02/index.html?${new URLSearchParams({ medicamento: medicamentoId })}`
      : "../index.html";
}

/* ---------- Menú móvil ---------- */
navToggle.addEventListener("click", () => {
  const abierto = navbar.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", abierto);
});

/* ---------- Punto de referencia ---------- */
function mostrarReferencia() {
  $("refLine").textContent = referencia ? `Referencia: ${referencia.etiqueta}` : "Referencia: sin definir";
  $("refLineLink").textContent = referencia ? "Cambiar" : "Definir";
}

/* ---------- Estados ---------- */
const ICONO_BUSCAR = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
const ICONO_ERROR = '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>';

function mostrarEstado({ icono, titulo, texto, botones = "", error = false }) {
  content.hidden = true;
  state.innerHTML = `
    <div class="state${error ? " state--error" : ""}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icono}</svg>
      <h2>${titulo}</h2>
      <p>${texto}</p>
      ${botones ? `<div class="state__actions">${botones}</div>` : ""}
    </div>`;
}

function mostrarCarga() {
  content.hidden = true;
  state.innerHTML = `
    <div class="layout layout--loading" aria-hidden="true">
      <div class="skeleton skeleton--tall"></div>
      <div class="skeleton skeleton--tall"></div>
    </div>`;
}

/* ---------- Distintivos frente a la competencia ---------- */
function distintivos(oferta, ofertas, farmacias) {
  const disponible = (o) => o.disponibilidadReportada === true && typeof o.precio === "number" && o.precio > 0;
  if (!disponible(oferta)) return { menorPrecio: false, masCercana: false, total: 0 };

  const comparables = ofertas.filter((o) => o.moneda === oferta.moneda && disponible(o) && farmacias.has(o.farmaciaId));
  if (comparables.length < 2) return { menorPrecio: false, masCercana: false, total: comparables.length };

  const menorPrecio = oferta.precio === Math.min(...comparables.map((o) => o.precio));

  let masCercana = false;
  if (referencia) {
    const metros = (o) => {
      const f = farmacias.get(o.farmaciaId);
      return coordenadasValidas(f.latitud, f.longitud)
        ? Math.round(distanciaKm(referencia, { lat: f.latitud, lng: f.longitud }) * 1000)
        : Infinity;
    };
    const propia = metros(oferta);
    masCercana = propia !== Infinity && propia === Math.min(...comparables.map(metros));
  }
  return { menorPrecio, masCercana, total: comparables.length };
}

/* ---------- Render ---------- */
const ICONO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';
const ICONO_FLECHA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 19-9-9 19-2-8-8-2z"/></svg>';

function render({ oferta, farmacia, presentacion, medicamento, marcas }) {
  const nombre = `${medicamento.nombreComercial} ${presentacion.concentracion}`;
  document.title = `${nombre} en ${farmacia.nombre} | Farmaps`;

  // Distintivos
  const chips = [];
  if (marcas.menorPrecio) chips.push(`<span class="chip">${ICONO_CHECK}Menor precio entre ${marcas.total} coincidencias</span>`);
  if (marcas.masCercana) chips.push(`<span class="chip">${ICONO_FLECHA}Más cercana entre las coincidencias</span>`);
  chips.push(`<span class="chip chip--muted">Moneda: ${escapar(oferta.moneda)}</span>`);
  $("offerChips").innerHTML = chips.join("");

  // Encabezado y precio
  $("medName").textContent = nombre;
  $("medActive").textContent = `Principio activo: ${medicamento.principioActivo}`;
  $("price").innerHTML = typeof oferta.precio === "number" && oferta.precio > 0
    ? `${formatoPrecio(oferta.precio)} <small>${escapar(oferta.moneda)}</small>`
    : '<small>Precio no registrado</small>';

  // RI-07: la falta de información no se interpreta como disponibilidad
  const stock = $("stock");
  if (oferta.disponibilidadReportada === true) {
    stock.className = "stock";
    stock.textContent = "Disponible (reportado por la farmacia)";
  } else if (oferta.disponibilidadReportada === false) {
    stock.className = "stock stock--no";
    stock.textContent = "No disponible según el último reporte";
  } else {
    stock.className = "stock stock--unknown";
    stock.textContent = "Disponibilidad no reportada";
  }
  $("updated").textContent = `Reporte: ${formatoFecha(oferta.fechaActualizacion)}`;

  // Presentación
  $("specConc").textContent = presentacion.concentracion;
  $("specForm").textContent = presentacion.formaFarmaceutica;
  $("specPack").textContent = presentacion.contenidoEnvase;
  $("specBrand").textContent = medicamento.nombreComercial;

  // Farmacia
  $("pharmName").textContent = farmacia.nombre;
  $("pharmAddr").textContent = farmacia.direccion;
  $("mapLabel").textContent = `Punto registrado: ${farmacia.direccion}`;

  const coordsOk = coordenadasValidas(farmacia.latitud, farmacia.longitud);
  const distancia = referencia && coordsOk
    ? distanciaKm(referencia, { lat: farmacia.latitud, lng: farmacia.longitud })
    : null;

  const distanceText = $("distanceText");
  if (distancia !== null) {
    const lugar = referencia.etiqueta.replace(/^Cerca de /, "").replace(/, Bogotá D\.C\.$/, "");
    distanceText.textContent = `Aprox. ${formatoDistancia(distancia)} en línea recta desde tu punto de referencia (${lugar}, Bogotá D.C.).`;
  } else if (!coordsOk) {
    distanceText.textContent = "No es posible calcular la distancia: la farmacia no tiene coordenadas registradas.";
  } else {
    const link = $("refLineLink").getAttribute("href");
    distanceText.innerHTML = `Sin punto de referencia. <a href="${escapar(link)}">Define tu ubicación</a> para calcular la distancia aproximada.`;
  }

  const routeBtn = $("routeBtn");
  if (coordsOk) {
    // Solo se envía el destino; el servicio externo pide su propio permiso de ubicación si lo necesita
    routeBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${farmacia.latitud},${farmacia.longitud}`;
    routeBtn.removeAttribute("aria-disabled");
  } else {
    routeBtn.removeAttribute("href");
    routeBtn.setAttribute("aria-disabled", "true");
  }

  // Horario (puede no estar registrado, RI-03)
  const horario = typeof farmacia.horario === "string" ? farmacia.horario.trim() : "";
  const schedule = $("schedule");
  schedule.textContent = horario || "Horario no registrado";
  schedule.classList.toggle("info-row__value--none", !horario);
  $("scheduleNote").textContent = horario
    ? "Horario declarado en el catálogo; festivos y turnos pueden variar."
    : "La farmacia no reportó su horario de atención. Confírmalo antes de desplazarte.";

  state.innerHTML = "";
  content.hidden = false;
  pintarMapa(farmacia, coordsOk, distancia);
}

/* ---------- Mapa ---------- */
function pintarMapa(farmacia, coordsOk, distancia) {
  const mapError = $("mapError");
  if (!window.L || !coordsOk) {
    mapError.hidden = false;
    if (!coordsOk) mapError.querySelector("span").textContent = "La farmacia no tiene coordenadas registradas.";
    return;
  }

  let mapa;
  try {
    mapa = L.map("map", { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
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
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
  })
    .on("tileload", () => { cargadas++; })
    .on("tileerror", () => { fallidas++; if (cargadas === 0 && fallidas >= 4) mapError.hidden = false; })
    .addTo(mapa);
  L.control.zoom({ position: "topleft" }).addTo(mapa);
  mapa.on("focus click", () => mapa.scrollWheelZoom.enable());
  mapa.on("blur mouseout", () => mapa.scrollWheelZoom.disable());

  const destino = [farmacia.latitud, farmacia.longitud];
  L.marker(destino, {
    title: farmacia.nombre,
    zIndexOffset: 500,
    icon: L.divIcon({
      className: "marcador",
      iconSize: [34, 42],
      iconAnchor: [17, 42],
      html: '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12M6 12h12"/></svg></span>'
    })
  }).addTo(mapa);

  const chip = $("mapChip");
  if (distancia !== null) {
    const origen = [referencia.lat, referencia.lng];
    L.marker(origen, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "ref-pin",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>'
      })
    }).bindTooltip("Tu referencia", { direction: "top", offset: [0, -14] }).addTo(mapa);
    L.polyline([origen, destino], { color: "#0A7BC4", weight: 2.5, dashArray: "6 7", interactive: false }).addTo(mapa);
    mapa.fitBounds([origen, destino], { paddingTopLeft: [40, 44], paddingBottomRight: [40, 44], maxZoom: 16 });

    chip.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7v4M10 7v3M14 7v4M18 7v3"/></svg>${formatoDistancia(distancia)}`;
    chip.hidden = false;
  } else {
    mapa.setView(destino, 16);
  }
}

/* ---------- Carga ---------- */
async function cargar() {
  mostrarReferencia();
  actualizarEnlaces();

  if (!ofertaId) {
    mostrarEstado({
      icono: ICONO_BUSCAR,
      titulo: "No se indicó ninguna oferta",
      texto: "Busca un medicamento, elige su presentación y selecciona una oferta en el comparador para ver su detalle.",
      botones: '<a class="btn btn--primary" href="../index.html">Buscar medicamento</a>'
    });
    return;
  }

  mostrarCarga();
  try {
    const oferta = await obtenerOferta(ofertaId);
    if (!oferta) {
      mostrarEstado({
        icono: ICONO_BUSCAR,
        titulo: "No encontramos esta oferta",
        texto: "El enlace puede estar incompleto o la oferta ya no está registrada. Vuelve al comparador o realiza una nueva búsqueda.",
        botones: `${presentacionId ? `<a class="btn btn--primary" href="../P03/index.html${escapar(consulta())}">Volver a resultados</a>` : ""}
                  <a class="btn btn--outline" href="../index.html">Nueva búsqueda</a>`
      });
      return;
    }

    presentacionId = oferta.presentacionId;
    const [catalogo, farmacias, ofertas] = await Promise.all([
      obtenerCatalogo(),
      obtenerFarmacias(),
      obtenerOfertasDePresentacion(oferta.presentacionId)
    ]);

    const presentacion = catalogo.presentaciones.find((p) => p.id === oferta.presentacionId);
    const medicamento = presentacion && catalogo.medicamentos.find((m) => m.id === presentacion.medicamentoId);
    const farmacia = farmacias.get(oferta.farmaciaId);
    if (!presentacion || !medicamento || !farmacia) {
      throw new Error("Oferta con referencias incompletas (RI-02).");
    }
    medicamentoId = medicamento.id;
    actualizarEnlaces();

    render({ oferta, farmacia, presentacion, medicamento, marcas: distintivos(oferta, ofertas, farmacias) });
  } catch (error) {
    console.error("Farmaps: error al consultar el detalle de la oferta.", error);
    mostrarEstado({
      icono: ICONO_ERROR,
      titulo: "No fue posible cargar el detalle",
      texto: "Hubo un problema al consultar la base de datos. No se muestra información para evitar datos incorrectos.",
      botones: '<button type="button" class="btn btn--primary" id="retryBtn">Reintentar</button>',
      error: true
    });
    $("retryBtn").addEventListener("click", cargar);
  }
}

cargar();

// Al volver con Atrás desde P04 se recarga para recalcular la distancia
window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });
