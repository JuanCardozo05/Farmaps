import os
"""A15 - Pruebas de datos: descarga el catálogo público por REST y valida su integridad."""
import json, sys, urllib.request, collections

KEY = "AIzaSyBhHn9dAF6kcz7OTOli5OWE3TbKIovZU2Y"
BASE = "https://firestore.googleapis.com/v1/projects/farmaps-b3a0c/databases/(default)/documents/"


def val(v):
    t, x = next(iter(v.items()))
    if t in ("integerValue",): return int(x)
    if t == "doubleValue": return float(x)
    if t == "mapValue": return {k: val(y) for k, y in x.get("fields", {}).items()}
    if t == "arrayValue": return [val(y) for y in x.get("values", [])]
    if t == "nullValue": return None
    return x


def coleccion(nombre):
    docs, token = [], ""
    while True:
        url = f"{BASE}{nombre}?pageSize=300&key={KEY}" + (f"&pageToken={token}" if token else "")
        r = json.load(urllib.request.urlopen(url))
        for d in r.get("documents", []):
            docs.append({"id": d["name"].rsplit("/", 1)[1], **{k: val(v) for k, v in d.get("fields", {}).items()}})
        token = r.get("nextPageToken")
        if not token: return docs


if len(sys.argv) > 2 and sys.argv[2] == "--local":
    datos = json.load(open(sys.argv[1], encoding="utf-8"))
else:
    datos = {c: coleccion(c) for c in ("farmacias", "medicamentos", "presentaciones", "ofertas")}
    json.dump(datos, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, default=str)
F = {x["id"]: x for x in datos["farmacias"]}
M = {x["id"]: x for x in datos["medicamentos"]}
P = {x["id"]: x for x in datos["presentaciones"]}
O = datos["ofertas"]
print({k: len(v) for k, v in datos.items()})

fallos = collections.defaultdict(list)
txt = lambda v: isinstance(v, str) and v.strip() != ""
for f in F.values():
    if not (txt(f.get("nombre")) and txt(f.get("direccion"))): fallos["farmacia sin nombre/dirección"].append(f["id"])
    la, lo = f.get("latitud"), f.get("longitud")
    if not (isinstance(la, float) and 4.45 <= la <= 4.84 and isinstance(lo, float) and -74.25 <= lo <= -73.99):
        fallos["farmacia fuera de Bogotá"].append(f["id"])
    if not txt(f.get("horario")): fallos["farmacia sin horario (opcional)"].append(f["id"])
for m in M.values():
    if not (txt(m.get("nombreComercial")) and txt(m.get("principioActivo"))): fallos["medicamento incompleto"].append(m["id"])
for p in P.values():
    if p.get("medicamentoId") not in M: fallos["presentación sin medicamento"].append(p["id"])
    if not all(txt(p.get(k)) for k in ("concentracion", "formaFarmaceutica", "contenidoEnvase")): fallos["presentación incompleta"].append(p["id"])
ids = set()
for o in O:
    if o.get("farmaciaId") not in F: fallos["oferta sin farmacia"].append(o["id"])
    if o.get("presentacionId") not in P: fallos["oferta sin presentación"].append(o["id"])
    if not (isinstance(o.get("precio"), (int, float)) and o["precio"] > 0): fallos["oferta con precio <= 0"].append(o["id"])
    if o.get("moneda") != "COP": fallos["oferta con moneda distinta de COP"].append(o["id"])
    if not isinstance(o.get("disponibilidadReportada"), bool): fallos["oferta sin disponibilidad booleana"].append(o["id"])
    if not o.get("fechaActualizacion"): fallos["oferta sin fecha"].append(o["id"])
    if o["id"] != f'{o.get("farmaciaId")}__{o.get("presentacionId")}__{o.get("moneda")}': fallos["id de oferta no normalizado"].append(o["id"])
    clave = (o.get("farmaciaId"), o.get("presentacionId"), o.get("moneda"))
    if clave in ids: fallos["oferta duplicada"].append(o["id"])
    ids.add(clave)
for c in ("farmacias", "medicamentos", "ofertas"):
    for x in datos[c]:
        if x.get("tipoDato") not in ("simulado", "real"): fallos[f"{c} sin tipoDato"].append(x["id"])
print("disponibles", sum(o.get("disponibilidadReportada") is True for o in O), "no disp", sum(o.get("disponibilidadReportada") is False for o in O))
por = collections.Counter(o["presentacionId"] for o in O if o.get("disponibilidadReportada") is True)
print("presentaciones con ofertas disp:", len(por), "max", por.most_common(3), "sin ofertas:", len(set(P) - {o["presentacionId"] for o in O}))
print("precio min/max", min(o["precio"] for o in O), max(o["precio"] for o in O))
print("QA doc:", [m for m in M if "prueba" in m or "qa" in m.lower()], [x["id"] for x in O if "prueba" in x["id"]])
for k, v in fallos.items(): print("FALLO", k, len(v), v[:5])
if not fallos: print("SIN FALLOS")
