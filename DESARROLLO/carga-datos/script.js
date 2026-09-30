/* ==========================================================
   FARMAPS - Carga inicial de datos en Cloud Firestore
   Escribe cada documento por separado para que las reglas de
   seguridad validen los campos y las referencias de cada uno.
   ========================================================== */

import { app, db } from "../compartido/firebase.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { medicamentos, presentaciones, farmacias, ofertas } from "./datos-semilla.js";

const auth = getAuth(app);
const CONCURRENCIA = 8;

// El orden importa: las reglas verifican que existan las referencias.
const PASOS = [
  { coleccion: "medicamentos", etiqueta: "Medicamentos", registros: medicamentos },
  { coleccion: "presentaciones", etiqueta: "Presentaciones", registros: presentaciones },
  { coleccion: "farmacias", etiqueta: "Farmacias", registros: farmacias },
  { coleccion: "ofertas", etiqueta: "Ofertas", registros: ofertas, conFecha: true }
];

const $ = (id) => document.getElementById(id);
const loginCard = $("loginCard");
const loadCard = $("loadCard");
const loginForm = $("loginForm");
const loginBtn = $("loginBtn");
const loginMsg = $("loginMsg");
const adminMsg = $("adminMsg");
const loadBtn = $("loadBtn");
const logoutBtn = $("logoutBtn");
const progress = $("progress");
const progressFill = $("progressFill");
const progressText = $("progressText");
const log = $("log");

const TOTAL = PASOS.reduce((n, p) => n + p.registros.length, 0);

$("summary").innerHTML = PASOS.map((p) => `
  <div class="summary__item">
    <span class="summary__value">${p.registros.length}</span>
    <span class="summary__label">${p.etiqueta}</span>
  </div>`).join("");

const MENSAJES_AUTH = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "El correo no tiene un formato válido.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  "auth/network-request-failed": "No hay conexión con Firebase. Revisa tu internet.",
  "auth/operation-not-allowed": "Activa el proveedor Correo/contraseña en Firebase Authentication.",
  "auth/configuration-not-found": "Firebase Authentication aún no está habilitado en el proyecto."
};

function agregarLog(texto, clase = "") {
  const li = document.createElement("li");
  li.textContent = texto;
  if (clase) li.className = clase;
  log.appendChild(li);
}

/* ---------- Sesión ---------- */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";
  loginMsg.className = "message";
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) {
    loginMsg.textContent = "Escribe el correo y la contraseña.";
    loginMsg.classList.add("is-error");
    return;
  }
  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    loginMsg.textContent = MENSAJES_AUTH[error.code] || `No fue posible iniciar sesión (${error.code}).`;
    loginMsg.classList.add("is-error");
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (usuario) => {
  loginCard.hidden = !!usuario;
  loadCard.hidden = !usuario;
  log.innerHTML = "";
  progress.hidden = true;
  if (!usuario) return;

  $("sessionEmail").textContent = usuario.email;
  $("sessionUid").textContent = usuario.uid;
  await verificarAdministrador(usuario);
});

async function verificarAdministrador(usuario) {
  loadBtn.disabled = true;
  adminMsg.hidden = true;
  try {
    const perfil = await getDoc(doc(db, "administradores", usuario.uid));
    if (perfil.exists()) {
      loadBtn.disabled = false;
      return;
    }
  } catch (error) {
    console.warn("Farmaps: no se pudo leer el perfil administrativo.", error);
  }
  adminMsg.innerHTML = `
    <strong>Esta cuenta aún no está autorizada como administrador.</strong>
    <ol>
      <li>En la consola de Firebase abre <em>Firestore Database</em>.</li>
      <li>Crea la colección <code>administradores</code>.</li>
      <li>Crea un documento con ID <code>${usuario.uid}</code> y el campo <code>correo</code> (string) = <code>${usuario.email}</code>.</li>
      <li>Recarga esta página.</li>
    </ol>`;
  adminMsg.hidden = false;
}

/* ---------- Carga ---------- */
async function ejecutarEnParalelo(tareas, limite) {
  const errores = [];
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < tareas.length) {
      const tarea = tareas[siguiente++];
      try { await tarea(); } catch (error) { errores.push(error); }
    }
  };
  await Promise.all(Array.from({ length: limite }, trabajador));
  return errores;
}

loadBtn.addEventListener("click", async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  loadBtn.disabled = true;
  logoutBtn.disabled = true;
  log.innerHTML = "";
  progress.hidden = false;

  let hechos = 0;
  let fallidos = 0;
  const avanzar = () => {
    hechos++;
    progressFill.style.width = `${(hechos / TOTAL) * 100}%`;
    progressText.textContent = `${hechos} de ${TOTAL} registros procesados`;
  };

  for (const paso of PASOS) {
    const tareas = paso.registros.map(({ id, ...campos }) => async () => {
      const documento = { ...campos, actualizadoPor: uid };
      if (paso.conFecha) documento.fechaActualizacion = serverTimestamp();
      try {
        await setDoc(doc(db, paso.coleccion, id), documento);
      } catch (error) {
        error.message = `${paso.coleccion}/${id}: ${error.message}`;
        throw error;
      } finally {
        avanzar();
      }
    });

    const errores = await ejecutarEnParalelo(tareas, CONCURRENCIA);
    fallidos += errores.length;
    if (errores.length) {
      agregarLog(`${paso.etiqueta}: ${paso.registros.length - errores.length} guardados, ${errores.length} con error.`, "error");
      errores.slice(0, 3).forEach((e) => agregarLog(e.message, "error"));
      console.error(errores);
    } else {
      agregarLog(`${paso.etiqueta}: ${paso.registros.length} registros guardados.`, "ok");
    }
  }

  progressText.textContent = fallidos
    ? `Carga terminada con ${fallidos} errores. Revisa las reglas de Firestore y vuelve a intentarlo.`
    : "Carga completada. Ya puedes probar el buscador en la página de inicio.";
  loadBtn.disabled = false;
  logoutBtn.disabled = false;
});
