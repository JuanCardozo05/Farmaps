/* ==========================================================
   FARMAPS - A04 Gestión de medicamentos
   ========================================================== */

import { iniciarPanel, esc, formatoNumero, notificar, mensajeGuardado } from "../compartido/admin.js";
import { db } from "../compartido/firebase.js";
import { normalizar, COLECCIONES } from "../compartido/datos.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const editor = $("editor");
const campos = {
  nombreComercial: $("nombreComercial"),
  principioActivo: $("principioActivo")
};

const LIMITES = {
  nombreComercial: { min: 2, max: 120 },
  principioActivo: { min: 3, max: 150 }
};

let usuario = null;
let medicamentos = [];
let presentacionesPorMed = new Map();
let huerfanas = 0;
let editando = null;
let guardando = false;
let instantanea = "";
let filtro = "todos";

/* ---------- Sesión ---------- */
usuario = await iniciarPanel("A04");

/* ---------- Utilidades ---------- */
/** Mismo formato de identificador que usa la carga inicial de datos. */
function slug(texto) {
  return String(texto)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/%/g, "pct").replace(/[/+]/g, "-")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80).replace(/-+$/, "");
}

function idDisponible(base, desplazamiento = 0) {
  const raiz = base || "medicamento";
  const usados = new Set(medicamentos.map((m) => m.id));
  let n = 1;
  let candidato = raiz;
  let saltos = desplazamiento;
  while (usados.has(candidato) || saltos > 0) {
    if (!usados.has(candidato)) saltos--;
    n++;
    candidato = `${raiz}-${n}`;
  }
  return candidato;
}

const presentacionesDe = (id) => presentacionesPorMed.get(id) || [];

/* ---------- Carga ---------- */
async function cargar() {
  $("loadError").hidden = true;
  try {
    // Solo se leen medicamentos y presentaciones para no consumir la cuota diaria de lecturas con las ofertas.
    const [snapMed, snapPres] = await Promise.all([
      getDocs(collection(db, COLECCIONES.medicamentos)),
      getDocs(collection(db, COLECCIONES.presentaciones))
    ]);
    medicamentos = snapMed.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ids = new Set(medicamentos.map((m) => m.id));

    presentacionesPorMed = new Map();
    huerfanas = 0;
    snapPres.docs.forEach((d) => {
      const p = { id: d.id, ...d.data() };
      if (!ids.has(p.medicamentoId)) { huerfanas++; return; }
      if (!presentacionesPorMed.has(p.medicamentoId)) presentacionesPorMed.set(p.medicamentoId, []);
      presentacionesPorMed.get(p.medicamentoId).push(p);
    });
    presentacionesPorMed.forEach((lista) => lista.sort((a, b) => textoPresentacion(a).localeCompare(textoPresentacion(b), "es", { numeric: true })));

    pintarTodo();
    abrirDesdeEnlace();
  } catch (error) {
    console.error("Farmaps: no se pudieron cargar los medicamentos.", error);
    $("loadError").hidden = false;
    $("tbody").innerHTML = '<tr class="row-empty"><td colspan="4">No se pudieron cargar los medicamentos.</td></tr>';
    $("countChip").textContent = "Sin conexión";
  }
}

$("retryBtn").addEventListener("click", cargar);

function abrirDesdeEnlace() {
  const params = new URLSearchParams(location.search);
  const pedido = params.get("editar");
  const objetivo = pedido && medicamentos.find((m) => m.id === pedido);
  if (objetivo) abrirEditor(objetivo);
  else if (params.get("nuevo") === "1") abrirEditor(null);
}

function pintarTodo() {
  const total = medicamentos.length;
  const conPres = medicamentos.filter((m) => presentacionesDe(m.id).length).length;
  const sinPres = total - conPres;

  const principios = new Map();
  medicamentos.forEach((m) => {
    const clave = normalizar(m.principioActivo);
    if (!principios.has(clave)) principios.set(clave, { nombre: m.principioActivo, marcas: 0 });
    principios.get(clave).marcas++;
  });
  const compartidos = [...principios.values()].filter((p) => p.marcas > 1).length;

  $("countChip").textContent = `${formatoNumero.format(total)} ${total === 1 ? "medicamento registrado" : "medicamentos registrados"}`;
  $("statTotal").textContent = formatoNumero.format(total);
  $("subTotal").textContent = total
    ? `${Math.round((conPres / total) * 100)} % con presentaciones vinculadas`
    : "Aún no hay registros";

  $("statPrincipios").textContent = formatoNumero.format(principios.size);
  $("subPrincipios").textContent = compartidos
    ? `${formatoNumero.format(compartidos)} ${compartidos === 1 ? "principio presente" : "principios presentes"} en varias marcas`
    : "Cada principio pertenece a una sola marca";

  const integro = !sinPres && !huerfanas;
  $("statIntegridad").textContent = integro
    ? "Sin huérfanos"
    : sinPres ? `${formatoNumero.format(sinPres)} sin presentaciones` : "Revisar";
  $("statIntegridad").className = `stat__value stat__value--text ${integro ? "stat__value--brand" : "stat__value--warn"}`;
  $("subIntegridad").textContent = huerfanas
    ? `${formatoNumero.format(huerfanas)} ${huerfanas === 1 ? "presentación apunta" : "presentaciones apuntan"} a un medicamento inexistente`
    : "Todas las presentaciones tienen su medicamento";
  $("subIntegridad").className = `stat__sub ${huerfanas ? "stat__sub--warn" : "stat__sub--ok"}`;

  $("principios").innerHTML = [...principios.values()]
    .map((p) => p.nombre)
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((n) => `<option value="${esc(n)}"></option>`)
    .join("");

  pintarTabla();
}

/* ---------- Tabla ---------- */
const textoPresentacion = (p) =>
  [p.concentracion, p.formaFarmaceutica, p.contenidoEnvase].filter(Boolean).join(" – ");

const MAX_CHIPS = 3;

function pintarTabla() {
  const consulta = normalizar($("search").value);
  const palabras = consulta ? consulta.split(/\s+/) : [];
  const lista = medicamentos
    .filter((m) => {
      const n = presentacionesDe(m.id).length;
      if (filtro === "con" && !n) return false;
      if (filtro === "sin" && n) return false;
      if (!palabras.length) return true;
      const texto = normalizar(`${m.nombreComercial} ${m.principioActivo} ${m.id}`);
      return palabras.every((p) => texto.includes(p));
    })
    .sort((a, b) => a.nombreComercial.localeCompare(b.nombreComercial, "es"));

  let vacio = "Aún no hay medicamentos registrados.";
  if (medicamentos.length) {
    vacio = palabras.length
      ? "Ningún medicamento coincide con la búsqueda."
      : filtro === "sin" ? "Todos los medicamentos tienen al menos una presentación." : "No hay medicamentos en esta vista.";
  }

  $("tbody").innerHTML = lista.length
    ? lista.map(fila).join("")
    : `<tr class="row-empty"><td colspan="4">${vacio}</td></tr>`;
  $("tableCount").textContent = lista.length === medicamentos.length
    ? `${formatoNumero.format(medicamentos.length)} medicamentos`
    : `${formatoNumero.format(lista.length)} de ${formatoNumero.format(medicamentos.length)} medicamentos`;
}

function fila(m) {
  const pres = presentacionesDe(m.id);
  const activa = editando?.id === m.id && editor.open;
  const icono = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="5"/><path d="M12 7v10"/></svg>';

  const presentaciones = pres.length
    ? `<div class="pres-list">
        ${pres.slice(0, MAX_CHIPS).map((p) => `<a class="pres-chip" href="../A05/index.html?editar=${encodeURIComponent(p.id)}" title="${esc(textoPresentacion(p))}">${icono}<span>${esc(textoPresentacion(p))}</span></a>`).join("")}
        ${pres.length > MAX_CHIPS ? `<a class="pres-more" href="../A05/index.html?medicamento=${encodeURIComponent(m.id)}">+${pres.length - MAX_CHIPS} más</a>` : ""}
      </div>`
    : `<div class="pres-list">
        <span class="tag tag--warn">Sin presentaciones</span>
        <a class="pres-add" href="../A05/index.html?medicamento=${encodeURIComponent(m.id)}">+ Agregar presentación</a>
      </div>`;

  return `
    <tr class="${activa ? "is-editing" : ""}">
      <td>
        <div class="cell-med">
          <strong>${esc(m.nombreComercial)}</strong>
          <span class="cell-id mono">${esc(m.id)}</span>
        </div>
      </td>
      <td>${esc(m.principioActivo)}</td>
      <td>${presentaciones}</td>
      <td><button type="button" class="btn-edit" data-id="${esc(m.id)}" aria-label="Editar ${esc(m.nombreComercial)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        Editar
      </button></td>
    </tr>`;
}

$("search").addEventListener("input", pintarTabla);

document.querySelectorAll(".segmented button").forEach((btn) => {
  btn.addEventListener("click", () => {
    filtro = btn.dataset.filtro;
    document.querySelectorAll(".segmented button").forEach((b) => {
      const activo = b === btn;
      b.classList.toggle("is-active", activo);
      b.setAttribute("aria-pressed", String(activo));
    });
    pintarTabla();
  });
});

$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-edit");
  if (!btn) return;
  const m = medicamentos.find((x) => x.id === btn.dataset.id);
  if (m) abrirEditor(m);
});

/* ---------- Ventana de edición ---------- */
function valoresFormulario() {
  return Object.fromEntries(Object.entries(campos).map(([k, el]) => [k, el.value.trim().replace(/\s+/g, " ")]));
}

const hayCambios = () => editor.open && !guardando && JSON.stringify(valoresFormulario()) !== instantanea;
window.farmapsCambiosSinGuardar = hayCambios;

function marcarCampo(input, mensaje) {
  $(`${input.id}Error`).textContent = mensaje;
  input.closest(".input").classList.toggle("is-invalid", !!mensaje);
  input.setAttribute("aria-invalid", mensaje ? "true" : "false");
}

function limpiarErrores() {
  Object.values(campos).forEach((el) => marcarCampo(el, ""));
  $("formAlert").hidden = true;
}

function actualizarId() {
  if (editando) return;
  const base = slug(campos.nombreComercial.value);
  $("formId").textContent = base ? idDisponible(base) : "se genera con el nombre";
}

function abrirEditor(m) {
  editando = m;
  form.reset();
  limpiarErrores();

  if (m) {
    campos.nombreComercial.value = m.nombreComercial || "";
    campos.principioActivo.value = m.principioActivo || "";
    $("editorTitle").textContent = `Editar medicamento: ${m.nombreComercial}`;
    $("editorSubtitle").textContent = "El identificador no cambia, así se conservan sus presentaciones y ofertas.";
    $("formId").textContent = m.id;
    $("saveText").textContent = "Guardar cambios";

    const nPres = presentacionesDe(m.id).length;
    $("linkedNote").hidden = !nPres;
    $("linkedText").textContent = nPres
      ? `Tiene ${formatoNumero.format(nPres)} ${nPres === 1 ? "presentación vinculada" : "presentaciones vinculadas"} con sus ofertas. Los cambios se verán de inmediato en el sitio público.`
      : "";
    history.replaceState(null, "", `${location.pathname}?editar=${encodeURIComponent(m.id)}`);
  } else {
    $("editorTitle").textContent = "Nuevo medicamento";
    $("editorSubtitle").textContent = "Registra el nombre comercial y su principio activo.";
    $("saveText").textContent = "Guardar medicamento";
    $("linkedNote").hidden = true;
    actualizarId();
    history.replaceState(null, "", `${location.pathname}?nuevo=1`);
  }

  instantanea = JSON.stringify(valoresFormulario());
  if (!editor.open) editor.showModal();
  pintarTabla();
  campos.nombreComercial.focus();
}

function cerrarEditor({ confirmar = true } = {}) {
  if (confirmar && hayCambios() && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return false;
  editor.close();
  editando = null;
  history.replaceState(null, "", location.pathname);
  pintarTabla();
  $("newBtn").focus({ preventScroll: true });
  return true;
}

$("newBtn").addEventListener("click", () => abrirEditor(null));
$("cancelBtn").addEventListener("click", () => cerrarEditor());
$("closeBtn").addEventListener("click", () => cerrarEditor());

// Tecla Escape
editor.addEventListener("cancel", (e) => {
  e.preventDefault();
  if (!guardando) cerrarEditor();
});

// Clic sobre el fondo oscuro
editor.addEventListener("click", (e) => {
  if (e.target === editor && !guardando) cerrarEditor();
});

campos.nombreComercial.addEventListener("input", actualizarId);

Object.values(campos).forEach((el) => {
  el.addEventListener("input", () => {
    if (el.getAttribute("aria-invalid") === "true") marcarCampo(el, "");
    $("formAlert").hidden = true;
  });
});

function validar() {
  const v = valoresFormulario();
  const errores = {};

  const nombres = { nombreComercial: "el nombre comercial", principioActivo: "el principio activo" };
  Object.entries(LIMITES).forEach(([k, { min, max }]) => {
    if (!v[k]) errores[k] = `Escribe ${nombres[k]}.`;
    else if (v[k].length < min) errores[k] = `Debe tener al menos ${min} caracteres.`;
    else if (v[k].length > max) errores[k] = `Máximo ${max} caracteres.`;
    else if (!/[a-zA-ZÀ-ÿ]/.test(v[k])) errores[k] = "Debe contener letras.";
  });

  if (!errores.nombreComercial && !errores.principioActivo) {
    const duplicado = medicamentos.find((m) => m.id !== editando?.id
      && normalizar(m.nombreComercial) === normalizar(v.nombreComercial)
      && normalizar(m.principioActivo) === normalizar(v.principioActivo));
    if (duplicado) errores.nombreComercial = `Ya existe este medicamento con el mismo principio activo (${duplicado.id}).`;
  }

  Object.entries(campos).forEach(([k, el]) => marcarCampo(el, errores[k] || ""));
  const primero = Object.keys(campos).find((k) => errores[k]);
  if (primero) {
    campos[primero].focus();
    return null;
  }

  // Si el principio ya existe con otra escritura (tildes o mayúsculas), se usa la registrada.
  const existente = medicamentos.find((m) => normalizar(m.principioActivo) === normalizar(v.principioActivo));
  return {
    nombreComercial: v.nombreComercial,
    principioActivo: existente ? existente.principioActivo : v.principioActivo
  };
}

/* ---------- Guardado ---------- */
async function crear(datos) {
  const base = slug(datos.nombreComercial) || "medicamento";
  for (let intento = 0; intento < 5; intento++) {
    const id = idDisponible(base, intento);
    const ref = doc(db, COLECCIONES.medicamentos, id);
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
  $("closeBtn").disabled = activo;
  $("saveBtn").classList.toggle("is-loading", activo);
  if (activo) $("saveText").textContent = "Guardando…";
  else $("saveText").textContent = editando ? "Guardar cambios" : "Guardar medicamento";
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
      await setDoc(doc(db, COLECCIONES.medicamentos, editando.id), datos);
      const i = medicamentos.findIndex((m) => m.id === editando.id);
      medicamentos[i] = { id: editando.id, ...datos };
      notificar(`Cambios guardados en "${datos.nombreComercial}" (${editando.id}).`);
    } else {
      const id = await crear(datos);
      medicamentos.push({ id, ...datos });
      notificar(`Medicamento "${datos.nombreComercial}" creado con el ID ${id}.`);
    }
    estadoGuardando(false);
    cerrarEditor({ confirmar: false });
    pintarTodo();
  } catch (error) {
    console.error("Farmaps: no se pudo guardar el medicamento.", error);
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
