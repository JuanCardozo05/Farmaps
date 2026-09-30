/* ==========================================================
   FARMAPS - A02 Panel de control administrativo
   ========================================================== */

import { iniciarPanel, esc, formatoNumero } from "../compartido/admin.js";
import { obtenerCatalogo, obtenerFarmacias, obtenerOfertas } from "../compartido/datos.js";
import { coordenadasValidas, dentroDeBogota } from "../compartido/ubicacion.js";

const $ = (id) => document.getElementById(id);
const POR_PAGINA = 8;
const MONEDAS_PERMITIDAS = ["COP"];

const formatoFecha = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
});

const precioTexto = (precio, moneda) =>
  typeof precio === "number" ? `$${formatoNumero.format(precio)} ${esc(moneda || "")}`.trim() : "Sin precio";
const plural = (n, uno, varios) => `${formatoNumero.format(n)} ${n === 1 ? uno : varios}`;

let usuario = null;
let datos = null;
let filtro = "todas";
let visibles = POR_PAGINA;

/* ---------- Sesión ---------- */
usuario = await iniciarPanel("A02");

/* ---------- Carga ---------- */
async function cargar() {
  $("loadError").hidden = true;
  try {
    const [{ medicamentos, presentaciones }, farmacias, ofertas] = await Promise.all([
      obtenerCatalogo(), obtenerFarmacias(), obtenerOfertas()
    ]);
    datos = analizar(medicamentos, presentaciones, farmacias, ofertas);
    pintarIndicadores();
    pintarIntegridad();
    pintarTabla();
    pintarAccesos();
    $("exportBtn").disabled = false;
  } catch (error) {
    console.error("Farmaps: no se pudo cargar el panel.", error);
    $("loadError").hidden = false;
    $("logBody").innerHTML = '<tr class="row-loading"><td colspan="7">No se pudieron cargar las actualizaciones.</td></tr>';
    $("checks").innerHTML = '<li class="check check--loading">No se pudo analizar el catálogo.</li>';
  }
}

$("retryBtn").addEventListener("click", cargar);

/* ---------- Análisis del catálogo ---------- */
function analizar(medicamentos, presentaciones, farmaciasMap, ofertas) {
  const farmacias = [...farmaciasMap.values()];
  const medPorId = new Map(medicamentos.map((m) => [m.id, m]));
  const presPorId = new Map(presentaciones.map((p) => [p.id, p]));

  const ofertasPorPres = new Map();
  ofertas.forEach((o) => ofertasPorPres.set(o.presentacionId, (ofertasPorPres.get(o.presentacionId) || 0) + 1));

  // Referencias: presentación → medicamento, oferta → farmacia y oferta → presentación
  const totalReferencias = presentaciones.length + ofertas.length * 2;
  const presHuerfanas = presentaciones.filter((p) => !medPorId.has(p.medicamentoId));
  const ofertasSinFarmacia = ofertas.filter((o) => !farmaciasMap.has(o.farmaciaId));
  const ofertasSinPres = ofertas.filter((o) => !presPorId.has(o.presentacionId));
  const huerfanas = presHuerfanas.length + ofertasSinFarmacia.length + ofertasSinPres.length;

  const coordOk = farmacias.filter((f) => coordenadasValidas(f.latitud, f.longitud) && dentroDeBogota(f.latitud, f.longitud));
  const preciosMal = ofertas.filter((o) => !(typeof o.precio === "number" && o.precio > 0) || !MONEDAS_PERMITIDAS.includes(o.moneda));
  const monedas = [...new Set(ofertas.map((o) => o.moneda).filter(Boolean))];

  const sinHorario = farmacias.filter((f) => !String(f.horario || "").trim());
  const medSinPres = medicamentos.filter((m) => !m.presentaciones.length);
  const presSinOfertas = presentaciones.filter((p) => !ofertasPorPres.has(p.id));
  const formas = new Set(presentaciones.map((p) => String(p.formaFarmaceutica || "").trim().toLowerCase()).filter(Boolean));

  const disponibles = ofertas.filter((o) => o.disponibilidadReportada === true).length;
  const ordenadas = [...ofertas].sort((a, b) => (b.fechaActualizacion?.getTime() || 0) - (a.fechaActualizacion?.getTime() || 0));

  let destacada = null;
  ofertasPorPres.forEach((n, id) => {
    if (presPorId.has(id) && (!destacada || n > destacada.n)) destacada = { id, n };
  });

  return {
    medicamentos, presentaciones, farmacias, ofertas, ordenadas, medPorId, presPorId, farmaciasMap,
    totalReferencias, huerfanas, presHuerfanas, ofertasSinFarmacia, ofertasSinPres,
    coordOk, preciosMal, monedas, sinHorario, medSinPres, presSinOfertas, formas, disponibles, destacada
  };
}

/* ---------- Indicadores ---------- */
function pintarValor(id, valor) {
  const el = $(id);
  el.textContent = formatoNumero.format(valor);
  el.classList.remove("skeleton");
}

function pintarChip(id, texto, tono = "") {
  const el = $(id);
  el.textContent = texto;
  el.className = `stat__chip ${tono}`.trim();
}

function pintarIndicadores() {
  const d = datos;
  const pctCoord = d.farmacias.length ? Math.round((d.coordOk.length / d.farmacias.length) * 100) : 0;

  pintarValor("statFarmacias", d.farmacias.length);
  pintarChip("chipFarmacias", `${pctCoord}% georreferenciadas`, pctCoord === 100 ? "" : "stat__chip--warn");
  $("descFarmacias").textContent = d.sinHorario.length
    ? `${d.coordOk.length} con coordenadas en Bogotá D.C. • ${plural(d.sinHorario.length, "sin horario", "sin horario")}`
    : `${d.coordOk.length} con coordenadas en Bogotá D.C. • Horarios completos`;

  pintarValor("statMedicamentos", d.medicamentos.length);
  pintarChip("chipMedicamentos", plural(d.presentaciones.length, "presentación", "presentaciones"), "stat__chip--plain");
  $("descMedicamentos").textContent = d.medSinPres.length
    ? `${plural(d.medSinPres.length, "medicamento", "medicamentos")} sin presentaciones registradas`
    : "Todos tienen al menos una presentación";

  pintarValor("statPresentaciones", d.presentaciones.length);
  pintarChip("chipPresentaciones", plural(d.formas.size, "forma farmacéutica", "formas farmacéuticas"));
  $("descPresentaciones").textContent = d.presSinOfertas.length
    ? `${plural(d.presSinOfertas.length, "presentación", "presentaciones")} sin ofertas registradas`
    : "Todas tienen ofertas registradas";

  pintarValor("statOfertas", d.ofertas.length);
  const pctDisp = d.ofertas.length ? Math.round((d.disponibles / d.ofertas.length) * 100) : 0;
  $("descOfertas").textContent = `${formatoNumero.format(d.disponibles)} con disponibilidad reportada (${pctDisp}%) • Moneda: ${d.monedas.join(", ") || "—"}`;

  $("cntTodas").textContent = formatoNumero.format(d.ofertas.length);
  $("cntDisp").textContent = formatoNumero.format(d.disponibles);
  $("cntNoDisp").textContent = formatoNumero.format(d.ofertas.length - d.disponibles);
}

/* ---------- Integridad ---------- */
const ICONOS = {
  ok: '<path d="M20 6 9 17l-5-5"/>',
  warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'
};

function itemCheck({ icono, estado, titulo, texto, enlace }) {
  return `
    <li class="check check--${estado}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[icono]}</svg>
      <div>
        <p class="check__title">${esc(titulo)}${enlace ? ` <a href="${esc(enlace)}">Revisar <span aria-hidden="true">→</span></a>` : ""}</p>
        <p class="check__text">${esc(texto)}</p>
      </div>
    </li>`;
}

function pintarIntegridad() {
  const d = datos;
  const validas = d.totalReferencias - d.huerfanas;
  const pct = d.totalReferencias ? Math.floor((validas / d.totalReferencias) * 1000) / 10 : 100;
  const pctTexto = `${formatoNumero.format(pct)}%`;

  $("integrityPct").textContent = pctTexto;
  $("integrityFill").style.width = `${pct}%`;
  $("integrityFill").classList.toggle("is-bad", d.huerfanas > 0);
  $("integrityBar").setAttribute("aria-valuenow", String(pct));
  $("integrityNote").textContent = d.huerfanas
    ? `${plural(d.huerfanas, "referencia huérfana", "referencias huérfanas")} de ${formatoNumero.format(d.totalReferencias)} verificadas`
    : `0 referencias huérfanas • ${formatoNumero.format(d.totalReferencias)} relaciones verificadas`;

  const coordMal = d.farmacias.length - d.coordOk.length;
  const errores = d.huerfanas + coordMal + d.preciosMal.length;
  const avisos = d.sinHorario.length + d.medSinPres.length + d.presSinOfertas.length;

  const badge = $("integrityBadge");
  badge.textContent = errores ? "Revisar" : avisos ? "Estable" : "Óptimo";
  badge.className = `status-badge ${errores ? "is-error" : avisos ? "is-warn" : ""}`.trim();

  const detalleHuerfanas = [
    d.presHuerfanas.length && plural(d.presHuerfanas.length, "presentación sin medicamento", "presentaciones sin medicamento"),
    d.ofertasSinFarmacia.length && plural(d.ofertasSinFarmacia.length, "oferta sin farmacia", "ofertas sin farmacia"),
    d.ofertasSinPres.length && plural(d.ofertasSinPres.length, "oferta sin presentación", "ofertas sin presentación")
  ].filter(Boolean).join(" • ");

  const pendientes = [
    d.sinHorario.length && plural(d.sinHorario.length, "farmacia sin horario", "farmacias sin horario"),
    d.medSinPres.length && plural(d.medSinPres.length, "medicamento sin presentaciones", "medicamentos sin presentaciones"),
    d.presSinOfertas.length && plural(d.presSinOfertas.length, "presentación sin ofertas", "presentaciones sin ofertas")
  ].filter(Boolean).join(" • ");

  const items = [
    d.huerfanas
      ? { icono: "error", estado: "error", titulo: "Referencias rotas", texto: detalleHuerfanas }
      : { icono: "ok", estado: "ok", titulo: "Relaciones consistentes", texto: "Todas las presentaciones apuntan a un medicamento y todas las ofertas a una farmacia y presentación existentes." },
    {
      icono: "map",
      estado: coordMal ? "error" : "ok",
      titulo: "Validación geográfica",
      texto: `${d.coordOk.length} de ${d.farmacias.length} farmacias tienen coordenadas válidas dentro de Bogotá D.C.`,
      enlace: coordMal ? "../A03/index.html" : ""
    },
    {
      icono: "money",
      estado: d.preciosMal.length ? "error" : "ok",
      titulo: "Precios y moneda",
      texto: d.preciosMal.length
        ? `${plural(d.preciosMal.length, "oferta tiene", "ofertas tienen")} precio inválido o moneda distinta de ${MONEDAS_PERMITIDAS.join(", ")}.`
        : `Todas las ofertas tienen precio mayor que cero en pesos colombianos (${MONEDAS_PERMITIDAS.join(", ")}).`,
      enlace: d.preciosMal.length ? "../A06/index.html" : ""
    },
    {
      icono: "list",
      estado: avisos ? "warn" : "ok",
      titulo: "Registros por completar",
      texto: pendientes || "No hay registros incompletos."
    },
    {
      icono: "lock",
      estado: "info",
      titulo: "Historial protegido",
      texto: "Las reglas de seguridad no permiten eliminar registros; cada cambio queda asociado al administrador que lo hizo."
    }
  ];

  $("checks").innerHTML = items.map(itemCheck).join("");
}

/* ---------- Tabla de actualizaciones ---------- */
function filtradas() {
  if (filtro === "disponibles") return datos.ordenadas.filter((o) => o.disponibilidadReportada === true);
  if (filtro === "agotadas") return datos.ordenadas.filter((o) => o.disponibilidadReportada !== true);
  return datos.ordenadas;
}

function responsable(uid) {
  if (!uid) return '<span class="muted">Sin registrar</span>';
  if (uid === usuario.uid) return `<span title="${esc(usuario.email || "")}">Tú</span>`;
  return `Otro administrador<br><span class="muted mono">${esc(uid.slice(0, 8))}…</span>`;
}

function filaOferta(o) {
  const pres = datos.presPorId.get(o.presentacionId);
  const med = pres && datos.medPorId.get(pres.medicamentoId);
  const farmacia = datos.farmaciasMap.get(o.farmaciaId);
  const nombre = med ? `${med.nombreComercial} ${pres.concentracion}` : o.presentacionId;
  const envase = pres ? `${pres.formaFarmaceutica} • ${pres.contenidoEnvase}` : "Presentación no encontrada";
  const disponible = o.disponibilidadReportada === true;
  const detalle = `../P05/index.html?presentacion=${encodeURIComponent(o.presentacionId)}&oferta=${encodeURIComponent(o.id)}`;

  return `
    <tr>
      <td><span class="module">A06</span></td>
      <td><strong>${esc(nombre)}</strong><br><span class="muted">${esc(envase)}</span></td>
      <td>${esc(farmacia?.nombre || "Farmacia no encontrada")}<br><span class="muted">${precioTexto(o.precio, o.moneda)}</span></td>
      <td>${responsable(o.actualizadoPor)}</td>
      <td><span class="state ${disponible ? "state--ok" : "state--off"}">${disponible ? "Disponible" : "No disponible"}</span></td>
      <td class="nowrap">${o.fechaActualizacion ? esc(formatoFecha.format(o.fechaActualizacion)) : '<span class="muted">Sin fecha</span>'}</td>
      <td class="nowrap"><a class="row-link" href="${detalle}" target="_blank" rel="noopener">Ver detalle</a></td>
    </tr>`;
}

function pintarTabla() {
  const lista = filtradas();
  const mostradas = lista.slice(0, visibles);
  $("logBody").innerHTML = mostradas.length
    ? mostradas.map(filaOferta).join("")
    : '<tr class="row-loading"><td colspan="7">No hay ofertas para este filtro.</td></tr>';
  $("logCount").textContent = `Mostrando ${formatoNumero.format(mostradas.length)} de ${plural(lista.length, "oferta", "ofertas")}`;
  $("moreBtn").hidden = mostradas.length >= lista.length;
}

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!datos) return;
    filtro = btn.dataset.filtro;
    visibles = POR_PAGINA;
    document.querySelectorAll(".filter").forEach((b) => {
      const activo = b === btn;
      b.classList.toggle("is-active", activo);
      b.setAttribute("aria-pressed", String(activo));
    });
    pintarTabla();
  });
});

$("moreBtn").addEventListener("click", () => {
  visibles += POR_PAGINA;
  pintarTabla();
});

/* ---------- Exportación ---------- */
$("exportBtn").addEventListener("click", () => {
  if (!datos) return;
  const limpiar = ({ presentaciones, _nombre, _principio, _indice, ...resto }) => resto;
  const contenido = {
    exportado: new Date().toISOString(),
    exportadoPor: usuario.email || usuario.uid,
    farmacias: datos.farmacias,
    medicamentos: datos.medicamentos.map(limpiar),
    presentaciones: datos.presentaciones,
    ofertas: datos.ofertas.map((o) => ({ ...o, fechaActualizacion: o.fechaActualizacion?.toISOString() || null }))
  };
  const blob = new Blob([JSON.stringify(contenido, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `farmaps-catalogo-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- Accesos a la consulta pública ---------- */
function pintarAccesos() {
  const d = datos.destacada;
  if (!d) return;
  const pres = datos.presPorId.get(d.id);
  const med = datos.medPorId.get(pres.medicamentoId);
  $("openComparator").href = `../P03/index.html?presentacion=${encodeURIComponent(d.id)}`;
  if (med) $("openComparator").title = `Ejemplo: ${med.nombreComercial} ${pres.concentracion} (${d.n} ofertas)`;
}

cargar();
