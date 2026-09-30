"""Capturas de evidencia de las pruebas A13-A19 sobre el sitio publicado."""
import os, re, sys, time
from playwright.sync_api import sync_playwright

URL = "https://farmaps-b3a0c.web.app"
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
PRES = "losartan-50-mg-caja-x-30-tabletas"
ZONA_T = {"latitude": 4.6672, "longitude": -74.0535, "accuracy": 20}
indice = []

SELLO = """(t) => {
  let d = document.getElementById('__ev');
  if (!d) { d = document.createElement('div'); d.id = '__ev'; document.body.appendChild(d); }
  d.textContent = t;
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(15,23,42,.88);color:#fff;font:12px/1.4 Consolas,monospace;padding:6px 10px;pointer-events:none';
}"""


def foto(page, codigo, caso, motor):
    sello = f"{codigo} · {caso} · {page.url} · {motor} · {time.strftime('%d/%m/%Y %H:%M:%S')}"
    page.evaluate(SELLO, sello)
    nombre = f"{codigo}.png"
    page.screenshot(path=os.path.join(OUT, nombre))
    indice.append((codigo, caso, page.url, motor, nombre))
    print("ok", codigo, flush=True)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel="msedge")
    motor = f"Microsoft Edge {b.version}"
    vp = {"width": 1366, "height": 768}

    c = b.new_context(locale="es-CO", viewport=vp); p = c.new_page()
    p.goto(URL + "/"); p.fill("#searchInput", "losa"); p.wait_for_selector("#suggestions .suggestion__name"); p.wait_for_timeout(500)
    foto(p, "EV-01", "CP-01 Autocompletado", motor)
    p.fill("#searchInput", "zzqx"); p.wait_for_timeout(900)
    foto(p, "EV-02", "CP-03 Sin coincidencias", motor)
    p.fill("#searchInput", "lo"); p.press("#searchInput", "Enter"); p.wait_for_timeout(500)
    foto(p, "EV-03", "CP-04 Minimo 3 caracteres", motor)
    p.goto(URL + "/P02/index.html?q=losartan"); p.wait_for_selector("#results .pres"); p.wait_for_timeout(800)
    foto(p, "EV-04", "CP-05 Presentaciones separadas", motor)
    p.goto(f"{URL}/P03/index.html?presentacion={PRES}")
    p.wait_for_function("() => { const n = document.querySelectorAll('#list .offer').length; return n > 0 && document.querySelectorAll('.leaflet-marker-icon.marcador').length === n; }", timeout=30000)
    p.wait_for_timeout(1500)
    foto(p, "EV-05", "CP-06/CP-07 Orden por precio, mapa y atribucion", motor)
    p.goto(f"{URL}/P03/index.html?presentacion=acetaminofen-150-mg-5-ml-frasco-x-90-ml"); p.wait_for_selector("#list .state"); p.wait_for_timeout(800)
    foto(p, "EV-06", "CP-08 Presentacion sin ofertas", motor)
    p.goto(f"{URL}/P05/index.html?oferta=f05__acetaminofen-500-mg-caja-x-20-tabletas__COP")
    p.wait_for_function("() => !document.getElementById('content').hidden"); p.wait_for_timeout(800)
    foto(p, "EV-07", "CP-14 Horario no registrado", motor)
    p.goto(URL + "/P02/index.html?q=%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E"); p.wait_for_timeout(2500)
    foto(p, "EV-08", "CP-15 HTML no se ejecuta", motor)
    c.close()

    c = b.new_context(locale="es-CO", viewport=vp, geolocation=ZONA_T, permissions=["geolocation"]); p = c.new_page()
    p.goto(f"{URL}/P04/index.html?volver=comparador&presentacion={PRES}"); p.click("#gpsBtn")
    p.wait_for_function("() => document.getElementById('latValue').textContent !== '—'"); p.wait_for_timeout(1500)
    foto(p, "EV-09", "CP-09 Ubicacion con permiso (Zona T)", motor)
    p.click("#bestBtn"); p.wait_for_url(re.compile(r"orden=distancia")); p.wait_for_selector("#list .offer"); p.wait_for_timeout(1500)
    foto(p, "EV-10", "CP-10 Orden por cercania (Haversine)", motor)
    p.locator("#list .offer a.btn--primary").first.click(); p.wait_for_url(re.compile(r"/P05/"))
    p.wait_for_function("() => !document.getElementById('content').hidden"); p.wait_for_timeout(1200)
    foto(p, "EV-11", "CP-12 Detalle de la oferta", motor)
    c.close()

    c = b.new_context(locale="es-CO", viewport=vp, permissions=[]); p = c.new_page()
    p.goto(f"{URL}/P04/index.html?volver=comparador&presentacion={PRES}"); p.wait_for_selector("#map .leaflet-tile-loaded")
    p.click("#gpsBtn"); p.wait_for_function("() => document.getElementById('gpsInfo').classList.contains('is-error')", timeout=20000)
    p.locator("#map").click(position={"x": 300, "y": 200}); p.wait_for_timeout(1200)
    foto(p, "EV-12", "CP-13 Permiso denegado y punto manual", motor)
    c.close()

    c = b.new_context(locale="es-CO", viewport=vp); p = c.new_page()
    p.route(re.compile(r"unpkg\.com|tile\.openstreetmap\.org"), lambda r: r.abort())
    p.goto(f"{URL}/P03/index.html?presentacion={PRES}"); p.wait_for_selector("#list .offer"); p.wait_for_timeout(1000)
    foto(p, "EV-13", "CP-16 Falla del mapa (servicio bloqueado)", motor)
    c.close()

    c = b.new_context(locale="es-CO", viewport=vp); p = c.new_page()
    p.route(re.compile(r"firestore\.googleapis\.com"), lambda r: r.abort())
    p.goto(f"{URL}/P03/index.html?presentacion={PRES}"); p.wait_for_selector("#list .state", timeout=40000); p.wait_for_timeout(800)
    foto(p, "EV-14", "CP-17 Falla de la base de datos (conexion bloqueada)", motor)
    c.close()

    c = b.new_context(locale="es-CO", viewport=vp); p = c.new_page()
    p.goto(URL + "/A03/index.html"); p.wait_for_url(re.compile(r"/A01/")); p.wait_for_timeout(800)
    foto(p, "EV-15", "AD-01 Acceso sin sesion redirige a A01", motor)
    p.fill("#email", "admin@farmaps.com"); p.fill("#password", "clave-incorrecta"); p.click("#loginBtn")
    p.wait_for_selector("#formError:not([hidden])"); p.wait_for_timeout(400)
    foto(p, "EV-16", "AD-02 Credenciales incorrectas", motor)
    p.fill("#password", os.environ["FARMAPS_ADMIN_PASS"]); p.click("#loginBtn"); p.wait_for_url(re.compile(r"/A03/"))
    p.wait_for_function("() => document.querySelectorAll('#tbody tr').length > 5"); p.wait_for_timeout(800)
    foto(p, "EV-17", "AD-03 Inicio de sesion valido", motor)
    p.click("#newBtn"); p.wait_for_timeout(400); p.click("#saveBtn"); p.wait_for_timeout(700)
    foto(p, "EV-18", "AD-04 Validacion de formulario vacio", motor)
    p.click("#cancelBtn")
    p.goto(URL + "/A02/index.html"); p.wait_for_function("() => !document.body.innerText.includes('Cargando')", timeout=25000); p.wait_for_timeout(1500)
    foto(p, "EV-19", "AD-06 Panel administrativo A02", motor)
    p.goto(URL + "/A06/index.html"); p.wait_for_selector("#tbody tr", timeout=25000)
    p.click("#newBtn"); p.fill("#precio", "0"); p.click("#saveBtn"); p.wait_for_timeout(700)
    foto(p, "EV-20", "AD-07 Precio 0 rechazado", motor)
    p.click("#cancelBtn")
    p.once("dialog", lambda d: d.accept()); p.click("#logoutBtn"); p.wait_for_url(re.compile(r"/A01/")); p.wait_for_timeout(800)
    foto(p, "EV-21", "AD-08 Cierre de sesion", motor)
    c.close()

    for w, h, cod in ((360, 800, "EV-22"), (1366, 768, "EV-23")):
        c = b.new_context(locale="es-CO", viewport={"width": w, "height": h}, is_mobile=w < 700, has_touch=w < 700); p = c.new_page()
        p.goto(f"{URL}/P03/index.html?presentacion={PRES}"); p.wait_for_selector("#list .offer"); p.wait_for_timeout(1500)
        foto(p, cod, f"A17 Visualizacion a {w}x{h}", motor)
        c.close()
    b.close()

    for nombre, lanzar in (("Google Chrome", lambda: pw.chromium.launch(channel="chrome")), ("Firefox", pw.firefox.launch), ("WebKit (Safari)", pw.webkit.launch)):
        b = lanzar(); m = f"{nombre} {b.version}"
        c = b.new_context(locale="es-CO", viewport={"width": 360, "height": 800}); p = c.new_page()
        p.goto(URL + "/"); p.wait_for_timeout(2500)
        cod = {"Google Chrome": "EV-24", "Firefox": "EV-25", "WebKit (Safari)": "EV-26"}[nombre]
        foto(p, cod, f"A17 P01 a 360x800 en {nombre}", m)
        c.close(); b.close()

with open(os.path.join(OUT, "indice_capturas.csv"), "w", encoding="utf-8-sig") as f:
    f.write("Codigo;Caso;URL;Navegador;Archivo\n")
    for fila in indice:
        f.write(";".join(fila) + "\n")
print("TOTAL", len(indice))
