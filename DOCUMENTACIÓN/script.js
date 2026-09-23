/* ==========================================================
   FARMAPS - P01 Buscar medicamentos (index)
   ========================================================== */

// Pantalla P02 (selección de presentación). Se creará en la subcarpeta "seleccion".
const RESULTS_PAGE = "P02/index.html";
const MAX_SUGERENCIAS = 6;

const form = document.getElementById("searchForm");
const input = document.getElementById("searchInput");
const box = document.getElementById("searchBox");
const error = document.getElementById("searchError");
const chips = document.querySelectorAll(".chip");
const navbar = document.querySelector(".navbar");
const navToggle = document.getElementById("navToggle");
const panel = document.getElementById("suggestionsPanel");
const lista = document.getElementById("suggestions");
const estado = document.getElementById("suggestionsStatus");
const statMedicamentos = document.getElementById("statMedicamentos");
const statFarmacias = document.getElementById("statFarmacias");

let datos = null;          // módulo compartido/datos.js
let catalogo = null;       // { medicamentos, presentaciones }
let cargaCatalogo = null;  // promesa en curso
let opciones = [];         // opciones visibles en la lista
let activa = -1;           // índice de la opción resaltada con el teclado

/* ---------- Utilidades ---------- */
const escapar = (t = "") =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const normalizarLocal = (t = "") =>
  String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Envuelve en <mark> las partes del texto que coinciden con lo escrito (ignora tildes). */
function resaltar(texto, palabras) {
  const chars = [...texto];
  const base = chars.map((c) => normalizarLocal(c)).join("");
  if (base.length !== chars.length) return escapar(texto);

  const marcado = new Array(chars.length).fill(false);
  palabras.forEach((p) => {
    const i = base.indexOf(p);
    if (i >= 0) for (let k = i; k < i + p.length; k++) marcado[k] = true;
  });

  let html = "";
  let abierto = false;
  chars.forEach((c, i) => {
    if (marcado[i] && !abierto) { html += "<mark>"; abierto = true; }
    if (!marcado[i] && abierto) { html += "</mark>"; abierto = false; }
    html += escapar(c);
  });
  return abierto ? html + "</mark>" : html;
}

function animarNumero(el, destino) {
  const duracion = 900;
  const inicio = performance.now();
  const paso = (ahora) => {
    const t = Math.min((ahora - inicio) / duracion, 1);
    el.textContent = Math.round(destino * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/* ---------- Menú móvil ---------- */
navToggle.addEventListener("click", () => {
  const abierto = navbar.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", abierto);
});

/* ---------- Conexión con Firestore ---------- */
function cargarCatalogo() {
  if (catalogo) return Promise.resolve(catalogo);
  if (!cargaCatalogo) {
    cargaCatalogo = import("./compartido/datos.js")
      .then((modulo) => {
        datos = modulo;
        return modulo.obtenerCatalogo();
      })
      .then((resultado) => {
        catalogo = resultado;
        return resultado;
      })
      .catch((e) => {
        console.error("Farmaps: no fue posible cargar el catálogo.", e);
        throw e;
      })
      .finally(() => { cargaCatalogo = null; });
  }
  return cargaCatalogo;
}

async function cargarIndicadores() {
  try {
    const { medicamentos } = await cargarCatalogo();
    animarNumero(statMedicamentos, medicamentos.length);
    const totalFarmacias = await datos.contarDocumentos(datos.COLECCIONES.farmacias);
    animarNumero(statFarmacias, totalFarmacias);
  } catch {
    statMedicamentos.textContent = "—";
    statFarmacias.textContent = "—";
  }
}

/* ---------- Sugerencias en vivo ---------- */
function abrirPanel() {
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function cerrarPanel() {
  panel.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  activa = -1;
}

function mostrarEstado(mensaje, tipo = "") {
  lista.innerHTML = "";
  opciones = [];
  estado.textContent = mensaje;
  estado.className = `suggestions__status ${tipo}`.trim();
  estado.hidden = false;
  abrirPanel();
}

function pintarSugerencias(resultados, texto) {
  const palabras = normalizarLocal(texto).trim().split(/\s+/).filter(Boolean);
  estado.hidden = true;
  activa = -1;

  opciones = resultados.map((m) => ({ tipo: "medicamento", medicamento: m }));
  opciones.push({ tipo: "todos", texto });

  lista.innerHTML = opciones.map((op, i) => {
    if (op.tipo === "todos") {
      return `
        <li class="suggestion suggestion--all" role="option" id="sug-${i}" data-index="${i}" aria-selected="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          Ver todos los resultados para “${escapar(texto.trim())}”
        </li>`;
    }
    const m = op.medicamento;
    const concentraciones = [...new Set(m.presentaciones.map((p) => p.concentracion))];
    const etiquetas = concentraciones.slice(0, 3)
      .map((c) => `<span class="suggestion__tag">${resaltar(c, palabras)}</span>`).join("");
    const extra = concentraciones.length > 3 ? `<span class="suggestion__tag">+${concentraciones.length - 3}</span>` : "";
    const total = m.presentaciones.length;

    return `
      <li class="suggestion" role="option" id="sug-${i}" data-index="${i}" aria-selected="false">
        <span class="suggestion__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>
        </span>
        <span class="suggestion__body">
          <span class="suggestion__name">${resaltar(m.nombreComercial, palabras)}</span>
          <span class="suggestion__meta">Principio activo: ${resaltar(m.principioActivo, palabras)} · ${total} ${total === 1 ? "presentación" : "presentaciones"}</span>
        </span>
        <span class="suggestion__tags">${etiquetas}${extra}</span>
      </li>`;
  }).join("");

  abrirPanel();
}

async function actualizarSugerencias() {
  const texto = input.value;
  if (!texto.trim()) { cerrarPanel(); return; }

  if (!catalogo) {
    mostrarEstado("Cargando catálogo de medicamentos…", "is-loading");
    try {
      await cargarCatalogo();
    } catch {
      mostrarEstado("No fue posible conectar con la base de datos. Revisa tu conexión e inténtalo de nuevo.", "is-error");
      return;
    }
    if (input.value !== texto) return; // el usuario siguió escribiendo
  }

  if (catalogo.medicamentos.length === 0) {
    mostrarEstado("El catálogo aún no tiene medicamentos registrados.", "is-error");
    return;
  }

  const resultados = datos.buscarMedicamentos(catalogo.medicamentos, texto, MAX_SUGERENCIAS);
  if (resultados.length === 0) {
    mostrarEstado(`No encontramos medicamentos que coincidan con “${texto.trim()}”. Revisa la ortografía o prueba con el principio activo.`);
    return;
  }
  pintarSugerencias(resultados, texto);
}

function marcarActiva(indice) {
  const items = lista.querySelectorAll(".suggestion");
  if (!items.length) return;
  activa = (indice + items.length) % items.length;
  items.forEach((li, i) => {
    const sel = i === activa;
    li.classList.toggle("is-active", sel);
    li.setAttribute("aria-selected", sel);
    if (sel) {
      input.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    }
  });
}

function irAResultados(texto, medicamentoId) {
  const params = new URLSearchParams({ q: texto.trim() });
  if (medicamentoId) params.set("medicamento", medicamentoId);
  window.location.href = `${RESULTS_PAGE}?${params.toString()}`;
}

function elegirOpcion(indice) {
  const op = opciones[indice];
  if (!op) return;
  if (op.tipo === "todos") {
    form.requestSubmit();
    return;
  }
  input.value = op.medicamento.nombreComercial;
  cerrarPanel();
  irAResultados(op.medicamento.nombreComercial, op.medicamento.id);
}

/* ---------- Eventos del buscador ---------- */
const limpiarError = () => {
  error.textContent = "";
  box.classList.remove("is-invalid");
};

input.addEventListener("input", () => {
  limpiarError();
  chips.forEach((c) => c.classList.toggle("is-selected", c.dataset.value === input.value));
  actualizarSugerencias();
});

input.addEventListener("focus", () => {
  if (input.value.trim()) actualizarSugerencias();
});

input.addEventListener("keydown", (e) => {
  if (panel.hidden) {
    if (e.key === "ArrowDown" && input.value.trim()) actualizarSugerencias();
    return;
  }
  if (e.key === "ArrowDown") { e.preventDefault(); marcarActiva(activa + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); marcarActiva(activa - 1); }
  else if (e.key === "Escape") { cerrarPanel(); }
  else if (e.key === "Enter" && activa >= 0) { e.preventDefault(); elegirOpcion(activa); }
});

// mousedown evita que el input pierda el foco antes del clic
lista.addEventListener("mousedown", (e) => e.preventDefault());
lista.addEventListener("click", (e) => {
  const li = e.target.closest(".suggestion");
  if (li) elegirOpcion(Number(li.dataset.index));
});
lista.addEventListener("mousemove", (e) => {
  const li = e.target.closest(".suggestion");
  if (li && Number(li.dataset.index) !== activa) marcarActiva(Number(li.dataset.index));
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-field")) cerrarPanel();
});

// Chips de ejemplo: rellenan el campo y muestran sugerencias
chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chips.forEach((c) => c.classList.remove("is-selected"));
    chip.classList.add("is-selected");
    input.value = chip.dataset.value;
    limpiarError();
    input.focus();
    actualizarSugerencias();
  });
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const consulta = input.value.trim();

  if (consulta.length < 3) {
    error.textContent = "Escribe al menos 3 caracteres para buscar un medicamento.";
    box.classList.add("is-invalid");
    input.focus();
    return;
  }
  cerrarPanel();
  irAResultados(consulta);
});

/* ---------- Inicio ---------- */
cargarIndicadores();
