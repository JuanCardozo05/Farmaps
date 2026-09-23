/* ==========================================================
   FARMAPS - A06 Gestión de ofertas y disponibilidad
   ========================================================== */

import { iniciarPanel, esc, formatoNumero, notificar, mensajeGuardado } from "../compartido/admin.js";
import { db } from "../compartido/firebase.js";
import { normalizar, COLECCIONES } from "../compartido/datos.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  setDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const POR_PAGINA = 10;
const MONEDA = "COP";
const MIN_BUSQUEDA = 3;
// Máximo de ofertas estimadas que se descargan para una búsqueda sin filtro de farmacia.
const TOPE_BUSQUEDA = 320;

const campos = {
  farmaciaId: $("farmaciaId"),
  medFiltro: $("medFiltro"),
  presentacionId: $("presentacionId"),
  precio: $("precio")
};

let usuario = null;
let farmacias = new Map();
let medicamentos = new Map();
let presentaciones = new Map();

const stats = { total: null, disponibles: null, hoy: null, porFarmacia: new Map(), conteoCompleto: false };

// Listado: sin filtros se pagina en el servidor; con filtros se trabaja sobre un conjunto acotado.
let pagina = 1;
let cursores = [];
let cachePaginas = new Map();
let conjuntos = new Map();
let filtroPres = "";
let turnoListado = 0;
let filasVisibles = [];

let editando = null;
let existente = null;
let turnoExiste = 0;
let guardando = false;
let instantanea = "";

/* ---------- Sesión ---------- */
usuario = await iniciarPanel("A06");

/* ---------- Utilidades ---------- */
const plural = (n, uno, varios) => `${formatoNumero.format(n)} ${n === 1 ? uno : varios}`;
const idOferta = (farmaciaId, presentacionId) => `${farmaciaId}__${presentacionId}__${MONEDA}`;
const formatoPrecio = (n) => `$ ${formatoNumero.format(n)}`;
const fechaCorta = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });
const horaCorta = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });

/** "22 sept 2026" */
function fechaTexto(fecha) {
  const partes = Object.fromEntries(fechaCorta.formatToParts(fecha).map((p) => [p.type, p.value]));
  return `${partes.day} ${partes.month.replace(/\.$/, "")} ${partes.year}`;
}

function inicioDeHoy() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function aFila(snap) {
  const datos = snap.data();
  const f = datos.fechaActualizacion;
  return { id: snap.id, ...datos, fecha: f?.toDate ? f.toDate() : null };
}

function nombreFarmacia(id) {
  return farmacias.get(id)?.nombre || id;
}

function describirPresentacion(id) {
  const p = presentaciones.get(id);
  if (!p) return { nombre: "Presentación no encontrada", detalle: id, ok: false };
  const m = medicamentos.get(p.medicamentoId);
  return {
    nombre: `${m?.nombreComercial || p.medicamentoId} ${p.concentracion}`,
    detalle: `${p.formaFarmaceutica} · ${p.contenidoEnvase}`,
    ok: true
  };
}

function textoFarmacia(f) {
  return normalizar(`${f.nombre} ${f.direccion} ${f.id}`);
}

function textoPresentacion(p) {
  const m = medicamentos.get(p.medicamentoId);
  return normalizar(`${m?.nombreComercial || ""} ${m?.principioActivo || ""} ${p.concentracion} ${String(p.concentracion).replace(/\s+/g, "")} ${p.formaFarmaceutica} ${p.contenidoEnvase}`);
}

function textoFila(o) {
  const f = farmacias.get(o.farmaciaId);
  const p = presentaciones.get(o.presentacionId);
  return `${f ? textoFarmacia(f) : normalizar(o.farmaciaId)} ${p ? textoPresentacion(p) : normalizar(o.presentacionId)}`;
}

function palabrasBusqueda() {
  const q = normalizar($("search").value).trim();
  return q ? q.split(/\s+/) : [];
}

/* ---------- Carga del catálogo ---------- */
async function cargar() {
  $("loadError").hidden = true;
  try {
    const [snapF, snapM, snapP] = await Promise.all([
      getDocs(collection(db, COLECCIONES.farmacias)),
      getDocs(collection(db, COLECCIONES.medicamentos)),
      getDocs(collection(db, COLECCIONES.presentaciones))
    ]);
    farmacias = new Map(snapF.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    medicamentos = new Map(snapM.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    presentaciones = new Map(snapP.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

    llenarSelects();
    await abrirDesdeEnlace();
    cargarEstadisticas();
  } catch (error) {
    console.error("Farmaps: no se pudo cargar el catálogo.", error);
    $("loadError").hidden = false;
    $("tbody").innerHTML = '<tr class="row-empty"><td colspan="6">No se pudo cargar la información.</td></tr>';
    $("recordsChip").textContent = "Sin conexión";
  }
}

$("retryBtn").addEventListener("click", cargar);

function ordenarEs(lista, clave) {
  return lista.sort((a, b) => String(clave(a)).localeCompare(String(clave(b)), "es", { numeric: true }));
}

function llenarSelects() {
  const listaF = ordenarEs([...farmacias.values()], (f) => f.nombre);
  const opcionesF = listaF.map((f) => `<option value="${esc(f.id)}">${esc(f.nombre)}</option>`).join("");
  campos.farmaciaId.innerHTML = '<option value="">Selecciona una farmacia…</option>' + opcionesF;
  const filtro = $("farmaciaFilter").value;
  $("farmaciaFilter").innerHTML = '<option value="">Todas las farmacias</option>' + opcionesF;
  if (farmacias.has(filtro)) $("farmaciaFilter").value = filtro;

  const conPres = new Set([...presentaciones.values()].map((p) => p.medicamentoId));
  const listaM = ordenarEs([...medicamentos.values()].filter((m) => conPres.has(m.id)), (m) => m.nombreComercial);
  campos.medFiltro.innerHTML = '<option value="">Mostrar todos los medicamentos</option>'
    + listaM.map((m) => `<option value="${esc(m.id)}">${esc(m.nombreComercial)} — ${esc(m.principioActivo)}</option>`).join("");

  llenarPresentaciones();
}

function llenarPresentaciones() {
  const med = campos.medFiltro.value;
  const elegida = campos.presentacionId.value;
  const lista = [...presentaciones.values()].filter((p) => !med || p.medicamentoId === med);
  const grupos = new Map();
  lista.forEach((p) => {
    const nombre = medicamentos.get(p.medicamentoId)?.nombreComercial || p.medicamentoId;
    if (!grupos.has(nombre)) grupos.set(nombre, []);
    grupos.get(nombre).push(p);
  });
  const nombres = [...grupos.keys()].sort((a, b) => a.localeCompare(b, "es"));
  const opcion = (p) => `<option value="${esc(p.id)}">${esc(p.concentracion)} · ${esc(p.formaFarmaceutica)} · ${esc(p.contenidoEnvase)}</option>`;
  campos.presentacionId.innerHTML = '<option value="">Selecciona una presentación…</option>'
    + nombres.map((n) => {
      const items = ordenarEs(grupos.get(n), (p) => `${p.concentracion} ${p.contenidoEnvase}`);
      return `<optgroup label="${esc(n)}">${items.map(opcion).join("")}</optgroup>`;
    }).join("");
  if (elegida && lista.some((p) => p.id === elegida)) campos.presentacionId.value = elegida;
  // En edición la presentación puede no estar en el catálogo (registro huérfano).
  if (editando && !presentaciones.has(editando.presentacionId)) {
    campos.presentacionId.insertAdjacentHTML("beforeend", `<option value="${esc(editando.presentacionId)}">${esc(editando.presentacionId)} (no encontrada)</option>`);
    campos.presentacionId.value = editando.presentacionId;
  }

  $("presentacionLinkA").href = med
    ? `../A05/index.html?medicamento=${encodeURIComponent(med)}`
    : "../A05/index.html?nuevo=1";
  marcarPlaceholders();
}

function marcarPlaceholders() {
  [campos.farmaciaId, campos.medFiltro, campos.presentacionId].forEach((s) => s.classList.toggle("is-placeholder", !s.value));
}

async function abrirDesdeEnlace() {
  const params = new URLSearchParams(location.search);
  const pres = params.get("presentacion");
  const farm = params.get("farmacia");
  const pedido = params.get("editar");

  if (pres && presentaciones.has(pres)) filtroPres = pres;
  if (farm && farmacias.has(farm)) $("farmaciaFilter").value = farm;

  let objetivo = null;
  if (pedido) {
    try {
      const snap = await getDoc(doc(db, COLECCIONES.ofertas, pedido));
      if (snap.exists()) objetivo = aFila(snap);
      else notificar("La oferta solicitada no existe.", "error");
    } catch (error) {
      console.warn("Farmaps: no se pudo abrir la oferta", pedido, error);
      notificar("No fue posible abrir la oferta solicitada.", "error");
    }
  }

  if (objetivo) {
    editar(objetivo, { desplazar: true });
  } else {
    modoCrear();
    if (params.get("nuevo") === "1") enfocarFormulario();
  }
  pintarListado();
}

/* ---------- Indicadores ---------- */
async function contar(...restricciones) {
  const q = restricciones.length
    ? query(collection(db, COLECCIONES.ofertas), ...restricciones)
    : collection(db, COLECCIONES.ofertas);
  return (await getCountFromServer(q)).data().count;
}

/** Cada consulta de conteo cuesta una lectura, en lugar de descargar todas las ofertas. */
async function cargarEstadisticas() {
  stats.conteoCompleto = false;
  stats.porFarmacia = new Map();
  pintarEstadisticas();

  const [total, disponibles, hoy] = await Promise.allSettled([
    contar(),
    contar(where("disponibilidadReportada", "==", true)),
    contar(where("fechaActualizacion", ">=", inicioDeHoy()))
  ]);
  stats.total = total.status === "fulfilled" ? total.value : null;
  stats.disponibles = disponibles.status === "fulfilled" ? disponibles.value : null;
  stats.hoy = hoy.status === "fulfilled" ? hoy.value : null;
  [total, disponibles, hoy].filter((r) => r.status === "rejected")
    .forEach((r) => console.warn("Farmaps: no se pudo contar las ofertas.", r.reason));
  pintarEstadisticas();
  pintarPaginador();

  const pendientes = [...farmacias.keys()];
  const trabajar = async () => {
    while (pendientes.length) {
      const id = pendientes.shift();
      try {
        stats.porFarmacia.set(id, await contar(where("farmaciaId", "==", id)));
      } catch (error) {
        console.warn("Farmaps: no se pudo contar las ofertas de", id, error);
        stats.porFarmacia.set(id, null);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajar));
  stats.conteoCompleto = true;
  pintarEstadisticas();
}

function pintarEstadisticas() {
  const { total, disponibles, hoy } = stats;
  $("statDisponibles").textContent = disponibles === null ? "—" : formatoNumero.format(disponibles);
  const partes = [];
  if (total !== null) partes.push(`de ${plural(total, "registrada", "registradas")}`);
  if (hoy) partes.push(`<span class="up">+${formatoNumero.format(hoy)} hoy</span>`);
  $("statDisponiblesSub").innerHTML = partes.join(" · ") || "&nbsp;";

  if (!stats.conteoCompleto) {
    $("statFarmacias").textContent = "…";
    $("statFarmaciasSub").textContent = "Contando…";
    $("statIntegridad").textContent = "…";
    $("statIntegridadSub").textContent = "Verificando…";
    return;
  }

  const valores = [...stats.porFarmacia.values()];
  const fallo = valores.some((v) => v === null);
  const reportando = valores.filter((v) => v > 0).length;
  $("statFarmacias").innerHTML = fallo
    ? "—"
    : `${formatoNumero.format(reportando)} <small>/ ${formatoNumero.format(farmacias.size)}</small>`;
  $("statFarmaciasSub").textContent = fallo ? "No fue posible contar" : "con al menos una oferta";

  if (fallo || total === null) {
    $("statIntegridad").textContent = "—";
    $("statIntegridadSub").textContent = "No fue posible verificar";
    return;
  }
  const vinculadas = valores.reduce((s, v) => s + v, 0);
  const huerfanas = Math.max(0, total - vinculadas);
  const porcentaje = total ? Math.floor((Math.min(vinculadas, total) / total) * 1000) / 10 : 100;
  $("statIntegridad").textContent = `${formatoNumero.format(porcentaje)} %`;
  $("statIntegridad").classList.toggle("stat__value--ok", !huerfanas);
  $("statIntegridad").classList.toggle("stat__value--warn", !!huerfanas);
  $("statIntegridadSub").textContent = huerfanas
    ? `${plural(huerfanas, "oferta sin farmacia registrada", "ofertas sin farmacia registrada")}`
    : "vinculadas a farmacias registradas";
}

/* ---------- Listado ---------- */
function modoFiltrado() {
  return !!($("farmaciaFilter").value || filtroPres || normalizar($("search").value).trim().length >= MIN_BUSQUEDA);
}

function mostrarPista(texto) {
  $("searchHint").textContent = texto || "";
  $("searchHint").hidden = !texto;
}

function filaCargando(texto = "Cargando ofertas…") {
  $("tbody").innerHTML = `<tr class="row-empty"><td colspan="6">${texto}</td></tr>`;
}

async function pintarListado() {
  const turno = ++turnoListado;
  $("presFilter").hidden = !filtroPres;
  if (filtroPres) {
    const d = describirPresentacion(filtroPres);
    $("presFilterText").textContent = `Presentación: ${d.nombre} · ${d.detalle}`;
  }

  const q = normalizar($("search").value).trim();
  const soloBusqueda = !$("farmaciaFilter").value && !filtroPres;
  if (soloBusqueda && q && q.length < MIN_BUSQUEDA) {
    mostrarPista(`Escribe al menos ${MIN_BUSQUEDA} letras para buscar.`);
  } else {
    mostrarPista("");
  }

  try {
    if (modoFiltrado()) await pintarFiltrado(turno);
    else await pintarPaginaServidor(turno);
  } catch (error) {
    if (turno !== turnoListado) return;
    console.error("Farmaps: no se pudo cargar el listado de ofertas.", error);
    filaCargando("No se pudieron cargar las ofertas. Usa el botón de actualizar para reintentar.");
    $("recordsChip").textContent = "Sin conexión";
    $("prevPage").disabled = true;
    $("nextPage").disabled = true;
  }
}

async function pintarPaginaServidor(turno) {
  const totalPaginas = Math.max(1, Math.ceil((stats.total ?? 0) / POR_PAGINA));
  if (stats.total !== null) pagina = Math.min(Math.max(1, pagina), totalPaginas);

  let filas = cachePaginas.get(pagina);
  if (!filas) {
    filaCargando();
    $("prevPage").disabled = true;
    $("nextPage").disabled = true;
    const restricciones = [orderBy("fechaActualizacion", "desc")];
    if (pagina > 1) {
      if (!cursores[pagina - 1]) { pagina = 1; return pintarPaginaServidor(turno); }
      restricciones.push(startAfter(cursores[pagina - 1]));
    }
    restricciones.push(limit(POR_PAGINA));
    const snap = await getDocs(query(collection(db, COLECCIONES.ofertas), ...restricciones));
    if (turno !== turnoListado) return;
    filas = snap.docs.map(aFila);
    if (snap.docs.length) cursores[pagina] = snap.docs[snap.docs.length - 1];
    cachePaginas.set(pagina, filas);
    if (filas.length < POR_PAGINA) cachePaginas.set("fin", pagina);
  }
  if (turno !== turnoListado) return;

  filasVisibles = filas;
  $("tbody").innerHTML = filas.length
    ? filas.map(fila).join("")
    : '<tr class="row-empty"><td colspan="6">Aún no hay ofertas registradas. Publica la primera con el formulario.</td></tr>';
  pintarPaginador();
}

function pintarPaginador() {
  if (modoFiltrado()) return;
  const total = stats.total;
  const fin = cachePaginas.get("fin");
  const totalPaginas = total !== null ? Math.max(1, Math.ceil(total / POR_PAGINA)) : null;
  $("recordsChip").textContent = total !== null ? plural(total, "oferta", "ofertas") : "–";
  $("pageInfo").innerHTML = totalPaginas
    ? `Página <strong>${pagina}</strong> de ${formatoNumero.format(totalPaginas)}`
    : `Página <strong>${pagina}</strong>`;
  $("prevPage").disabled = pagina <= 1;
  $("nextPage").disabled = (fin !== undefined && pagina >= fin) || (totalPaginas !== null && pagina >= totalPaginas);
}

/** Decide qué consultas acotadas traen las ofertas que pueden coincidir con la búsqueda. */
function planBusqueda(palabras) {
  let mejor = null;
  for (const w of palabras) {
    const fs = [...farmacias.values()].filter((f) => textoFarmacia(f).includes(w)).map((f) => f.id);
    const ps = [...presentaciones.values()].filter((p) => textoPresentacion(p).includes(w)).map((p) => p.id);
    const promedioF = stats.total && farmacias.size ? stats.total / farmacias.size : 30;
    const promedioP = stats.total && presentaciones.size ? stats.total / presentaciones.size : 20;
    const costo = fs.reduce((s, id) => s + (stats.porFarmacia.get(id) ?? promedioF), 0) + ps.length * promedioP;
    if (!mejor || costo < mejor.costo) mejor = { fs, ps, costo };
  }
  return mejor;
}

function trozos(lista, n = 30) {
  const salida = [];
  for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
  return salida;
}

async function obtenerConjunto(clave, restricciones) {
  if (conjuntos.has(clave)) return conjuntos.get(clave);
  const snaps = await Promise.all(restricciones.map((r) => getDocs(query(collection(db, COLECCIONES.ofertas), r))));
  const porId = new Map();
  snaps.forEach((s) => s.docs.forEach((d) => porId.set(d.id, aFila(d))));
  const lista = [...porId.values()];
  conjuntos.set(clave, lista);
  return lista;
}

async function pintarFiltrado(turno) {
  const farm = $("farmaciaFilter").value;
  const palabras = palabrasBusqueda();
  let base;

  if (farm) {
    base = await obtenerConjunto(`f:${farm}`, [where("farmaciaId", "==", farm)]);
  } else if (filtroPres) {
    base = await obtenerConjunto(`p:${filtroPres}`, [where("presentacionId", "==", filtroPres)]);
  } else {
    const plan = planBusqueda(palabras);
    if (!plan || (!plan.fs.length && !plan.ps.length)) {
      if (turno !== turnoListado) return;
      pintarConjunto([], `Ninguna farmacia o medicamento coincide con «${esc($("search").value.trim())}».`);
      return;
    }
    if (plan.costo > TOPE_BUSQUEDA) {
      if (turno !== turnoListado) return;
      mostrarPista("La búsqueda es muy amplia. Agrega más letras o elige una farmacia en el filtro.");
      pintarConjunto([], "Precisa la búsqueda para ver resultados.");
      return;
    }
    filaCargando("Buscando ofertas…");
    const restricciones = [
      ...trozos(plan.fs).map((ids) => where("farmaciaId", "in", ids)),
      ...trozos(plan.ps).map((ids) => where("presentacionId", "in", ids))
    ];
    const clave = `b:${plan.fs.join(",")}|${plan.ps.join(",")}`;
    base = await obtenerConjunto(clave, restricciones);
  }
  if (turno !== turnoListado) return;

  const lista = base
    .filter((o) => !farm || o.farmaciaId === farm)
    .filter((o) => !filtroPres || o.presentacionId === filtroPres)
    .filter((o) => {
      if (!palabras.length) return true;
      const texto = textoFila(o);
      return palabras.every((w) => texto.includes(w));
    })
    .sort((a, b) => (b.fecha?.getTime() || 0) - (a.fecha?.getTime() || 0));

  let vacio = "Ninguna oferta coincide con los filtros.";
  if (!base.length && farm) vacio = `${esc(nombreFarmacia(farm))} aún no tiene ofertas. Publica una con el formulario.`;
  else if (!base.length && filtroPres) vacio = "Esta presentación aún no tiene ofertas. Publica una con el formulario.";
  pintarConjunto(lista, vacio);
}

function pintarConjunto(lista, vacio) {
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(Math.max(1, pagina), paginas);
  filasVisibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  $("tbody").innerHTML = filasVisibles.length
    ? filasVisibles.map(fila).join("")
    : `<tr class="row-empty"><td colspan="6">${vacio}</td></tr>`;
  $("recordsChip").textContent = plural(lista.length, "resultado", "resultados");
  $("pageInfo").innerHTML = `Página <strong>${pagina}</strong> de ${paginas}`;
  $("prevPage").disabled = pagina <= 1;
  $("nextPage").disabled = pagina >= paginas;
}

function celdaFecha(o) {
  if (!o.fecha) return '<span class="muted">Sin fecha</span>';
  const hoy = o.fecha >= inicioDeHoy();
  const dia = hoy ? "Hoy" : fechaTexto(o.fecha);
  const quien = o.actualizadoPor === usuario.uid ? "Por ti" : "Por otro administrador";
  return `<span class="when"><strong>${esc(dia)}, ${esc(horaCorta.format(o.fecha))}</strong><small>${quien}</small></span>`;
}

function fila(o) {
  const f = farmacias.get(o.farmaciaId);
  const d = describirPresentacion(o.presentacionId);
  const activa = editando?.id === o.id;
  const disponible = o.disponibilidadReportada === true;
  return `
    <tr class="${activa ? "is-editing" : ""}">
      <td>
        <div class="cell-farm">
          <div>
            <strong>${f ? esc(f.nombre) : '<span class="tag tag--warn">Farmacia no encontrada</span>'}</strong>
            <small>${f ? esc(f.direccion) : esc(o.farmaciaId)}</small>
          </div>
        </div>
      </td>
      <td>
        <div class="cell-pres">
          <strong>${d.ok ? esc(d.nombre) : `<span class="tag tag--warn">${esc(d.nombre)}</span>`}</strong>
          <small>${esc(d.detalle)}</small>
        </div>
      </td>
      <td><span class="price">${formatoPrecio(o.precio)}</span><small class="currency">${esc(o.moneda || MONEDA)}</small></td>
      <td>${disponible
        ? '<span class="pill pill--ok">Disponible</span>'
        : '<span class="pill pill--off">No disponible</span>'}</td>
      <td>${celdaFecha(o)}</td>
      <td><button type="button" class="btn-edit" data-id="${esc(o.id)}" aria-label="Editar oferta de ${esc(d.nombre)} en ${esc(f?.nombre || o.farmaciaId)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        ${activa ? "Editando" : "Editar"}
      </button></td>
    </tr>`;
}

let esperaBusqueda = null;
$("search").addEventListener("input", () => {
  clearTimeout(esperaBusqueda);
  pagina = 1;
  // Con filtro de farmacia o presentación la búsqueda es local e inmediata.
  const local = $("farmaciaFilter").value || filtroPres;
  esperaBusqueda = setTimeout(() => { pagina = 1; pintarListado(); }, local ? 0 : 400);
});
$("farmaciaFilter").addEventListener("change", () => {
  pagina = 1;
  // Si el formulario está sin tocar, se adelanta la farmacia filtrada.
  if (!editando && !hayCambios()) {
    campos.farmaciaId.value = $("farmaciaFilter").value;
    marcarPlaceholders();
    actualizarId();
    tomarInstantanea();
    revisarExistente();
  }
  actualizarUrl();
  pintarListado();
});
$("presFilterClear").addEventListener("click", () => {
  filtroPres = "";
  pagina = 1;
  actualizarUrl();
  pintarListado();
});
$("prevPage").addEventListener("click", () => { pagina--; pintarListado(); });
$("nextPage").addEventListener("click", () => { pagina++; pintarListado(); });

function reiniciarCache() {
  cachePaginas = new Map();
  cursores = [];
  conjuntos = new Map();
}

$("refreshBtn").addEventListener("click", async () => {
  const btn = $("refreshBtn");
  btn.disabled = true;
  btn.classList.add("is-loading");
  reiniciarCache();
  pagina = 1;
  const estadisticas = cargarEstadisticas();
  await pintarListado();
  btn.disabled = false;
  btn.classList.remove("is-loading");
  await estadisticas;
});

$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-edit");
  if (!btn) return;
  const o = filasVisibles.find((x) => x.id === btn.dataset.id);
  if (!o) return;
  if (editando?.id === o.id) return enfocarFormulario();
  if (hayCambios() && !confirm("Tienes cambios sin guardar. ¿Descartarlos y editar otra oferta?")) return;
  editar(o, { desplazar: true });
});

/* ---------- Formulario ---------- */
function disponibilidadElegida() {
  return form.querySelector('input[name="disponibilidad"]:checked')?.value === "si";
}

function fijarDisponibilidad(valor) {
  form.querySelector(`input[name="disponibilidad"][value="${valor ? "si" : "no"}"]`).checked = true;
}

function valoresFormulario() {
  return {
    farmaciaId: campos.farmaciaId.value,
    presentacionId: campos.presentacionId.value,
    precio: campos.precio.value.trim(),
    disponible: disponibilidadElegida()
  };
}

const hayCambios = () => !guardando && JSON.stringify(valoresFormulario()) !== instantanea;
window.farmapsCambiosSinGuardar = hayCambios;

function tomarInstantanea() {
  instantanea = JSON.stringify(valoresFormulario());
}

const CLAVES = ["farmaciaId", "presentacionId", "precio"];

function marcarCampo(clave, mensaje) {
  $(`${clave}Error`).textContent = mensaje;
  campos[clave].closest(".input").classList.toggle("is-invalid", !!mensaje);
  campos[clave].setAttribute("aria-invalid", mensaje ? "true" : "false");
}

function limpiarErrores() {
  CLAVES.forEach((k) => marcarCampo(k, ""));
  $("formAlert").hidden = true;
}

/** Acepta 12500 o 12.500; devuelve null si no es un entero válido. */
function leerPrecio(texto) {
  const t = texto.replace(/\s/g, "").replace(/^\$/, "");
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(t)) return null;
  return Number(t.replace(/\./g, ""));
}

function actualizarId() {
  const v = valoresFormulario();
  $("formId").textContent = v.farmaciaId && v.presentacionId
    ? idOferta(v.farmaciaId, v.presentacionId)
    : "se genera con los datos";
}

function actualizarUrl() {
  const params = new URLSearchParams();
  if (editando) params.set("editar", editando.id);
  if (filtroPres) params.set("presentacion", filtroPres);
  if ($("farmaciaFilter").value) params.set("farmacia", $("farmaciaFilter").value);
  const qs = params.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

function bloquearCombinacion(bloquear) {
  campos.farmaciaId.disabled = bloquear;
  campos.medFiltro.disabled = bloquear;
  campos.presentacionId.disabled = bloquear;
  $("farmaciaLink").hidden = bloquear;
  $("presentacionLink").hidden = bloquear;
  $("lockNote").hidden = !bloquear;
  $("medFiltroNote").hidden = bloquear;
}

function modoCrear({ farmaciaId = "", presentacionId = "" } = {}) {
  editando = null;
  existente = null;
  form.reset();
  limpiarErrores();
  bloquearCombinacion(false);
  $("existeNote").hidden = true;

  const farm = farmaciaId || $("farmaciaFilter").value;
  const pres = presentacionId || filtroPres;
  campos.farmaciaId.value = farmacias.has(farm) ? farm : "";
  campos.medFiltro.value = pres && presentaciones.has(pres) ? presentaciones.get(pres).medicamentoId : "";
  llenarPresentaciones();
  campos.presentacionId.value = presentaciones.has(pres) ? pres : "";
  fijarDisponibilidad(true);
  marcarPlaceholders();

  $("formTitle").textContent = "Publicar nueva oferta";
  $("modeChip").textContent = "Creación";
  $("saveText").textContent = "Guardar oferta";
  $("auditFecha").textContent = "Se asigna automáticamente al guardar";
  $("formCard").classList.remove("is-editing");
  actualizarId();
  tomarInstantanea();
  actualizarUrl();
  repintarFilas();
  revisarExistente();
}

function editar(o, { desplazar = false } = {}) {
  editando = o;
  existente = null;
  limpiarErrores();
  $("existeNote").hidden = true;
  bloquearCombinacion(true);

  campos.farmaciaId.value = o.farmaciaId;
  if (!farmacias.has(o.farmaciaId)) {
    campos.farmaciaId.insertAdjacentHTML("beforeend", `<option value="${esc(o.farmaciaId)}">${esc(o.farmaciaId)} (no encontrada)</option>`);
    campos.farmaciaId.value = o.farmaciaId;
  }
  campos.medFiltro.value = presentaciones.get(o.presentacionId)?.medicamentoId || "";
  llenarPresentaciones();
  campos.presentacionId.value = o.presentacionId;
  campos.precio.value = formatoNumero.format(o.precio);
  fijarDisponibilidad(o.disponibilidadReportada === true);
  marcarPlaceholders();

  $("formTitle").textContent = "Editar oferta";
  $("modeChip").textContent = "Edición";
  $("saveText").textContent = "Guardar cambios";
  $("auditFecha").textContent = o.fecha
    ? `Última: ${fechaTexto(o.fecha)}, ${horaCorta.format(o.fecha)} · se renueva al guardar`
    : "Se asigna automáticamente al guardar";
  $("formCard").classList.add("is-editing");
  actualizarId();
  tomarInstantanea();
  actualizarUrl();
  repintarFilas();
  if (desplazar) enfocarFormulario();
}

function repintarFilas() {
  if (!filasVisibles.length) return;
  $("tbody").innerHTML = filasVisibles.map(fila).join("");
}

function enfocarFormulario() {
  if (window.matchMedia("(max-width: 1180px)").matches) {
    $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  let destino = campos.precio;
  if (!editando) {
    if (!campos.farmaciaId.value) destino = campos.farmaciaId;
    else if (!campos.presentacionId.value) destino = campos.presentacionId;
  }
  destino.focus({ preventScroll: true });
}

/** En creación, avisa si la combinación farmacia + presentación ya tiene una oferta (una lectura). */
async function revisarExistente() {
  const turno = ++turnoExiste;
  existente = null;
  $("existeNote").hidden = true;
  const { farmaciaId, presentacionId } = valoresFormulario();
  if (editando || !farmaciaId || !presentacionId) return;
  try {
    const snap = await getDoc(doc(db, COLECCIONES.ofertas, idOferta(farmaciaId, presentacionId)));
    if (turno !== turnoExiste || editando) return;
    if (!snap.exists()) return;
    existente = aFila(snap);
    const disp = existente.disponibilidadReportada ? "disponible" : "no disponible";
    $("existeText").textContent = ` Esta farmacia ya reporta la presentación a ${formatoPrecio(existente.precio)} (${disp}). Actualízala en lugar de crear otra.`;
    $("existeNote").hidden = false;
  } catch (error) {
    console.warn("Farmaps: no se pudo verificar si la oferta existe.", error);
  }
}

$("existeBtn").addEventListener("click", () => {
  if (existente) editar(existente, { desplazar: true });
});

$("newBtn").addEventListener("click", () => {
  if (hayCambios() && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
  modoCrear();
  enfocarFormulario();
});

$("cancelBtn").addEventListener("click", () => {
  if (hayCambios() && !confirm("¿Descartar los cambios del formulario?")) return;
  modoCrear();
});

campos.medFiltro.addEventListener("change", () => {
  llenarPresentaciones();
  actualizarId();
  revisarExistente();
});

[campos.farmaciaId, campos.presentacionId].forEach((s) => s.addEventListener("change", () => {
  const clave = s.id;
  $("formAlert").hidden = true;
  if ($(`${clave}Error`).textContent) marcarCampo(clave, "");
  if (clave === "presentacionId" && s.value && !campos.medFiltro.value) {
    campos.medFiltro.value = presentaciones.get(s.value)?.medicamentoId || "";
    llenarPresentaciones();
  }
  marcarPlaceholders();
  actualizarId();
  revisarExistente();
}));

campos.precio.addEventListener("input", () => {
  campos.precio.value = campos.precio.value.replace(/[^\d.,$\s]/g, "");
  $("formAlert").hidden = true;
  if ($("precioError").textContent) marcarCampo("precio", "");
});
campos.precio.addEventListener("blur", () => {
  const n = leerPrecio(campos.precio.value);
  if (n !== null) campos.precio.value = formatoNumero.format(n);
});
form.querySelectorAll('input[name="disponibilidad"]').forEach((r) => r.addEventListener("change", () => {
  $("formAlert").hidden = true;
}));

function validar() {
  const v = valoresFormulario();
  const errores = {};

  if (!v.farmaciaId) errores.farmaciaId = "Selecciona la farmacia que reporta el precio.";
  else if (!farmacias.has(v.farmaciaId)) errores.farmaciaId = "La farmacia ya no existe en el catálogo.";

  if (!v.presentacionId) errores.presentacionId = "Selecciona la presentación exacta del medicamento.";
  else if (!presentaciones.has(v.presentacionId)) errores.presentacionId = "La presentación ya no existe en el catálogo.";
  else if (!editando && existente) errores.presentacionId = "Esta farmacia ya tiene una oferta para la presentación. Edita la existente.";

  const precio = leerPrecio(v.precio);
  if (!v.precio) errores.precio = "Escribe el precio unitario.";
  else if (precio === null) errores.precio = "Usa solo números enteros, por ejemplo 12500 o 12.500.";
  else if (precio <= 0) errores.precio = "El precio debe ser mayor que cero.";
  else if (precio >= 100000000) errores.precio = "El precio debe ser menor que $ 100.000.000.";

  CLAVES.forEach((k) => marcarCampo(k, errores[k] || ""));
  const primero = CLAVES.find((k) => errores[k]);
  if (primero) {
    campos[primero].focus();
    return null;
  }
  return { farmaciaId: v.farmaciaId, presentacionId: v.presentacionId, precio, disponibilidadReportada: v.disponible };
}

/* ---------- Guardado ---------- */
function estadoGuardando(activo) {
  guardando = activo;
  $("saveBtn").disabled = activo;
  $("cancelBtn").disabled = activo;
  $("saveBtn").classList.toggle("is-loading", activo);
  if (activo) $("saveText").textContent = "Guardando…";
  else $("saveText").textContent = editando ? "Guardar cambios" : "Guardar oferta";
}

class OfertaExistente extends Error {}

/** Refleja el cambio en indicadores y listados sin volver a descargar todo. */
function aplicarCambioLocal(nueva, anterior) {
  if (anterior) {
    if (stats.disponibles !== null) stats.disponibles += (nueva.disponibilidadReportada ? 1 : 0) - (anterior.disponibilidadReportada ? 1 : 0);
    if (stats.hoy !== null && !(anterior.fecha && anterior.fecha >= inicioDeHoy())) stats.hoy++;
  } else {
    if (stats.total !== null) stats.total++;
    if (stats.disponibles !== null && nueva.disponibilidadReportada) stats.disponibles++;
    if (stats.hoy !== null) stats.hoy++;
    const n = stats.porFarmacia.get(nueva.farmaciaId);
    if (typeof n === "number") stats.porFarmacia.set(nueva.farmaciaId, n + 1);
  }
  pintarEstadisticas();

  // Las páginas del servidor cambian de orden: se vuelven a pedir desde la primera.
  cachePaginas = new Map();
  cursores = [];
  conjuntos.forEach((lista) => {
    const i = lista.findIndex((o) => o.id === nueva.id);
    if (i >= 0) lista[i] = nueva;
    else lista.push(nueva);
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (guardando) return;
  $("formAlert").hidden = true;
  const base = validar();
  if (!base) return;

  const anterior = editando;
  const id = idOferta(base.farmaciaId, base.presentacionId);
  const datos = {
    ...base,
    moneda: MONEDA,
    fechaActualizacion: serverTimestamp(),
    // El tipo de dato y la fuente existentes se conservan; los registros nuevos usan el valor por defecto.
    tipoDato: anterior?.tipoDato || "simulado",
    actualizadoPor: usuario.uid
  };
  if (anterior && typeof anterior.fuente === "string") datos.fuente = anterior.fuente;

  const d = describirPresentacion(base.presentacionId);
  const etiqueta = `${d.nombre} en ${nombreFarmacia(base.farmaciaId)}`;

  estadoGuardando(true);
  try {
    const ref = doc(db, COLECCIONES.ofertas, id);
    if (anterior) {
      await setDoc(ref, datos);
    } else {
      await runTransaction(db, async (tx) => {
        if ((await tx.get(ref)).exists()) throw new OfertaExistente();
        tx.set(ref, datos);
      });
    }
    const { fechaActualizacion, ...resto } = datos;
    aplicarCambioLocal({ id, ...resto, fecha: new Date() }, anterior);
    notificar(anterior ? `Oferta actualizada: ${etiqueta}.` : `Oferta publicada: ${etiqueta}.`);
    estadoGuardando(false);
    const conservar = anterior ? {} : { farmaciaId: base.farmaciaId };
    modoCrear(conservar);
    if (!modoFiltrado()) pagina = 1;
    pintarListado();
  } catch (error) {
    estadoGuardando(false);
    if (error instanceof OfertaExistente) {
      await revisarExistente();
      marcarCampo("presentacionId", "Esta farmacia ya tiene una oferta para la presentación. Edita la existente.");
      return;
    }
    console.error("Farmaps: no se pudo guardar la oferta.", error);
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
