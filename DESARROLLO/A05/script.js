/* ==========================================================
   FARMAPS - A05 Gestión de presentaciones
   ========================================================== */

import { iniciarPanel, esc, formatoNumero, notificar, mensajeGuardado } from "../compartido/admin.js";
import { db } from "../compartido/firebase.js";
import { normalizar, COLECCIONES } from "../compartido/datos.js";
import {
  collection,
  doc,
  getDocs,
  getCountFromServer,
  query,
  where,
  setDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const OTRA = "__otra__";
const POR_PAGINA = 10;

const campos = {
  medicamentoId: $("medicamentoId"),
  concentracion: $("concentracion"),
  formaSelect: $("formaSelect"),
  formaFarmaceutica: $("formaFarmaceutica"),
  contenidoEnvase: $("contenidoEnvase")
};

let usuario = null;
let medicamentos = new Map();
let presentaciones = [];
let huerfanas = 0;
// presentacionId -> número de ofertas con disponibilidad reportada (undefined mientras carga, null si falló)
let disponibles = new Map();
let conteoListo = false;
let editando = null;
let guardando = false;
let instantanea = "";
let filtroMed = "";
let pagina = 1;

/* ---------- Sesión ---------- */
usuario = await iniciarPanel("A05");

/* ---------- Utilidades ---------- */
/** Mismo formato de identificador que usa la carga inicial de datos. */
function slug(texto) {
  return String(texto)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/%/g, "pct").replace(/[/+]/g, "-")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const compacto = (t) => normalizar(t).replace(/\s+/g, "");
const textoLimpio = (t) => String(t).trim().replace(/\s+/g, " ");

function idBase(medId, conc, envase) {
  const cola = slug(`${conc} ${envase}`);
  return `${medId}-${cola || "presentacion"}`.slice(0, 140).replace(/-+$/, "");
}

function idDisponible(base, desplazamiento = 0) {
  const usados = new Set(presentaciones.map((p) => p.id));
  let n = 1;
  let candidato = base;
  let saltos = desplazamiento;
  while (usados.has(candidato) || saltos > 0) {
    if (!usados.has(candidato)) saltos--;
    n++;
    candidato = `${base}-${n}`;
  }
  return candidato;
}

const nombreMed = (id) => medicamentos.get(id)?.nombreComercial || id;

function iniciales(nombre) {
  const palabras = normalizar(nombre).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letras = palabras.length > 1 ? palabras[0][0] + palabras[1][0] : (palabras[0] || "?").slice(0, 2);
  return letras.toUpperCase();
}

function colorAvatar(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}

const ICONOS = {
  gota: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>',
  tubo: '<path d="M8 3h8v3l-1 2v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V8L8 6z"/><path d="M10 12h4"/>',
  spray: '<rect x="7" y="9" width="10" height="12" rx="2"/><path d="M10 9V6h4v3M14 4h3M17 2v4"/>',
  capsula: '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="m9.7 8.7 4.6 6.6"/>',
  tableta: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'
};

function iconoForma(forma) {
  const f = normalizar(forma);
  let clave = "tableta";
  if (/jarabe|suspension|solucion|gotas/.test(f)) clave = "gota";
  else if (/crema|gel|unguento|pomada/.test(f)) clave = "tubo";
  else if (/aerosol|inhala|spray/.test(f)) clave = "spray";
  else if (/capsula/.test(f)) clave = "capsula";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[clave]}</svg>`;
}

function plural(n, uno, varios) {
  return `${formatoNumero.format(n)} ${n === 1 ? uno : varios}`;
}

/* ---------- Carga ---------- */
async function cargar() {
  $("loadError").hidden = true;
  try {
    const [snapMed, snapPres] = await Promise.all([
      getDocs(collection(db, COLECCIONES.medicamentos)),
      getDocs(collection(db, COLECCIONES.presentaciones))
    ]);
    medicamentos = new Map(snapMed.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    presentaciones = snapPres.docs.map((d) => ({ id: d.id, ...d.data() }));
    huerfanas = presentaciones.filter((p) => !medicamentos.has(p.medicamentoId)).length;

    llenarMedicamentos();
    pintarTodo();
    abrirDesdeEnlace();
    contarOfertas();
  } catch (error) {
    console.error("Farmaps: no se pudieron cargar las presentaciones.", error);
    $("loadError").hidden = false;
    $("tbody").innerHTML = '<tr class="row-empty"><td colspan="6">No se pudieron cargar las presentaciones.</td></tr>';
    $("statTotal").textContent = "–";
    $("recordsChip").textContent = "Sin conexión";
  }
}

$("retryBtn").addEventListener("click", cargar);

/**
 * Cuenta las ofertas disponibles de cada presentación con consultas de conteo
 * (cada una cuesta una sola lectura, en vez de descargar todas las ofertas).
 */
async function contarOfertas() {
  conteoListo = false;
  disponibles = new Map();
  const pendientes = presentaciones.map((p) => p.id);
  const trabajar = async () => {
    while (pendientes.length) {
      const id = pendientes.shift();
      try {
        const q = query(
          collection(db, COLECCIONES.ofertas),
          where("presentacionId", "==", id),
          where("disponibilidadReportada", "==", true)
        );
        disponibles.set(id, (await getCountFromServer(q)).data().count);
      } catch (error) {
        console.warn("Farmaps: no se pudo contar las ofertas de", id, error);
        disponibles.set(id, null);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajar));
  conteoListo = true;
  pintarTabla();
  pintarResumen();
  notaVinculos();
}

function llenarMedicamentos() {
  const lista = [...medicamentos.values()].sort((a, b) => a.nombreComercial.localeCompare(b.nombreComercial, "es"));
  campos.medicamentoId.innerHTML = '<option value="">Selecciona un medicamento del catálogo…</option>'
    + lista.map((m) => `<option value="${esc(m.id)}">${esc(m.nombreComercial)} — ${esc(m.principioActivo)}</option>`).join("");
}

function formasRegistradas() {
  const formas = new Map();
  presentaciones.forEach((p) => {
    const clave = normalizar(p.formaFarmaceutica);
    if (clave && !formas.has(clave)) formas.set(clave, p.formaFarmaceutica);
  });
  return [...formas.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function llenarFormas() {
  const formas = formasRegistradas();
  const filtroActual = $("formaFilter").value;
  $("formaFilter").innerHTML = '<option value="">Todas las formas farmacéuticas</option>'
    + formas.map((f) => `<option value="${esc(normalizar(f))}">${esc(f)}</option>`).join("");
  $("formaFilter").value = formas.some((f) => normalizar(f) === filtroActual) ? filtroActual : "";

  const elegido = campos.formaSelect.value;
  campos.formaSelect.innerHTML = '<option value="">Selecciona la forma farmacéutica…</option>'
    + formas.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")
    + `<option value="${OTRA}">Otra forma farmacéutica…</option>`;
  if (elegido) campos.formaSelect.value = elegido;
}

function abrirDesdeEnlace() {
  const params = new URLSearchParams(location.search);
  const pedido = params.get("editar");
  const objetivo = pedido && presentaciones.find((p) => p.id === pedido);
  const med = params.get("medicamento");

  if (med && medicamentos.has(med)) {
    filtroMed = med;
    pintarTabla();
  }
  if (objetivo) {
    editar(objetivo, { desplazar: true });
  } else {
    modoCrear();
    if (params.get("nuevo") === "1" || med) enfocarFormulario();
  }
}

function pintarTodo() {
  llenarFormas();
  const total = presentaciones.length;
  const medsConPres = new Set(presentaciones.map((p) => p.medicamentoId)).size;
  $("statTotal").textContent = formatoNumero.format(total);
  $("statSub").textContent = `de ${plural(medsConPres, "medicamento", "medicamentos")}`;
  pintarTabla();
  pintarResumen();
}

function pintarResumen() {
  const sinPres = [...medicamentos.keys()].filter((id) => !presentaciones.some((p) => p.medicamentoId === id)).length;
  const partes = [];
  partes.push(huerfanas
    ? `<strong>${plural(huerfanas, "presentación apunta", "presentaciones apuntan")}</strong> a un medicamento que no existe.`
    : "Todas las presentaciones están vinculadas a un medicamento existente.");
  partes.push(sinPres
    ? `<strong>${plural(sinPres, "medicamento aún no tiene", "medicamentos aún no tienen")}</strong> presentaciones.`
    : "Cada medicamento tiene al menos una presentación.");
  $("insightIntegridad").innerHTML = partes.join(" ");

  if (!conteoListo) {
    $("insightOfertas").textContent = "Contando ofertas disponibles…";
    return;
  }
  const valores = presentaciones.map((p) => disponibles.get(p.id));
  if (valores.some((v) => v === null)) {
    $("insightOfertas").textContent = "No fue posible contar todas las ofertas en este momento.";
    return;
  }
  const suma = valores.reduce((s, v) => s + (v || 0), 0);
  const sinOfertas = valores.filter((v) => !v).length;
  $("insightOfertas").innerHTML = `<strong>${plural(suma, "oferta disponible", "ofertas disponibles")}</strong> vinculadas a ${plural(presentaciones.length, "presentación", "presentaciones")}.`
    + (sinOfertas ? ` ${plural(sinOfertas, "presentación no tiene", "presentaciones no tienen")} ofertas disponibles.` : "");
}

/* ---------- Tabla ---------- */
function filtrar() {
  const consulta = normalizar($("search").value);
  const palabras = consulta ? consulta.split(/\s+/) : [];
  const forma = $("formaFilter").value;
  return presentaciones
    .filter((p) => {
      if (filtroMed && p.medicamentoId !== filtroMed) return false;
      if (forma && normalizar(p.formaFarmaceutica) !== forma) return false;
      if (!palabras.length) return true;
      const m = medicamentos.get(p.medicamentoId);
      const texto = normalizar([
        m?.nombreComercial, m?.principioActivo, p.concentracion, compacto(p.concentracion),
        p.formaFarmaceutica, p.contenidoEnvase, p.id
      ].join(" "));
      return palabras.every((w) => texto.includes(w));
    })
    .sort((a, b) => nombreMed(a.medicamentoId).localeCompare(nombreMed(b.medicamentoId), "es")
      || a.concentracion.localeCompare(b.concentracion, "es", { numeric: true })
      || a.contenidoEnvase.localeCompare(b.contenidoEnvase, "es", { numeric: true }));
}

function pintarTabla() {
  const lista = filtrar();
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(Math.max(1, pagina), paginas);
  const visibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  let vacio = "Aún no hay presentaciones registradas.";
  if (presentaciones.length) vacio = "Ninguna presentación coincide con los filtros.";
  if (filtroMed && !presentaciones.some((p) => p.medicamentoId === filtroMed)) {
    vacio = `${esc(nombreMed(filtroMed))} aún no tiene presentaciones. Regístrala con el formulario.`;
  }

  $("tbody").innerHTML = visibles.length
    ? visibles.map(fila).join("")
    : `<tr class="row-empty"><td colspan="6">${vacio}</td></tr>`;

  $("recordsChip").textContent = lista.length === presentaciones.length
    ? plural(presentaciones.length, "registro", "registros")
    : `${formatoNumero.format(lista.length)} de ${formatoNumero.format(presentaciones.length)}`;
  $("pageInfo").innerHTML = `Página <strong>${pagina}</strong> de ${paginas}`;
  $("prevPage").disabled = pagina <= 1;
  $("nextPage").disabled = pagina >= paginas;

  $("medFilter").hidden = !filtroMed;
  if (filtroMed) $("medFilterText").textContent = `Medicamento: ${nombreMed(filtroMed)}`;
}

function celdaOfertas(id) {
  const n = disponibles.get(id);
  if (n === undefined) return '<span class="pill pill--wait">Contando</span>';
  if (n === null) return '<span class="muted">—</span>';
  if (!n) return '<span class="pill pill--none">Sin ofertas</span>';
  return `<a class="pill pill--ok" href="../A06/index.html?presentacion=${encodeURIComponent(id)}" title="${plural(n, "oferta disponible", "ofertas disponibles")}. Ver en Ofertas">${formatoNumero.format(n)} disp.</a>`;
}

function fila(p) {
  const m = medicamentos.get(p.medicamentoId);
  const activa = editando?.id === p.id;
  const nombre = m ? m.nombreComercial : "Medicamento no encontrado";
  return `
    <tr class="${activa ? "is-editing" : ""}">
      <td>
        <div class="cell-med">
          <span class="avatar avatar--${colorAvatar(p.medicamentoId)}" aria-hidden="true">${esc(iniciales(nombre))}</span>
          <div>
            <strong>${esc(nombre)}</strong>
            <small>${m ? esc(m.principioActivo) : `<span class="tag tag--warn">${esc(p.medicamentoId)}</span>`}</small>
          </div>
        </div>
      </td>
      <td><span class="conc">${esc(p.concentracion)}</span></td>
      <td><span class="forma">${iconoForma(p.formaFarmaceutica)}${esc(p.formaFarmaceutica)}</span></td>
      <td class="envase">${esc(p.contenidoEnvase)}</td>
      <td>${celdaOfertas(p.id)}</td>
      <td><button type="button" class="btn-edit" data-id="${esc(p.id)}" aria-label="Editar ${esc(nombre)} ${esc(p.concentracion)} ${esc(p.contenidoEnvase)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        ${activa ? "Editando" : "Editar"}
      </button></td>
    </tr>`;
}

$("search").addEventListener("input", () => { pagina = 1; pintarTabla(); });
$("formaFilter").addEventListener("change", () => { pagina = 1; pintarTabla(); });
$("prevPage").addEventListener("click", () => { pagina--; pintarTabla(); });
$("nextPage").addEventListener("click", () => { pagina++; pintarTabla(); });
$("medFilterClear").addEventListener("click", () => {
  filtroMed = "";
  pagina = 1;
  actualizarUrl();
  pintarTabla();
});

$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-edit");
  if (!btn) return;
  const p = presentaciones.find((x) => x.id === btn.dataset.id);
  if (!p) return;
  if (editando?.id === p.id) return enfocarFormulario();
  if (hayCambios() && !confirm("Tienes cambios sin guardar. ¿Descartarlos y editar otra presentación?")) return;
  editar(p, { desplazar: true });
});

/* ---------- Formulario ---------- */
function formaElegida() {
  return campos.formaSelect.value === OTRA
    ? textoLimpio(campos.formaFarmaceutica.value)
    : campos.formaSelect.value;
}

function valoresFormulario() {
  return {
    medicamentoId: campos.medicamentoId.value,
    concentracion: textoLimpio(campos.concentracion.value),
    formaFarmaceutica: formaElegida(),
    contenidoEnvase: textoLimpio(campos.contenidoEnvase.value)
  };
}

const hayCambios = () => !guardando && JSON.stringify(valoresFormulario()) !== instantanea;
window.farmapsCambiosSinGuardar = hayCambios;

function tomarInstantanea() {
  instantanea = JSON.stringify(valoresFormulario());
}

function marcarCampo(clave, mensaje) {
  const input = clave === "formaFarmaceutica"
    ? (campos.formaSelect.value === OTRA ? campos.formaFarmaceutica : campos.formaSelect)
    : campos[clave];
  $(`${clave}Error`).textContent = mensaje;
  if (clave === "formaFarmaceutica") {
    [campos.formaSelect, campos.formaFarmaceutica].forEach((el) => {
      el.closest(".input").classList.remove("is-invalid");
      el.setAttribute("aria-invalid", "false");
    });
  }
  input.closest(".input").classList.toggle("is-invalid", !!mensaje);
  input.setAttribute("aria-invalid", mensaje ? "true" : "false");
}

const CLAVES = ["medicamentoId", "concentracion", "formaFarmaceutica", "contenidoEnvase"];

function limpiarErrores() {
  CLAVES.forEach((k) => marcarCampo(k, ""));
  $("formAlert").hidden = true;
}

function mostrarFormaOtra() {
  const otra = campos.formaSelect.value === OTRA;
  $("formaOtraBox").hidden = !otra;
  campos.formaSelect.classList.toggle("is-placeholder", !campos.formaSelect.value);
  campos.medicamentoId.classList.toggle("is-placeholder", !campos.medicamentoId.value);
  return otra;
}

function fijarForma(valor) {
  const existe = [...campos.formaSelect.options].some((o) => o.value === valor && valor !== OTRA);
  if (!valor) {
    campos.formaSelect.value = "";
    campos.formaFarmaceutica.value = "";
  } else if (existe) {
    campos.formaSelect.value = valor;
    campos.formaFarmaceutica.value = "";
  } else {
    campos.formaSelect.value = OTRA;
    campos.formaFarmaceutica.value = valor;
  }
  mostrarFormaOtra();
}

function actualizarId() {
  if (editando) return;
  const v = valoresFormulario();
  $("formId").textContent = v.medicamentoId && (v.concentracion || v.contenidoEnvase)
    ? idDisponible(idBase(v.medicamentoId, v.concentracion, v.contenidoEnvase))
    : "se genera con los datos";
}

function actualizarUrl() {
  const params = new URLSearchParams();
  if (editando) params.set("editar", editando.id);
  else if (filtroMed) params.set("medicamento", filtroMed);
  const qs = params.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

function modoCrear() {
  editando = null;
  form.reset();
  limpiarErrores();
  campos.medicamentoId.disabled = false;
  if (filtroMed) campos.medicamentoId.value = filtroMed;
  fijarForma("");
  $("medNote").hidden = true;
  $("linkedNote").hidden = true;
  $("formTitle").textContent = "Nueva presentación";
  $("modeChip").textContent = "Creación";
  $("saveText").textContent = "Guardar presentación";
  $("formCard").classList.remove("is-editing");
  actualizarId();
  tomarInstantanea();
  actualizarUrl();
  pintarTabla();
}

function editar(p, { desplazar = false } = {}) {
  editando = p;
  limpiarErrores();
  campos.medicamentoId.value = p.medicamentoId;
  campos.medicamentoId.disabled = true;
  campos.concentracion.value = p.concentracion || "";
  campos.contenidoEnvase.value = p.contenidoEnvase || "";
  fijarForma(p.formaFarmaceutica || "");
  $("medNote").hidden = false;
  $("formTitle").textContent = "Editar presentación";
  $("modeChip").textContent = "Edición";
  $("formId").textContent = p.id;
  $("saveText").textContent = "Guardar cambios";
  $("formCard").classList.add("is-editing");
  notaVinculos();

  tomarInstantanea();
  actualizarUrl();
  const indice = filtrar().findIndex((x) => x.id === p.id);
  if (indice >= 0) pagina = Math.floor(indice / POR_PAGINA) + 1;
  pintarTabla();
  if (desplazar) enfocarFormulario();
}

function notaVinculos() {
  const n = editando ? disponibles.get(editando.id) : 0;
  $("linkedNote").hidden = !n;
  $("linkedText").textContent = n
    ? `Tiene ${plural(n, "oferta disponible", "ofertas disponibles")} en farmacias. Los cambios se verán de inmediato en el sitio público.`
    : "";
}

function enfocarFormulario() {
  if (window.matchMedia("(max-width: 1180px)").matches) {
    $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const primero = campos.medicamentoId.disabled || campos.medicamentoId.value ? campos.concentracion : campos.medicamentoId;
  primero.focus({ preventScroll: true });
}

$("newBtn").addEventListener("click", () => {
  if (hayCambios() && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
  modoCrear();
  enfocarFormulario();
});

$("cancelBtn").addEventListener("click", () => {
  if (hayCambios() && !confirm("¿Descartar los cambios del formulario?")) return;
  modoCrear();
});

campos.formaSelect.addEventListener("change", () => {
  if (mostrarFormaOtra()) campos.formaFarmaceutica.focus();
});
campos.medicamentoId.addEventListener("change", mostrarFormaOtra);

const alCambiar = (clave) => () => {
  $("formAlert").hidden = true;
  if ($(`${clave}Error`).textContent) marcarCampo(clave, "");
  actualizarId();
};
campos.medicamentoId.addEventListener("change", alCambiar("medicamentoId"));
campos.concentracion.addEventListener("input", alCambiar("concentracion"));
campos.formaSelect.addEventListener("change", alCambiar("formaFarmaceutica"));
campos.formaFarmaceutica.addEventListener("input", alCambiar("formaFarmaceutica"));
campos.contenidoEnvase.addEventListener("input", alCambiar("contenidoEnvase"));

function validar() {
  const v = valoresFormulario();
  const errores = {};

  if (!v.medicamentoId) errores.medicamentoId = "Selecciona el medicamento al que pertenece.";
  else if (!medicamentos.has(v.medicamentoId)) errores.medicamentoId = "El medicamento seleccionado ya no existe. Recarga la página.";

  if (!v.concentracion) errores.concentracion = "Escribe la concentración.";
  else if (!/\d/.test(v.concentracion)) errores.concentracion = "Incluye la cantidad, por ejemplo 500 mg.";
  else if (!/[a-zA-Zµ%]/.test(v.concentracion)) errores.concentracion = "Incluye la unidad de medida (mg, g, mcg, mL o %).";

  if (!v.formaFarmaceutica) {
    errores.formaFarmaceutica = campos.formaSelect.value === OTRA
      ? "Escribe la forma farmacéutica."
      : "Selecciona la forma farmacéutica.";
  } else if (v.formaFarmaceutica.length < 3) errores.formaFarmaceutica = "Debe tener al menos 3 caracteres.";

  if (!v.contenidoEnvase) errores.contenidoEnvase = "Escribe el contenido del envase.";
  else if (v.contenidoEnvase.length < 3) errores.contenidoEnvase = "Debe tener al menos 3 caracteres.";
  else if (!/[a-zA-Z]/.test(v.contenidoEnvase)) errores.contenidoEnvase = "Indica el tipo de envase, por ejemplo Caja x 20 tabletas.";

  if (!Object.keys(errores).length) {
    const duplicada = presentaciones.find((p) => p.id !== editando?.id
      && p.medicamentoId === v.medicamentoId
      && compacto(p.concentracion) === compacto(v.concentracion)
      && normalizar(p.formaFarmaceutica) === normalizar(v.formaFarmaceutica)
      && compacto(p.contenidoEnvase) === compacto(v.contenidoEnvase));
    if (duplicada) errores.concentracion = `Esta presentación ya está registrada (${duplicada.id}).`;
  }

  CLAVES.forEach((k) => marcarCampo(k, errores[k] || ""));
  const primero = CLAVES.find((k) => errores[k]);
  if (primero) {
    const destino = primero === "formaFarmaceutica"
      ? (campos.formaSelect.value === OTRA ? campos.formaFarmaceutica : campos.formaSelect)
      : campos[primero];
    destino.focus();
    return null;
  }

  // Si la forma escrita ya existe con otra escritura, se usa la registrada para no duplicar filtros.
  const existente = formasRegistradas().find((f) => normalizar(f) === normalizar(v.formaFarmaceutica));
  return { ...v, formaFarmaceutica: existente || v.formaFarmaceutica };
}

/* ---------- Guardado ---------- */
async function crear(datos) {
  const base = idBase(datos.medicamentoId, datos.concentracion, datos.contenidoEnvase);
  for (let intento = 0; intento < 5; intento++) {
    const id = idDisponible(base, intento);
    const ref = doc(db, COLECCIONES.presentaciones, id);
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
  else $("saveText").textContent = editando ? "Guardar cambios" : "Guardar presentación";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (guardando) return;
  $("formAlert").hidden = true;
  const base = validar();
  if (!base) return;

  const datos = { ...base, actualizadoPor: usuario.uid };
  const etiqueta = `${nombreMed(datos.medicamentoId)} ${datos.concentracion}`;

  estadoGuardando(true);
  try {
    if (editando) {
      await setDoc(doc(db, COLECCIONES.presentaciones, editando.id), datos);
      const i = presentaciones.findIndex((p) => p.id === editando.id);
      presentaciones[i] = { id: editando.id, ...datos };
      notificar(`Cambios guardados en "${etiqueta}" (${editando.id}).`);
    } else {
      const id = await crear(datos);
      presentaciones.push({ id, ...datos });
      disponibles.set(id, 0);
      notificar(`Presentación "${etiqueta}" creada con el ID ${id}.`);
    }
    estadoGuardando(false);
    pintarTodo();
    modoCrear();
  } catch (error) {
    console.error("Farmaps: no se pudo guardar la presentación.", error);
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
cargar();
