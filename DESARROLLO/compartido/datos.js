/* ==========================================================
   FARMAPS - Módulo de acceso a datos (compartido)
   Centraliza las consultas a Cloud Firestore para todas las pantallas.
   ========================================================== */

import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const COLECCIONES = {
  medicamentos: "medicamentos",
  presentaciones: "presentaciones",
  farmacias: "farmacias",
  ofertas: "ofertas"
};

/** Minúsculas y sin tildes, para comparar textos ("Losartán" == "losartan"). */
export const normalizar = (texto = "") =>
  String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const aLista = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

let catalogo = null;

/**
 * Descarga una sola vez los medicamentos con sus presentaciones.
 * El catálogo es pequeño, así que el filtrado se hace en JavaScript.
 */
export function obtenerCatalogo() {
  if (!catalogo) {
    catalogo = Promise.all([
      getDocs(collection(db, COLECCIONES.medicamentos)),
      getDocs(collection(db, COLECCIONES.presentaciones))
    ])
      .then(([snapMed, snapPres]) => {
        const presentaciones = aLista(snapPres);
        const porMedicamento = new Map();
        presentaciones.forEach((p) => {
          if (!porMedicamento.has(p.medicamentoId)) porMedicamento.set(p.medicamentoId, []);
          porMedicamento.get(p.medicamentoId).push(p);
        });

        const medicamentos = aLista(snapMed).map((m) => {
          const pres = porMedicamento.get(m.id) || [];
          return {
            ...m,
            presentaciones: pres,
            _nombre: normalizar(m.nombreComercial),
            _principio: normalizar(m.principioActivo),
            _indice: normalizar([
              m.nombreComercial,
              m.principioActivo,
              ...pres.flatMap((p) => [p.concentracion, String(p.concentracion).replace(/\s+/g, ""), p.formaFarmaceutica])
            ].join(" "))
          };
        });

        medicamentos.sort((a, b) => a.nombreComercial.localeCompare(b.nombreComercial, "es"));
        return { medicamentos, presentaciones };
      })
      .catch((error) => {
        catalogo = null; // permite reintentar
        throw error;
      });
  }
  return catalogo;
}

/**
 * Filtra medicamentos por nombre comercial, principio activo o concentración.
 * Todas las palabras escritas deben aparecer; primero los que empiezan por el texto.
 */
export function buscarMedicamentos(medicamentos, texto, limite = 6) {
  const consulta = normalizar(texto);
  if (!consulta) return [];
  const palabras = consulta.split(/\s+/);

  const puntaje = (m) => {
    if (m._nombre.startsWith(consulta)) return 0;
    if (m._principio.startsWith(consulta)) return 1;
    if (m._nombre.startsWith(palabras[0])) return 2;
    if (m._principio.startsWith(palabras[0])) return 3;
    return 4;
  };

  return medicamentos
    .filter((m) => palabras.every((p) => m._indice.includes(p)))
    .map((m) => ({ m, s: puntaje(m) }))
    .sort((a, b) => a.s - b.s || a.m.nombreComercial.localeCompare(b.m.nombreComercial, "es"))
    .slice(0, limite)
    .map((r) => r.m);
}

export async function contarDocumentos(nombreColeccion) {
  const snap = await getCountFromServer(collection(db, nombreColeccion));
  return snap.data().count;
}

let farmacias = null;

/** Farmacias indexadas por id (se descargan una sola vez). */
export function obtenerFarmacias() {
  if (!farmacias) {
    farmacias = getDocs(collection(db, COLECCIONES.farmacias))
      .then((snap) => new Map(aLista(snap).map((f) => [f.id, f])))
      .catch((error) => {
        farmacias = null;
        throw error;
      });
  }
  return farmacias;
}

/** Ofertas registradas para una presentación, con su fecha como objeto Date. */
export async function obtenerOfertasDePresentacion(presentacionId) {
  const snap = await getDocs(query(collection(db, COLECCIONES.ofertas), where("presentacionId", "==", presentacionId)));
  return aLista(snap).map(conFecha);
}

/** Una oferta por su id (null si no existe o el id no es válido). */
export async function obtenerOferta(ofertaId) {
  if (typeof ofertaId !== "string" || !/^[\w-]{1,300}$/.test(ofertaId)) return null;
  const snap = await getDoc(doc(db, COLECCIONES.ofertas, ofertaId));
  return snap.exists() ? conFecha({ id: snap.id, ...snap.data() }) : null;
}

/** Todas las ofertas con su fecha como objeto Date (uso administrativo). */
export async function obtenerOfertas() {
  const snap = await getDocs(collection(db, COLECCIONES.ofertas));
  return aLista(snap).map(conFecha);
}

function conFecha(o) {
  return { ...o, fechaActualizacion: o.fechaActualizacion?.toDate ? o.fechaActualizacion.toDate() : null };
}

let resumenOfertas = null;

/**
 * Resume las ofertas por presentación: total, disponibles y rango de precios por moneda.
 * El rango usa las ofertas con disponibilidad reportada; si no hay, usa todas.
 */
export function obtenerResumenOfertas() {
  if (!resumenOfertas) {
    resumenOfertas = getDocs(collection(db, COLECCIONES.ofertas))
      .then((snap) => {
        const porPresentacion = new Map();
        aLista(snap).forEach((o) => {
          if (!porPresentacion.has(o.presentacionId)) {
            porPresentacion.set(o.presentacionId, { total: 0, disponibles: 0, todas: [], activas: [] });
          }
          const r = porPresentacion.get(o.presentacionId);
          r.total++;
          r.todas.push(o);
          if (o.disponibilidadReportada === true) {
            r.disponibles++;
            r.activas.push(o);
          }
        });

        porPresentacion.forEach((r) => {
          const base = r.activas.length ? r.activas : r.todas;
          const rangos = {};
          base.forEach(({ moneda, precio }) => {
            if (typeof precio !== "number" || !(precio > 0)) return;
            if (!rangos[moneda]) rangos[moneda] = { min: precio, max: precio };
            rangos[moneda].min = Math.min(rangos[moneda].min, precio);
            rangos[moneda].max = Math.max(rangos[moneda].max, precio);
          });
          r.rangos = rangos;
          delete r.todas;
          delete r.activas;
        });
        return porPresentacion;
      })
      .catch((error) => {
        resumenOfertas = null;
        throw error;
      });
  }
  return resumenOfertas;
}
