/* ==========================================================
   FARMAPS - P04 Ubicación de referencia
   La ubicación se mantiene solo en esta pestaña (sessionStorage):
   no se envía a Firestore ni a otros servidores.
   ========================================================== */

import {
  BOGOTA,
  LUGARES,
  dentroDeBogota,
  describirPunto,
  obtenerReferencia,
  guardarReferencia,
  borrarReferencia
} from "../compartido/ubicacion.js";

// Pantallas a las que se puede volver (lista cerrada para evitar redirecciones externas)
const DESTINOS = {
  inicio: "../index.html",
  seleccion: "../P02/index.html",
  comparador: "../P03/index.html",
  detalle: "../P05/index.html"
};
const PARAMS_RETORNO = ["q", "medicamento", "presentacion", "orden", "moneda", "oferta"];

const $ = (id) => document.getElementById(id);
const modal = document.querySelector(".modal");
const gpsBtn = $("gpsBtn");
const gpsBtnText = $("gpsBtnText");
const gpsInfo = $("gpsInfo");
const gpsInfoText = $("gpsInfoText");
const currentBox = document.querySelector(".current");
const currentLabel = $("currentLabel");
const latValue = $("latValue");
const lngValue = $("lngValue");
const clearBtn = $("clearBtn");
const cancelBtn = $("cancelBtn");
const closeBtn = $("closeBtn");
const confirmBtn = $("confirmBtn");
const bestBtn = $("bestBtn");
const mapFallback = $("mapFallback");
const placeSelect = $("placeSelect");

const params = new URLSearchParams(location.search);
const volver = Object.hasOwn(DESTINOS, params.get("volver")) ? params.get("volver") : "inicio";

let seleccion = obtenerReferencia(); // { lat, lng, etiqueta, origen }
let mapa = null;
let marcador = null;

/* ---------- Navegación ---------- */
function urlDestino(pagina, extra = {}) {
  const p = new URLSearchParams();
  PARAMS_RETORNO.forEach((k) => { if (params.get(k)) p.set(k, params.get(k)); });
  Object.entries(extra).forEach(([k, v]) => p.set(k, v));
  const qs = p.toString();
  return qs ? `${pagina}?${qs}` : pagina;
}

cancelBtn.href = urlDestino(DESTINOS[volver]);
const cancelar = () => { location.href = cancelBtn.href; };
closeBtn.addEventListener("click", cancelar);

if (params.get("presentacion")) bestBtn.hidden = false;

confirmBtn.addEventListener("click", () => {
  if (!seleccion) return;
  guardarReferencia(seleccion);
  location.href = urlDestino(DESTINOS[volver]);
});

bestBtn.addEventListener("click", () => {
  if (!seleccion) return;
  guardarReferencia(seleccion);
  location.href = urlDestino(DESTINOS.comparador, { orden: "distancia" });
});

clearBtn.addEventListener("click", () => {
  borrarReferencia();
  seleccion = null;
  if (marcador) { marcador.remove(); marcador = null; }
  placeSelect.value = "";
  mostrarSeleccion();
  mensaje("Punto eliminado. Selecciona uno nuevo o cancela para continuar sin cercanía.");
});

/* ---------- Estado visual ---------- */
function mensaje(texto, tipo = "") {
  gpsInfoText.textContent = texto;
  gpsInfo.className = `info ${tipo}`.trim();
}

function mostrarSeleccion() {
  const hay = !!seleccion;
  currentBox.classList.toggle("is-empty", !hay);
  currentLabel.textContent = hay ? seleccion.etiqueta : "Aún no has seleccionado un punto";
  latValue.textContent = hay ? seleccion.lat.toFixed(4) : "—";
  lngValue.textContent = hay ? seleccion.lng.toFixed(4) : "—";
  clearBtn.hidden = !hay;
  confirmBtn.disabled = !hay;
  bestBtn.disabled = !hay;
}

function fijarPunto(lat, lng, origen = "manual", { centrar = false } = {}) {
  const base = describirPunto(lat, lng);
  seleccion = {
    lat,
    lng,
    origen,
    etiqueta: origen === "gps" ? `Mi ubicación actual · ${base.replace(/^Cerca de /, "cerca de ")}` : base
  };
  mostrarSeleccion();

  if (!mapa) return;
  if (!marcador) {
    marcador = L.marker([lat, lng], { icon: iconoPin(), draggable: true, keyboard: true, title: "Punto de referencia" })
      .addTo(mapa)
      .bindTooltip('<span class="punto"></span>Punto seleccionado', {
        permanent: true, direction: "top", offset: [0, -46], className: "pin-tooltip"
      });
    marcador.on("dragend", () => {
      const p = limitar(marcador.getLatLng());
      marcador.setLatLng(p);
      fijarPunto(p.lat, p.lng, "manual");
    });
  } else {
    marcador.setLatLng([lat, lng]);
  }
  if (centrar) mapa.setView([lat, lng], Math.max(mapa.getZoom(), 15));
}

/* ---------- Opción A: geolocalización ---------- */
const ERRORES_GPS = {
  1: "Permiso de ubicación denegado. Puedes seleccionar el punto manualmente en el mapa.",
  2: "No fue posible determinar tu ubicación. Revisa el GPS o la conexión, o selecciona el punto en el mapa.",
  3: "La detección tardó demasiado. Inténtalo de nuevo o selecciona el punto en el mapa."
};

function estadoGps(cargando) {
  gpsBtn.disabled = cargando;
  gpsBtn.classList.toggle("is-loading", cargando);
  gpsBtnText.textContent = cargando ? "Detectando ubicación…" : "Usar mi ubicación actual";
}

gpsBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    mensaje("Tu navegador no permite la geolocalización. Selecciona el punto en el mapa.", "is-error");
    return;
  }
  if (!window.isSecureContext) {
    mensaje("La geolocalización requiere una conexión segura (HTTPS). Selecciona el punto en el mapa.", "is-error");
    return;
  }

  estadoGps(true);
  mensaje("Esperando el permiso del navegador…");

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      estadoGps(false);
      const { latitude: lat, longitude: lng, accuracy } = coords;
      if (!dentroDeBogota(lat, lng)) {
        mensaje("La ubicación detectada está fuera de Bogotá D.C., el área cubierta por Farmaps. Selecciona un punto en el mapa.", "is-error");
        return;
      }
      fijarPunto(lat, lng, "gps", { centrar: true });
      const precision = Number.isFinite(accuracy) ? ` Precisión aproximada: ± ${Math.round(accuracy)} m.` : "";
      mensaje(`Ubicación detectada.${precision} Puedes ajustar el marcador si lo necesitas.`, "is-ok");
    },
    (error) => {
      estadoGps(false);
      mensaje(ERRORES_GPS[error.code] || ERRORES_GPS[2], "is-error");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

/* ---------- Opción B: mapa ---------- */
function iconoPin() {
  return L.divIcon({
    className: "pin",
    iconSize: [38, 50],
    iconAnchor: [19, 48],
    html: `<svg viewBox="0 0 38 50" aria-hidden="true">
      <path d="M19 1C9.1 1 1 9 1 18.8 1 31.7 19 49 19 49s18-17.3 18-30.2C37 9 28.9 1 19 1Z" fill="#0A7BC4" stroke="#fff" stroke-width="2"/>
      <circle cx="19" cy="18" r="8.5" fill="#fff"/>
      <path d="M19 13.5v9M14.5 18h9" stroke="#0A7BC4" stroke-width="2.6" stroke-linecap="round"/>
    </svg>`
  });
}

function limitar(latlng) {
  const [[s, o], [n, e]] = BOGOTA.limites;
  return L.latLng(Math.min(Math.max(latlng.lat, s), n), Math.min(Math.max(latlng.lng, o), e));
}

function controlRecentrar() {
  const Control = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const a = L.DomUtil.create("a", "recentrar", div);
      a.href = "#";
      a.title = "Centrar en el punto o en Bogotá";
      a.setAttribute("role", "button");
      a.setAttribute("aria-label", "Centrar mapa");
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>';
      L.DomEvent.on(a, "click", (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (seleccion) mapa.setView([seleccion.lat, seleccion.lng], 15);
        else mapa.setView(BOGOTA.centro, 12);
      });
      return div;
    }
  });
  return new Control();
}

function mostrarRespaldo() {
  if (!placeSelect.options.length || placeSelect.options.length === 1) {
    [...LUGARES]
      .sort((a, b) => a.localidad.localeCompare(b.localidad, "es") || a.nombre.localeCompare(b.nombre, "es"))
      .forEach((l, i) => placeSelect.add(new Option(`${l.localidad} – ${l.nombre}`, String(LUGARES.indexOf(l)))));
  }
  mapFallback.hidden = false;
}

placeSelect.addEventListener("change", () => {
  const l = LUGARES[Number(placeSelect.value)];
  if (l) fijarPunto(l.lat, l.lng, "manual");
});

function iniciarMapa() {
  if (!window.L) {
    mostrarRespaldo();
    return;
  }

  try {
    mapa = L.map("map", {
      center: seleccion ? [seleccion.lat, seleccion.lng] : BOGOTA.centro,
      zoom: seleccion ? 15 : 12,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: BOGOTA.limitesMapa,
      maxBoundsViscosity: 1
    });
  } catch (error) {
    console.error("Farmaps: no se pudo iniciar el mapa.", error);
    mostrarRespaldo();
    return;
  }

  mapa.attributionControl.setPrefix("Bogotá D.C. (EPSG:4326)");
  controlRecentrar().addTo(mapa);

  let cargadas = 0;
  let fallidas = 0;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
  })
    .on("tileload", () => { cargadas++; })
    .on("tileerror", () => {
      fallidas++;
      if (cargadas === 0 && fallidas >= 4) mostrarRespaldo();
    })
    .addTo(mapa);

  mapa.on("click", (e) => {
    const p = limitar(e.latlng);
    fijarPunto(p.lat, p.lng, "manual");
  });

  // Teclado: Enter fija el punto en el centro del mapa visible
  mapa.getContainer().addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target === mapa.getContainer()) {
      const c = limitar(mapa.getCenter());
      fijarPunto(c.lat, c.lng, "manual");
    }
  });
  mapa.getContainer().setAttribute(
    "aria-label",
    "Mapa de Bogotá. Usa las flechas para moverte y Enter para fijar el punto en el centro."
  );

  if (seleccion) fijarPunto(seleccion.lat, seleccion.lng, seleccion.origen);
}

/* ---------- Accesibilidad del modal ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cancelar();
    return;
  }
  if (e.key !== "Tab") return;
  const focusables = [...modal.querySelectorAll('a[href], button:not([disabled]), select, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hidden && el.offsetParent !== null);
  if (!focusables.length) return;
  const primero = focusables[0];
  const ultimo = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
});

/* ---------- Inicio ---------- */
mostrarSeleccion();
iniciarMapa();
gpsBtn.focus({ preventScroll: true });
