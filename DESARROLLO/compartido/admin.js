/* ==========================================================
   FARMAPS - Utilidades de las pantallas administrativas (A02-A06)
   ========================================================== */

import { exigirAdministrador, cerrarSesion } from "./sesion.js";

/**
 * Bloquea la pantalla hasta confirmar la sesión de administrador,
 * muestra el correo y conecta el botón "Cerrar sesión".
 */
export async function iniciarPanel(codigoPagina) {
  const usuario = await exigirAdministrador(codigoPagina);
  const correo = document.getElementById("sessionEmail");
  if (correo) correo.textContent = usuario.email || "Administrador";

  const salir = document.getElementById("logoutBtn");
  salir?.addEventListener("click", async () => {
    if (window.farmapsCambiosSinGuardar?.() && !confirm("Tienes cambios sin guardar. ¿Cerrar sesión de todos modos?")) return;
    window.farmapsCambiosSinGuardar = null;
    salir.disabled = true;
    await cerrarSesion();
    location.replace("../A01/index.html?salida=1");
  });

  document.body.classList.remove("is-checking");
  return usuario;
}

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const formatoNumero = new Intl.NumberFormat("es-CO");

const MENSAJES_GUARDADO = {
  "permission-denied": "Firestore rechazó los datos: revisa los campos o confirma que tu cuenta sigue autorizada.",
  unavailable: "No hay conexión con Firestore. Revisa tu internet e inténtalo de nuevo.",
  "deadline-exceeded": "Firestore tardó demasiado en responder. Inténtalo de nuevo.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión."
};

export function mensajeGuardado(error) {
  return MENSAJES_GUARDADO[error?.code] || error?.message || "Ocurrió un error inesperado.";
}

/** Aviso flotante breve (éxito o error). */
export function notificar(texto, tipo = "ok") {
  let zona = document.getElementById("toasts");
  if (!zona) {
    zona = document.createElement("div");
    zona.id = "toasts";
    zona.className = "toasts";
    zona.setAttribute("aria-live", "polite");
    document.body.appendChild(zona);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${tipo}`;
  toast.setAttribute("role", tipo === "error" ? "alert" : "status");
  toast.textContent = texto;
  zona.appendChild(toast);
  setTimeout(() => toast.classList.add("is-leaving"), 4200);
  setTimeout(() => toast.remove(), 4600);
}
