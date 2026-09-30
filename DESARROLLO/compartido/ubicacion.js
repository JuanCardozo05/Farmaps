/* ==========================================================
   FARMAPS - Punto de referencia del visitante (módulo compartido)
   - El punto se guarda solo en sessionStorage: nunca se envía a
     Firestore ni a otro servidor y se borra al cerrar la pestaña (RI-11).
   - La distancia se calcula en el navegador durante la consulta.
   ========================================================== */

const CLAVE = "farmaps:referencia";

// Área cubierta por el catálogo (Bogotá D.C.)
export const BOGOTA = {
  centro: [4.6486, -74.0880],
  limites: [[4.45, -74.25], [4.84, -73.99]],
  limitesMapa: [[4.40, -74.32], [4.88, -73.93]]
};

// Lugares conocidos para describir el punto sin usar geocodificación externa
export const LUGARES = [
  { nombre: "Parque de la 93", localidad: "Chapinero", lat: 4.6765, lng: -74.0485 },
  { nombre: "Zona T", localidad: "Chapinero", lat: 4.6672, lng: -74.0535 },
  { nombre: "Calle 72 con Carrera 7", localidad: "Chapinero", lat: 4.6563, lng: -74.0590 },
  { nombre: "Universidad Javeriana", localidad: "Chapinero", lat: 4.6285, lng: -74.0646 },
  { nombre: "Parque Nacional", localidad: "Santa Fe", lat: 4.6225, lng: -74.0660 },
  { nombre: "Centro Internacional", localidad: "Santa Fe", lat: 4.6155, lng: -74.0690 },
  { nombre: "Plaza de Bolívar", localidad: "La Candelaria", lat: 4.5981, lng: -74.0760 },
  { nombre: "Parque de Usaquén", localidad: "Usaquén", lat: 4.6950, lng: -74.0305 },
  { nombre: "Unicentro", localidad: "Usaquén", lat: 4.7020, lng: -74.0415 },
  { nombre: "Calle 170 – Portal Norte", localidad: "Usaquén", lat: 4.7535, lng: -74.0455 },
  { nombre: "Suba Centro", localidad: "Suba", lat: 4.7415, lng: -74.0835 },
  { nombre: "Niza", localidad: "Suba", lat: 4.7110, lng: -74.0710 },
  { nombre: "Colina Campestre", localidad: "Suba", lat: 4.7270, lng: -74.0660 },
  { nombre: "Siete de Agosto", localidad: "Barrios Unidos", lat: 4.6600, lng: -74.0700 },
  { nombre: "Parque Simón Bolívar", localidad: "Teusaquillo", lat: 4.6580, lng: -74.0935 },
  { nombre: "Universidad Nacional", localidad: "Teusaquillo", lat: 4.6380, lng: -74.0840 },
  { nombre: "Galerías", localidad: "Teusaquillo", lat: 4.6420, lng: -74.0750 },
  { nombre: "Park Way – La Soledad", localidad: "Teusaquillo", lat: 4.6300, lng: -74.0730 },
  { nombre: "Gran Estación – Salitre", localidad: "Teusaquillo", lat: 4.6475, lng: -74.1020 },
  { nombre: "Titán Plaza", localidad: "Engativá", lat: 4.6945, lng: -74.0865 },
  { nombre: "Engativá Pueblo", localidad: "Engativá", lat: 4.7060, lng: -74.1170 },
  { nombre: "Aeropuerto El Dorado", localidad: "Fontibón", lat: 4.7016, lng: -74.1469 },
  { nombre: "Fontibón Centro", localidad: "Fontibón", lat: 4.6735, lng: -74.1420 },
  { nombre: "Hayuelos", localidad: "Fontibón", lat: 4.6630, lng: -74.1310 },
  { nombre: "Plaza de las Américas", localidad: "Kennedy", lat: 4.6180, lng: -74.1355 },
  { nombre: "Kennedy Central", localidad: "Kennedy", lat: 4.6130, lng: -74.1530 },
  { nombre: "Portal Américas", localidad: "Kennedy", lat: 4.6290, lng: -74.2050 },
  { nombre: "Bosa Centro", localidad: "Bosa", lat: 4.6190, lng: -74.1900 },
  { nombre: "Zona Industrial – Calle 13", localidad: "Puente Aranda", lat: 4.6300, lng: -74.1050 },
  { nombre: "Paloquemao", localidad: "Los Mártires", lat: 4.6155, lng: -74.0850 },
  { nombre: "Restrepo", localidad: "Antonio Nariño", lat: 4.5875, lng: -74.1030 },
  { nombre: "Veinte de Julio", localidad: "San Cristóbal", lat: 4.5715, lng: -74.0945 },
  { nombre: "Quiroga", localidad: "Rafael Uribe Uribe", lat: 4.5770, lng: -74.1135 },
  { nombre: "Parque El Tunal", localidad: "Tunjuelito", lat: 4.5760, lng: -74.1310 },
  { nombre: "Meissen", localidad: "Ciudad Bolívar", lat: 4.5570, lng: -74.1450 },
  { nombre: "Portal Usme", localidad: "Usme", lat: 4.5305, lng: -74.1170 }
];

export const coordenadasValidas = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function dentroDeBogota(lat, lng) {
  const [[s, o], [n, e]] = BOGOTA.limites;
  return lat >= s && lat <= n && lng >= o && lng <= e;
}

/** Distancia aproximada en línea recta (ortodrómica, fórmula de Haversine) en kilómetros. */
export function distanciaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatoDistancia(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

export function lugarCercano(lat, lng) {
  let mejor = null;
  LUGARES.forEach((l) => {
    const d = distanciaKm({ lat, lng }, l);
    if (!mejor || d < mejor.distancia) mejor = { ...l, distancia: d };
  });
  return mejor;
}

/** Descripción aproximada del punto, calculada localmente con la lista de lugares. */
export function describirPunto(lat, lng) {
  const l = lugarCercano(lat, lng);
  if (!l) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return l.distancia < 1.2
    ? `Cerca de ${l.nombre} · ${l.localidad}, Bogotá D.C.`
    : `A ${formatoDistancia(l.distancia)} de ${l.nombre} · ${l.localidad}, Bogotá D.C.`;
}

export function obtenerReferencia() {
  try {
    const r = JSON.parse(sessionStorage.getItem(CLAVE));
    if (r && coordenadasValidas(r.lat, r.lng)) return r;
  } catch { /* valor corrupto o almacenamiento no disponible */ }
  return null;
}

export function guardarReferencia({ lat, lng, etiqueta, origen }) {
  if (!coordenadasValidas(lat, lng)) throw new Error("Coordenadas no válidas");
  const ref = {
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    etiqueta: etiqueta || describirPunto(lat, lng),
    origen: origen === "gps" ? "gps" : "manual"
  };
  try { sessionStorage.setItem(CLAVE, JSON.stringify(ref)); } catch { /* modo privado sin almacenamiento */ }
  return ref;
}

export function borrarReferencia() {
  try { sessionStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
}
