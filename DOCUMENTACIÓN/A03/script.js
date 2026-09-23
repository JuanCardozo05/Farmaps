/* ==========================================================
   FARMAPS - A03 Gestión de farmacias
   ========================================================== */

import { iniciarPanel, esc, formatoNumero, notificar, mensajeGuardado } from "../compartido/admin.js";
import { db } from "../compartido/firebase.js";
import { normalizar, obtenerOfertas, COLECCIONES } from "../compartido/datos.js";
import { BOGOTA, dentroDeBogota } from "../compartido/ubicacion.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const campos = {
  nombre: $("nombre"),
  direccion: $("direccion"),
  latitud: $("latitud"),
  longitud: $("longitud"),
  horario: $("horario")
};

const [[LAT_MIN, LNG_MIN], [LAT_MAX, LNG_MAX]] = BOGOTA.limites;
const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

let usuario = null;
let farmacias = [];
let ofertasPorFarmacia = new Map();
let editando = null;
let guardando = false;
let instantanea = "";

/* ---------- Sesión ---------- */
usuario = await iniciarPanel("A03");

/* ---------- Mapa ---------- */
let mapa = null;
let marcador = null;
let capaFarmacias = null;

function iniciarMapa() {
  if (mapa || typeof L === "undefined") return;
  mapa = L.map("map", {
    center: BOGOTA.centro,
    zoom: 11,
    minZoom: 10,
    maxBounds: BOGOTA.limitesMapa,
    maxBoundsViscosity: 1
  });
  mapa.attributionControl.setPrefix("Bogotá D.C.");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
  }).addTo(mapa);
  capaFarmacias = L.layerGroup().addTo(mapa);

  mapa.on("click", (e) => fijarDesdeMapa(e.latlng.lat, e.latlng.lng));
}

function iconoMarcador() {
  return L.divIcon({
    className: "pin",
    html: '<span class="pin__dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v10M7 12h10"/></svg></span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function fijarDesdeMapa(lat, lng) {
  campos.latitud.value = lat.toFixed(6);
  campos.longitud.value = lng.toFixed(6);
  marcarCampo(campos.latitud, "");
  marcarCampo(campos.longitud, "");
  actualizarMarcador(false);
}

function actualizarMarcador(centrar = true) {
  if (!mapa) return;
  const lat = leerNumero(campos.latitud.value);
  const lng = leerNumero(campos.longitud.value);
  const estado = $("geoStatus");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (marcador) { marcador.remove(); marcador = null; }
    estado.textContent = "Escribe las coordenadas o haz clic en el mapa.";
    estado.className = "geo__status";
    return;
  }

  const dentro = dentroDeBogota(lat, lng);
  estado.innerHTML = `<span class="mono">Lat: ${esc(lat.toFixed(6))} • Lon: ${esc(lng.toFixed(6))}</span>`
    + (dentro ? " — dentro de Bogotá D.C." : " — fuera de Bogotá D.C.");
  estado.className = `geo__status ${dentro ? "is-ok" : "is-error"}`;

  if (!dentro) {
    if (marcador) { marcador.remove(); marcador = null; }
    return;
  }

  if (!marcador) {
    marcador = L.marker([lat, lng], { icon: iconoMarcador(), draggable: true, keyboard: true, title: "Ubicación de la farmacia" }).addTo(mapa);
    marcador.on("dragend", () => {
      const p = marcador.getLatLng();
      if (dentroDeBogota(p.lat, p.lng)) fijarDesdeMapa(p.lat, p.lng);
      else actualizarMarcador(true);
    });
  } else {
    marcador.setLatLng([lat, lng]);
  }
  if (centrar) mapa.setView([lat, lng], Math.max(mapa.getZoom(), 15), { animate: false });
}

function pintarFarmaciasEnMapa() {
  if (!capaFarmacias) return;
  capaFarmacias.clearLayers();
  farmacias.forEach((f) => {
    if (editando && f.id === editando.id) return;
    if (!dentroDeBogota(f.latitud, f.longitud)) return;
    L.circleMarker([f.latitud, f.longitud], {
      radius: 5, weight: 1.5, color: "#64748B", fillColor: "#CBD5E1", fillOpacity: .9
    }).bindTooltip(`${esc(f.nombre)} (${esc(f.id)})`, { direction: "top" }).addTo(capaFarmacias);
  });
}

/* ---------- Carga ---------- */
async function cargar() {
  $("loadError").hidden = true;
  try {
    const [snap, ofertas] = await Promise.all([
      getDocs(collection(db, COLECCIONES.farmacias)),
      obtenerOfertas()
    ]);
    farmacias = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ofertasPorFarmacia = new Map();
    ofertas.forEach((o) => {
      const r = ofertasPorFarmacia.get(o.farmaciaId) || { total: 0, disponibles: 0 };
      r.total++;
      if (o.disponibilidadReportada === true) r.disponibles++;
      ofertasPorFarmacia.set(o.farmaciaId, r);
    });
    pintarTodo();

    const pedido = new URLSearchParams(location.search).get("editar");
    const objetivo = pedido && farmacias.find((f) => f.id === pedido);
    if (objetivo) editar(objetivo);
  } catch (error) {
    console.error("Farmaps: no se pudieron cargar las farmacias.", error);
    $("loadError").hidden = false;
    $("tbody").innerHTML = '<tr class="row-empty"><td colspan="6">No se pudieron cargar las farmacias.</td></tr>';
    $("countChip").textContent = "Sin conexión";
  }
}

$("retryBtn").addEventListener("click", cargar);

function pintarTodo() {
  const sinHorario = farmacias.filter((f) => !String(f.horario || "").trim()).length;
  const conOfertas = farmacias.filter((f) => ofertasPorFarmacia.get(f.id)?.total).length;
  $("countChip").textContent = `${formatoNumero.format(farmacias.length)} ${farmacias.length === 1 ? "farmacia registrada" : "farmacias registradas"}`;
  $("statTotal").textContent = formatoNumero.format(farmacias.length);
  $("statSinHorario").textContent = formatoNumero.format(sinHorario);
  $("statConOfertas").textContent = formatoNumero.format(conOfertas);
  pintarTabla();
  pintarFarmaciasEnMapa();
}

/* ---------- Tabla ---------- */
const numeroId = (id) => {
  const m = /^f(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

function ordenar(lista) {
  const criterio = $("sort").value;
  return [...lista].sort((a, b) => {
    if (criterio === "nombre") return a.nombre.localeCompare(b.nombre, "es");
    if (criterio === "ofertas") return (ofertasPorFarmacia.get(b.id)?.total || 0) - (ofertasPorFarmacia.get(a.id)?.total || 0);
    return numeroId(a.id) - numeroId(b.id) || a.id.localeCompare(b.id);
  });
}

function pintarTabla() {
  const consulta = normalizar($("search").value);
  const palabras = consulta ? consulta.split(/\s+/) : [];
  const lista = ordenar(farmacias.filter((f) => {
    if (!palabras.length) return true;
    const texto = normalizar(`${f.nombre} ${f.direccion} ${f.id}`);
    return palabras.every((p) => texto.includes(p));
  }));

  $("tbody").innerHTML = lista.length
    ? lista.map(fila).join("")
    : `<tr class="row-empty"><td colspan="6">${farmacias.length ? "Ninguna farmacia coincide con la búsqueda." : "Aún no hay farmacias registradas."}</td></tr>`;
  $("tableCount").textContent = palabras.length
    ? `${formatoNumero.format(lista.length)} de ${formatoNumero.format(farmacias.length)} farmacias`
    : `${formatoNumero.format(farmacias.length)} farmacias`;
}

function fila(f) {
  const ofertas = ofertasPorFarmacia.get(f.id);
  const horario = String(f.horario || "").trim();
  const activa = editando?.id === f.id;
  return `
    <tr class="${activa ? "is-editing" : ""}">
      <td>
        <div class="cell-name">
          <span class="cell-name__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V8l4-2V4h8v2l4 2v12"/><path d="M3 20h18"/><path d="M12 9v6M9 12h6"/></svg></span>
          <div>
            <strong>${esc(f.nombre)}</strong>
            <span class="cell-id mono">${esc(f.id)}</span>
          </div>
        </div>
      </td>
      <td>
        <span class="cell-address">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
          ${esc(f.direccion)}
        </span>
      </td>
      <td>${horario ? esc(horario) : '<span class="tag tag--warn">No registrado</span>'}</td>
      <td class="nowrap">${ofertas
        ? `<strong>${formatoNumero.format(ofertas.total)}</strong><span class="muted"> • ${formatoNumero.format(ofertas.disponibles)} disp.</span>`
        : '<span class="muted">Sin ofertas</span>'}</td>
      <td><span class="coords mono">${esc(formatoCoord(f.latitud))}, ${esc(formatoCoord(f.longitud))}</span></td>
      <td><button type="button" class="btn-edit" data-id="${esc(f.id)}" aria-label="Editar ${esc(f.nombre)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        ${activa ? "Editando" : "Editar"}
      </button></td>
    </tr>`;
}

const formatoCoord = (v) => (typeof v === "number" ? v.toFixed(4) : "—");

$("search").addEventListener("input", pintarTabla);
$("sort").addEventListener("change", pintarTabla);

$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-edit");
  if (!btn) return;
  const f = farmacias.find((x) => x.id === btn.dataset.id);
  if (!f) return;
  if (hayCambios() && editando?.id !== f.id && !confirm("Tienes cambios sin guardar. ¿Descartarlos y editar otra farmacia?")) return;
  editar(f);
});

/* ---------- Formulario ---------- */
const leerNumero = (texto) => {
  const limpio = String(texto).trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : NaN;
};

function valoresFormulario() {
  return Object.fromEntries(Object.entries(campos).map(([k, el]) => [k, el.value.trim()]));
}

const hayCambios = () => !guardando && JSON.stringify(valoresFormulario()) !== instantanea;
window.farmapsCambiosSinGuardar = hayCambios;

function tomarInstantanea() {
  instantanea = JSON.stringify(valoresFormulario());
}

function marcarCampo(input, mensaje) {
  $(`${input.id}Error`).textContent = mensaje;
  input.closest(".input").classList.toggle("is-invalid", !!mensaje);
  input.setAttribute("aria-invalid", mensaje ? "true" : "false");
}

function limpiarErrores() {
  Object.values(campos).forEach((el) => marcarCampo(el, ""));
  $("formAlert").hidden = true;
}

function modoCrear() {
  editando = null;
  form.reset();
  limpiarErrores();
  $("formTitle").textContent = "Crear nueva farmacia";
  $("formSubtitle").textContent = "Completa los datos del establecimiento y verifica su ubicación en el mapa.";
  $("formId").textContent = "se asigna al guardar";
  $("saveText").textContent = "Guardar farmacia";
  $("formCard").classList.remove("is-editing");
  if (mapa) {
    actualizarMarcador(false);
    mapa.setView(BOGOTA.centro, 11, { animate: false });
  }
  tomarInstantanea();
  pintarTabla();
  pintarFarmaciasEnMapa();
  history.replaceState(null, "", location.pathname);
}

function editar(f) {
  editando = f;
  limpiarErrores();
  campos.nombre.value = f.nombre || "";
  campos.direccion.value = f.direccion || "";
  campos.latitud.value = typeof f.latitud === "number" ? String(f.latitud) : "";
  campos.longitud.value = typeof f.longitud === "number" ? String(f.longitud) : "";
  campos.horario.value = f.horario || "";
  $("formTitle").textContent = `Editar farmacia: ${f.nombre}`;
  $("formSubtitle").textContent = "Modifica los datos y guarda los cambios. Las ofertas asociadas conservan su relación con esta farmacia.";
  $("formId").textContent = f.id;
  $("saveText").textContent = "Guardar cambios";
  $("formCard").classList.add("is-editing");
  tomarInstantanea();
  actualizarMarcador(true);
  pintarTabla();
  pintarFarmaciasEnMapa();
  history.replaceState(null, "", `${location.pathname}?editar=${encodeURIComponent(f.id)}`);
  $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  campos.nombre.focus({ preventScroll: true });
}

$("newBtn").addEventListener("click", () => {
  if (hayCambios() && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
  modoCrear();
  $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  campos.nombre.focus({ preventScroll: true });
});

$("cancelBtn").addEventListener("click", () => {
  if (hayCambios() && !confirm("¿Descartar los cambios del formulario?")) return;
  modoCrear();
});

// Permite pegar "4.6545, -74.0572" directamente en el campo de latitud.
campos.latitud.addEventListener("paste", (e) => {
  const texto = (e.clipboardData || window.clipboardData)?.getData("text") || "";
  const partes = texto.split(/[\s,;]+/).filter(Boolean);
  if (partes.length === 2 && partes.every((p) => Number.isFinite(leerNumero(p)))) {
    e.preventDefault();
    campos.latitud.value = partes[0];
    campos.longitud.value = partes[1];
    actualizarMarcador(true);
  }
});

let temporizador = null;
[campos.latitud, campos.longitud].forEach((el) => {
  el.addEventListener("input", () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => actualizarMarcador(true), 400);
  });
});

Object.values(campos).forEach((el) => {
  el.addEventListener("input", () => {
    if (el.getAttribute("aria-invalid") === "true") marcarCampo(el, "");
    $("formAlert").hidden = true;
  });
});

function validar() {
  const v = valoresFormulario();
  const errores = {};

  if (!v.nombre) errores.nombre = "Escribe el nombre de la farmacia.";
  else if (v.nombre.length < 3) errores.nombre = "El nombre debe tener al menos 3 caracteres.";

  if (!v.direccion) errores.direccion = "Escribe la dirección de la farmacia.";
  else if (v.direccion.length < 5) errores.direccion = "La dirección es demasiado corta.";

  const lat = leerNumero(v.latitud);
  const lng = leerNumero(v.longitud);
  if (!v.latitud) errores.latitud = "Escribe la latitud.";
  else if (!Number.isFinite(lat)) errores.latitud = "Usa un número decimal, por ejemplo 4.6712.";
  else if (lat < LAT_MIN || lat > LAT_MAX) errores.latitud = `Debe estar entre ${decimal.format(LAT_MIN)} y ${decimal.format(LAT_MAX)} (Bogotá D.C.).`;

  if (!v.longitud) errores.longitud = "Escribe la longitud.";
  else if (!Number.isFinite(lng)) errores.longitud = "Usa un número decimal, por ejemplo -74.0583.";
  else if (lng < LNG_MIN || lng > LNG_MAX) errores.longitud = `Debe estar entre ${decimal.format(LNG_MIN)} y ${decimal.format(LNG_MAX)} (Bogotá D.C.).`;

  if (!errores.nombre && !errores.direccion) {
    const duplicada = farmacias.find((f) => f.id !== editando?.id
      && normalizar(f.nombre) === normalizar(v.nombre)
      && normalizar(f.direccion) === normalizar(v.direccion));
    if (duplicada) errores.nombre = `Ya existe una farmacia con este nombre y dirección (${duplicada.id}).`;
  }

  Object.entries(campos).forEach(([k, el]) => marcarCampo(el, errores[k] || ""));
  const primero = Object.keys(campos).find((k) => errores[k]);
  if (primero) {
    campos[primero].focus();
    return null;
  }

  const datos = {
    nombre: v.nombre,
    direccion: v.direccion,
    latitud: Math.round(lat * 1e6) / 1e6,
    longitud: Math.round(lng * 1e6) / 1e6
  };
  if (v.horario) datos.horario = v.horario;
  return datos;
}

/* ---------- Guardado ---------- */
function siguienteId(desplazamiento = 0) {
  const max = farmacias.reduce((m, f) => {
    const n = numeroId(f.id);
    return n === Number.MAX_SAFE_INTEGER ? m : Math.max(m, n);
  }, 0);
  return `f${String(max + 1 + desplazamiento).padStart(2, "0")}`;
}

async function crear(datos) {
  for (let intento = 0; intento < 5; intento++) {
    const id = siguienteId(intento);
    const ref = doc(db, COLECCIONES.farmacias, id);
    const creado = await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) return false;
      tx.set(ref, datos);
      return true;
    });
    if (creado) return id;
  }
  throw new Error("No fue posible asignar un identificador nuevo. Recarga la página e inténtalo de nuevo.");
}

function estadoGuardando(activo) {
  guardando = activo;
  $("saveBtn").disabled = activo;
  $("cancelBtn").disabled = activo;
  $("saveBtn").classList.toggle("is-loading", activo);
  if (activo) $("saveText").textContent = "Guardando…";
  else $("saveText").textContent = editando ? "Guardar cambios" : "Guardar farmacia";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (guardando) return;
  $("formAlert").hidden = true;
  const base = validar();
  if (!base) return;

  // El tipo de dato y la fuente existentes se conservan; los registros nuevos usan el valor por defecto.
  const datos = {
    ...base,
    tipoDato: editando?.tipoDato || "simulado",
    actualizadoPor: usuario.uid
  };
  if (typeof editando?.fuente === "string") datos.fuente = editando.fuente;

  estadoGuardando(true);
  try {
    if (editando) {
      await setDoc(doc(db, COLECCIONES.farmacias, editando.id), datos);
      const i = farmacias.findIndex((f) => f.id === editando.id);
      farmacias[i] = { id: editando.id, ...datos };
      notificar(`Cambios guardados en "${datos.nombre}" (${editando.id}).`);
    } else {
      const id = await crear(datos);
      farmacias.push({ id, ...datos });
      notificar(`Farmacia "${datos.nombre}" creada con el ID ${id}.`);
    }
    estadoGuardando(false);
    modoCrear();
    pintarTodo();
  } catch (error) {
    console.error("Farmaps: no se pudo guardar la farmacia.", error);
    estadoGuardando(false);
    $("formAlert").textContent = `No se guardaron los cambios. ${mensajeGuardado(error)}`;
    $("formAlert").hidden = false;
  }
});

window.addEventListener("beforeunload", (e) => {
  if (hayCambios()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------- Inicio ---------- */
iniciarMapa();
tomarInstantanea();
cargar();
