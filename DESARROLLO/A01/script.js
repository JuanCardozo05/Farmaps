/* ==========================================================
   FARMAPS - A01 Inicio de sesión administrativo
   ========================================================== */

import {
  iniciarSesion,
  cerrarSesion,
  esperarUsuario,
  esAdministrador,
  mensajeError,
  destinoAdministrativo
} from "../compartido/sesion.js";

const $ = (id) => document.getElementById(id);
const form = $("loginForm");
const emailInput = $("email");
const passwordInput = $("password");
const loginBtn = $("loginBtn");
const loginBtnText = $("loginBtnText");
const formError = $("formError");
const notice = $("notice");
const sessionBox = $("sessionBox");
const togglePassword = $("togglePassword");
const capsHint = $("capsHint");

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const params = new URLSearchParams(location.search);
const destino = destinoAdministrativo(params.get("volver"));

$("goPanel").href = destino;

if (params.has("volver")) {
  mostrarAviso("Inicia sesión como administrador para continuar.");
} else if (params.get("salida") === "1") {
  mostrarAviso("Cerraste sesión correctamente.", true);
}

function mostrarAviso(texto, exito = false) {
  notice.textContent = texto;
  notice.classList.toggle("is-success", exito);
  notice.hidden = false;
}

/* ---------- Validación ---------- */
function marcarCampo(input, mensaje) {
  const error = $(`${input.id}Error`);
  error.textContent = mensaje;
  input.closest(".input").classList.toggle("is-invalid", !!mensaje);
  input.setAttribute("aria-invalid", mensaje ? "true" : "false");
}

function validar() {
  const correo = emailInput.value.trim();
  const clave = passwordInput.value;
  let primerError = null;

  if (!correo) {
    marcarCampo(emailInput, "Escribe tu correo electrónico.");
    primerError = emailInput;
  } else if (!CORREO_VALIDO.test(correo)) {
    marcarCampo(emailInput, "El correo no tiene un formato válido.");
    primerError = emailInput;
  } else {
    marcarCampo(emailInput, "");
  }

  if (!clave) {
    marcarCampo(passwordInput, "Escribe tu contraseña.");
    primerError = primerError || passwordInput;
  } else {
    marcarCampo(passwordInput, "");
  }

  if (primerError) primerError.focus();
  return !primerError;
}

[emailInput, passwordInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") marcarCampo(input, "");
    formError.hidden = true;
  });
});

/* ---------- Contraseña ---------- */
togglePassword.addEventListener("click", () => {
  const visible = passwordInput.type === "password";
  passwordInput.type = visible ? "text" : "password";
  togglePassword.setAttribute("aria-pressed", String(visible));
  togglePassword.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordInput.focus();
});

["keydown", "keyup"].forEach((tipo) => {
  passwordInput.addEventListener(tipo, (e) => {
    if (typeof e.getModifierState === "function") capsHint.hidden = !e.getModifierState("CapsLock");
  });
});
passwordInput.addEventListener("blur", () => { capsHint.hidden = true; });

/* ---------- Estados ---------- */
function cargando(activo) {
  loginBtn.disabled = activo;
  emailInput.readOnly = activo;
  passwordInput.readOnly = activo;
  loginBtn.querySelector("svg").hidden = activo;
  loginBtn.querySelector(".spinner")?.remove();
  if (activo) loginBtn.insertAdjacentHTML("afterbegin", '<span class="spinner" aria-hidden="true"></span>');
  loginBtnText.textContent = activo ? "Verificando acceso…" : "Ingresar al panel";
}

function mostrarSesion(usuario) {
  $("sessionEmail").textContent = usuario.email || "Administrador";
  form.hidden = true;
  sessionBox.hidden = false;
  notice.hidden = true;
}

function mostrarFormulario() {
  sessionBox.hidden = true;
  form.hidden = false;
}

/* ---------- Envío ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;
  if (!validar()) return;

  cargando(true);
  try {
    await iniciarSesion(emailInput.value.trim(), passwordInput.value);
    loginBtnText.textContent = "Acceso concedido…";
    location.replace(destino);
  } catch (error) {
    cargando(false);
    formError.textContent = mensajeError(error);
    formError.hidden = false;
    passwordInput.value = "";
    passwordInput.focus();
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await cerrarSesion();
  mostrarFormulario();
  mostrarAviso("Cerraste sesión correctamente.", true);
  emailInput.focus();
});

/* ---------- Sesión previa ---------- */
(async () => {
  const usuario = await esperarUsuario();
  if (!usuario) return;
  try {
    if (await esAdministrador(usuario)) {
      mostrarSesion(usuario);
      return;
    }
  } catch {
    return;
  }
  await cerrarSesion();
})();
