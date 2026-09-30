import os
"""A16 - Pruebas de permisos y acceso restringido contra las reglas publicadas (REST)."""
import json, urllib.request, urllib.error

KEY = "AIzaSyBhHn9dAF6kcz7OTOli5OWE3TbKIovZU2Y"
DOCS = "https://firestore.googleapis.com/v1/projects/farmaps-b3a0c/databases/(default)/documents/"
AUTH = "https://identitytoolkit.googleapis.com/v1/accounts:"
ORIGEN = {"Referer": "https://farmaps-b3a0c.web.app/"}


def req(metodo, url, cuerpo=None, token=None):
    h = {"Content-Type": "application/json", **ORIGEN}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=json.dumps(cuerpo).encode() if cuerpo is not None else None, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.load(x)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {}


def campos(d):
    out = {}
    for k, v in d.items():
        if isinstance(v, bool): out[k] = {"booleanValue": v}
        elif isinstance(v, (int, float)): out[k] = {"doubleValue": v}
        else: out[k] = {"stringValue": v}
    return out


res = []
def caso(n, desc, ok, det=""):
    res.append((n, desc, ok)); print(("PASA " if ok else "FALLA"), n, desc, det)

farm = {"nombre": "Farmacia CP", "direccion": "Calle 1 # 2-3, Bogotá D.C.", "latitud": 4.65, "longitud": -74.06, "tipoDato": "simulado", "actualizadoPor": "x"}

# Visitante (sin sesión)
s, _ = req("PATCH", DOCS + "farmacias/cp-sin-sesion?key=" + KEY, {"fields": campos(farm)})
caso("S1", "Visitante no puede crear farmacias", s == 403, s)
s, _ = req("PATCH", DOCS + "ofertas/f01__losartan-50-mg-caja-x-30-tabletas__COP?updateMask.fieldPaths=precio&key=" + KEY, {"fields": {"precio": {"doubleValue": 1}}})
caso("S2", "Visitante no puede modificar el precio de una oferta", s == 403, s)
s, _ = req("GET", DOCS + "administradores?key=" + KEY)
caso("S3", "Visitante no puede listar administradores", s == 403, s)
s, _ = req("GET", DOCS + "otra-coleccion/x?key=" + KEY)
caso("S4", "Colección no contemplada bloqueada", s == 403, s)
s, _ = req("GET", DOCS + "farmacias/f01?key=" + KEY)
caso("S5", "Lectura pública del catálogo permitida", s == 200, s)

# Cuenta autenticada que no es administradora
s, u = req("POST", AUTH + "signUp?key=" + KEY, {"email": "cp-temporal-farmaps@example.com", "password": "Temporal#2026x", "returnSecureToken": True})
if s == 200:
    t = u["idToken"]
    s2, _ = req("PATCH", DOCS + "farmacias/cp-no-admin?key=" + KEY, {"fields": campos({**farm, "actualizadoPor": u["localId"]})}, t)
    caso("S6", "Usuario autenticado sin perfil administrativo no puede escribir", s2 == 403, s2)
    s3, _ = req("GET", DOCS + "administradores/CFZnI29jgfVC6dBRqJZxykbrkSW2?key=" + KEY, token=t)
    caso("S7", "Usuario autenticado no puede leer el perfil de otro administrador", s3 == 403, s3)
    sd, _ = req("POST", AUTH + "delete?key=" + KEY, {"idToken": t})
    print("   cuenta temporal eliminada:", sd == 200)
else:
    caso("S6", "Registro público de cuentas deshabilitado", s in (400, 403), f"{s} {u.get('error', {}).get('message')}")

# Administrador
s, a = req("POST", AUTH + "signInWithPassword?key=" + KEY, {"email": "admin@farmaps.com", "password": os.environ["FARMAPS_ADMIN_PASS"], "returnSecureToken": True})
caso("S8", "El administrador inicia sesión con Firebase Authentication", s == 200, s)
s, _ = req("POST", AUTH + "signInWithPassword?key=" + KEY, {"email": "admin@farmaps.com", "password": "incorrecta", "returnSecureToken": True})
tokenA, uid = a["idToken"], a["localId"]
s, _ = req("GET", DOCS + "administradores/" + uid + "?key=" + KEY, token=tokenA)
caso("S9", "El administrador lee solo su propio perfil", s == 200, s)
s, _ = req("PATCH", DOCS + "farmacias/cp-lat-invalida?key=" + KEY, {"fields": campos({**farm, "latitud": 200.0, "actualizadoPor": uid})}, tokenA)
caso("S10", "Rechaza farmacia con latitud fuera de rango", s == 403, s)
s, _ = req("PATCH", DOCS + "farmacias/cp-responsable?key=" + KEY, {"fields": campos({**farm, "actualizadoPor": "otro-uid"})}, tokenA)
caso("S11", "Rechaza actualizadoPor distinto del UID de la sesión", s == 403, s)
s, _ = req("PATCH", DOCS + "farmacias/cp-campo-extra?key=" + KEY, {"fields": campos({**farm, "actualizadoPor": uid, "clave": "x"})}, tokenA)
caso("S12", "Rechaza campos no permitidos", s == 403, s)
oid = "f01__losartan-50-mg-caja-x-30-tabletas__COP"
s, _ = req("PATCH", DOCS + f"ofertas/{oid}?updateMask.fieldPaths=precio&key=" + KEY, {"fields": {"precio": {"doubleValue": 0}}}, tokenA)
caso("S13", "Rechaza oferta con precio igual a cero", s == 403, s)
s, _ = req("DELETE", DOCS + "ofertas/cp-no-existe?key=" + KEY, token=tokenA)
caso("S14", "Rechaza eliminaciones incluso al administrador", s == 403, s)
s, _ = req("PATCH", DOCS + "administradores/" + uid + "?updateMask.fieldPaths=rol&key=" + KEY, {"fields": {"rol": {"stringValue": "x"}}}, tokenA)
caso("S15", "El perfil administrativo no se modifica desde la aplicación", s == 403, s)
s, f = req("GET", DOCS + "farmacias/f01?key=" + KEY)
datos = {k: v for k, v in f["fields"].items()}
s, _ = req("PATCH", DOCS + "farmacias/f01?key=" + KEY, {"fields": datos}, tokenA)
caso("S16", "Acepta una actualización válida del administrador (mismos datos de f01)", s == 200, s)

print(f"\n{sum(r[2] for r in res)} de {len(res)} casos cumplen")
