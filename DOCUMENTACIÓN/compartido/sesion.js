/* ==========================================================
   FARMAPS - Sesión administrativa (módulo compartido)
   Conecta el acceso con Firebase Authentication y verifica que
   la cuenta esté registrada en la colección "administradores".
   Las reglas de Firestore repiten esta verificación en cada escritura.
   ========================================================== */

import { app, db } from "./firebase.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const auth = getAuth(app);
auth.languageCode = "es";

// La sesión dura mientras la pestaña esté abierta.
const persistenciaLista = setPersistence(auth, browserSessionPersistence).catch(() => {});

export const PAGINA_ACCESO = "../A01/index.html";
export const PAGINA_PANEL = "../A02/index.html";

const MENSAJES = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "El correo no tiene un formato válido.",
  "auth/user-disabled": "Esta cuenta fue deshabilitada.",
  "auth/too-many-requests": "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.",
  "auth/network-request-failed": "No hay conexión. Revisa tu internet e inténtalo de nuevo.",
  "farmaps/no-admin": "Esta cuenta no tiene permisos de administración.",
  "farmaps/verificacion": "No fue posible verificar los permisos. Inténtalo de nuevo."
};

export function mensajeError(error) {
  return MENSAJES[error?.code] || "No fue posible iniciar sesión. Inténtalo de nuevo.";
}

function errorFarmaps(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function esAdministrador(usuario) {
  if (!usuario) return false;
  try {
    const perfil = await getDoc(doc(db, "administradores", usuario.uid));
    return perfil.exists();
  } catch (error) {
    if (error?.code === "permission-denied") return false;
    throw errorFarmaps("farmaps/verificacion");
  }
}

export async function iniciarSesion(correo, clave) {
  await persistenciaLista;
  const { user } = await signInWithEmailAndPassword(auth, correo, clave);
  let autorizado = false;
  try {
    autorizado = await esAdministrador(user);
  } catch (error) {
    await signOut(auth);
    throw error;
  }
  if (!autorizado) {
    await signOut(auth);
    throw errorFarmaps("farmaps/no-admin");
  }
  return user;
}

export const cerrarSesion = () => signOut(auth);

export function esperarUsuario() {
  return new Promise((resolve) => {
    const detener = onAuthStateChanged(auth, (usuario) => {
      detener();
      resolve(usuario);
    });
  });
}

// Solo se aceptan códigos de pantallas administrativas (A02-A09) como destino.
export function destinoAdministrativo(codigo) {
  return /^A0[2-9]$/.test(codigo || "") ? `../${codigo}/index.html` : PAGINA_PANEL;
}

// Para las pantallas A02 en adelante: bloquea el acceso sin sesión de administrador.
export async function exigirAdministrador(codigoPagina) {
  const usuario = await esperarUsuario();
  let autorizado = false;
  try {
    autorizado = await esAdministrador(usuario);
  } catch {
    autorizado = false;
  }
  if (autorizado) return usuario;
  if (usuario) await signOut(auth);
  location.replace(`${PAGINA_ACCESO}?volver=${encodeURIComponent(codigoPagina)}`);
  return new Promise(() => {});
}
