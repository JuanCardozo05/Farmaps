/* ==========================================================
   FARMAPS - Conexión con Firebase (módulo compartido)
   Todas las páginas importan este archivo para usar la misma app.
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";

// La configuración web de Firebase es pública por diseño;
// la protección de los datos la hacen las reglas de Firestore (firestore.rules).
const firebaseConfig = {
  apiKey: "AIzaSyBhHn9dAF6kcz7OTOli5OWE3TbKIovZU2Y",
  authDomain: "farmaps-b3a0c.firebaseapp.com",
  projectId: "farmaps-b3a0c",
  storageBucket: "farmaps-b3a0c.firebasestorage.app",
  messagingSenderId: "1058378997336",
  appId: "1:1058378997336:web:c7bc805c50a6b86d85342d",
  measurementId: "G-9DQWYG9W6M"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

isSupported()
  .then((ok) => { if (ok) getAnalytics(app); })
  .catch(() => {});
