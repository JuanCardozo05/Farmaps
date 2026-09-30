"""Pruebas del prototipo Farmaps (A13-A19) sobre el sitio publicado, con Playwright."""
import json, math, os, re, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get("FARMAPS_URL", "https://farmaps-b3a0c.web.app")
SALIDA = sys.argv[1]
SOLO = sys.argv[2].split(",") if len(sys.argv) > 2 else None
import os
CAT = json.load(open(os.path.join(os.path.dirname(SALIDA), "catalogo.json"), encoding="utf-8"))
FARM = {f["id"]: f for f in CAT["farmacias"]}
PRES_LOS = "losartan-50-mg-caja-x-30-tabletas"
ZONA_T = (4.6672, -74.0535)

resultados = []


def registrar(motor, codigo, desc, ok, det=""):
    resultados.append({"motor": motor, "codigo": codigo, "caso": desc, "ok": bool(ok), "detalle": str(det)[:300]})
    print(f"  [{'PASA' if ok else 'FALLA'}] {codigo} {desc} {det}"[:260], flush=True)


def hav(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def caso(motor, codigo, desc, fn):
    try:
        ok, det = fn()
    except Exception as e:
        ok, det = False, f"Excepción: {type(e).__name__}: {str(e).splitlines()[0][:200]}"
    registrar(motor, codigo, desc, ok, det)


def esperar_ofertas(page, timeout=20000):
    page.wait_for_function("() => document.querySelectorAll('#list .offer').length > 0 || document.querySelector('#list .state')", timeout=timeout)


def suite_publica(motor, browser):
    ctx = browser.new_context(locale="es-CO", viewport={"width": 1366, "height": 768})
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(str(e)[:150]))

    def cp01():
        page.goto(URL + "/")
        page.fill("#searchInput", "losa")
        page.wait_for_selector("#suggestions .suggestion__name", timeout=15000)
        n = page.locator("#suggestions .suggestion__name").all_inner_texts()
        return any("Losart" in x for x in n), n
    caso(motor, "CP-01", "Autocompletado por nombre comercial («losa»)", cp01)

    def cp02():
        page.fill("#searchInput", "")
        page.fill("#searchInput", "acetaminofen")
        page.wait_for_timeout(700)
        n = page.locator("#suggestions .suggestion__name").all_inner_texts()
        return "Dolex" in n and any("Acetaminof" in x for x in n), n
    caso(motor, "CP-02", "Búsqueda por principio activo sin tilde («acetaminofen»)", cp02)

    def cp03():
        page.fill("#searchInput", "zzqx")
        page.wait_for_timeout(700)
        t = page.inner_text("#suggestionsStatus")
        return "No encontramos" in t, t[:80]
    caso(motor, "CP-03", "Mensaje cuando no hay coincidencias", cp03)

    def cp04():
        page.fill("#searchInput", "lo")
        page.press("#searchInput", "Enter")
        page.wait_for_timeout(400)
        t = page.inner_text("#searchError")
        return "3 caracteres" in t and "/P02" not in page.url, t
    caso(motor, "CP-04", "Validación de búsqueda con menos de 3 caracteres", cp04)

    def cp05():
        page.fill("#searchInput", "losartan")
        t0 = time.time()
        page.press("#searchInput", "Enter", no_wait_after=True)
        page.wait_for_url(re.compile(r"/P02/"), timeout=15000)
        page.wait_for_selector("#results .pres", timeout=15000)
        specs = page.locator("#results .pres").all_inner_texts()
        return len(specs) == 2 and any("50 mg" in s for s in specs) and any("100 mg" in s for s in specs), f"{len(specs)} presentaciones en {time.time() - t0:.1f} s"
    caso(motor, "CP-05", "Resultados distinguen presentaciones (Losartán 50 mg y 100 mg)", cp05)

    def cp06():
        page.goto(f"{URL}/P03/index.html?presentacion={PRES_LOS}")
        esperar_ofertas(page)
        page.wait_for_function("() => document.querySelectorAll('.leaflet-marker-icon.marcador').length === document.querySelectorAll('#list .offer').length", timeout=15000)
        precios = [int(re.sub(r"\D", "", x)) for x in page.locator("#list .offer .price").all_inner_texts()]
        monedas = set(re.findall(r"[A-Z]{3}", " ".join(page.locator("#list .offer .price small").all_inner_texts())))
        marcadores = page.locator(".leaflet-marker-icon.marcador").count()
        esperado = sorted(o["precio"] for o in CAT["ofertas"] if o["presentacionId"] == PRES_LOS and o["disponibilidadReportada"])
        ok = precios == [round(p) for p in esperado] and monedas == {"COP"} and marcadores == len(precios)
        return ok, f"{len(precios)} ofertas, {marcadores} marcadores, orden ascendente={precios == sorted(precios)}"
    caso(motor, "CP-06", "Comparación por precio: misma presentación y moneda, lista = marcadores", cp06)

    def cp07():
        attr = page.inner_text(".leaflet-control-attribution")
        aviso = page.inner_text("main")
        return "OpenStreetMap" in attr and "Confirma" in aviso, attr
    caso(motor, "CP-07", "Atribución del mapa y aviso de confirmación con la farmacia", cp07)

    def cp08():
        page.goto(f"{URL}/P03/index.html?presentacion=acetaminofen-150-mg-5-ml-frasco-x-90-ml")
        esperar_ofertas(page)
        t = page.inner_text("#list")
        return "No hay ofertas registradas" in t, t.split("\n")[0]
    caso(motor, "CP-08", "Presentación sin ofertas muestra estado vacío", cp08)
    ctx.close()

    # Geolocalización concedida
    ctx = browser.new_context(locale="es-CO", viewport={"width": 1366, "height": 768}, geolocation={"latitude": ZONA_T[0], "longitude": ZONA_T[1], "accuracy": 20}, permissions=["geolocation"])
    page = ctx.new_page()
    enviados = []
    page.on("request", lambda r: enviados.append((r.url, r.post_data or "")))

    def cp09():
        page.goto(f"{URL}/P04/index.html?volver=comparador&presentacion={PRES_LOS}")
        page.wait_for_selector("#gpsBtn")
        page.click("#gpsBtn")
        page.wait_for_function("() => document.getElementById('latValue').textContent !== '—'", timeout=15000)
        lat, lng = float(page.inner_text("#latValue")), float(page.inner_text("#lngValue"))
        return abs(lat - ZONA_T[0]) < 1e-3 and abs(lng - ZONA_T[1]) < 1e-3, page.inner_text("#currentLabel")
    caso(motor, "CP-09", "Ubicación del visitante con permiso concedido (P04)", cp09)

    def cp10():
        page.click("#bestBtn")
        page.wait_for_url(re.compile(r"orden=distancia"), timeout=15000)
        esperar_ofertas(page)
        page.wait_for_timeout(500)
        textos = page.locator("#list .offer .distance").all_inner_texts()
        km = [float(x.replace("Aprox. ", "").replace(" km", "").replace(",", ".")) if "km" in x else float(re.sub(r"\D", "", x)) / 1000 for x in textos]
        ofs = [o for o in CAT["ofertas"] if o["presentacionId"] == PRES_LOS and o["disponibilidadReportada"]]
        cercana = min(ofs, key=lambda o: hav(ZONA_T, (FARM[o["farmaciaId"]]["latitud"], FARM[o["farmaciaId"]]["longitud"])))
        primera = page.locator("#list .offer .offer__name").first.inner_text()
        esperado = hav(ZONA_T, (FARM[cercana["farmaciaId"]]["latitud"], FARM[cercana["farmaciaId"]]["longitud"]))
        ok = km == sorted(km) and primera == FARM[cercana["farmaciaId"]]["nombre"] and abs(km[0] - esperado) < 0.06 and "línea recta" in page.inner_text("#list")
        return ok, f"1.ª {primera} a {textos[0]} (Haversine esperado {esperado:.3f} km)"
    caso(motor, "CP-10", "Orden por cercanía identifica la farmacia más cercana (Haversine)", cp10)

    def cp11():
        coord = [u for u, b in enviados if "4.667" in u or "4.667" in b or "74.053" in u or "74.053" in b]
        ls = page.evaluate("() => Object.keys(localStorage).filter(k => k.includes('farmaps'))")
        return not coord and not ls, f"solicitudes con coordenadas: {len(coord)}, localStorage: {ls}"
    caso(motor, "CP-11", "Las coordenadas no se envían a servidores ni quedan en localStorage", cp11)

    def cp12():
        page.locator("#list .offer a.btn--primary").first.click()
        page.wait_for_url(re.compile(r"/P05/"), timeout=15000)
        page.wait_for_function("() => !document.getElementById('content').hidden", timeout=15000)
        v = {k: page.inner_text("#" + k) for k in ("medName", "price", "stock", "updated", "pharmName", "pharmAddr", "distanceText", "schedule")}
        ok = all(v.values()) and "$" in v["price"] and "Aprox." in v["distanceText"] and "Confirma antes de desplazarte" in page.inner_text("main")
        return ok, f"{v['pharmName']} · {v['price']} · {v['stock']}"
    caso(motor, "CP-12", "Detalle de la oferta con farmacia, dirección, horario, precio y fecha", cp12)
    ctx.close()

    # Geolocalización denegada y selección manual
    ctx = browser.new_context(locale="es-CO", viewport={"width": 1366, "height": 768}, geolocation={"latitude": ZONA_T[0], "longitude": ZONA_T[1]}, permissions=[])
    page = ctx.new_page()

    def cp13():
        page.goto(f"{URL}/P04/index.html?volver=comparador&presentacion={PRES_LOS}")
        page.wait_for_selector("#map .leaflet-tile-loaded", timeout=15000)
        page.click("#gpsBtn")
        page.wait_for_function("() => document.getElementById('gpsInfo').classList.contains('is-error')", timeout=20000)
        msg = page.inner_text("#gpsInfoText")
        page.locator("#map").click(position={"x": 300, "y": 200})
        page.wait_for_function("() => document.getElementById('latValue').textContent !== '—'", timeout=5000)
        return "manualmente" in msg or "mapa" in msg, f"{msg[:70]} → {page.inner_text('#currentLabel')}"
    caso(motor, "CP-13", "Permiso denegado: mensaje y selección manual del punto", cp13)
    ctx.close()

    # Oferta sin horario registrado
    ctx = browser.new_context(locale="es-CO")
    page = ctx.new_page()
    def cp14():
        page.goto(f"{URL}/P05/index.html?oferta=f05__acetaminofen-500-mg-caja-x-20-tabletas__COP")
        page.wait_for_function("() => !document.getElementById('content').hidden", timeout=15000)
        return page.inner_text("#schedule") == "Horario no registrado", page.inner_text("#schedule")
    caso(motor, "CP-14", "Farmacia sin horario muestra «Horario no registrado»", cp14)

    def cp15():
        page.goto(URL + "/P02/index.html?q=" + "%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E")
        page.wait_for_timeout(2500)
        return page.evaluate("() => window.__xss === undefined") and page.locator("#results img[src='x']").count() == 0, "sin ejecución de código"
    caso(motor, "CP-15", "Texto con HTML en la búsqueda no se ejecuta (inyección)", cp15)
    ctx.close()

    # Fallas de servicios
    ctx = browser.new_context(locale="es-CO")
    page = ctx.new_page()
    page.route(re.compile(r"unpkg\.com|tile\.openstreetmap\.org"), lambda r: r.abort())
    def cp16():
        page.goto(f"{URL}/P03/index.html?presentacion={PRES_LOS}")
        esperar_ofertas(page)
        page.wait_for_timeout(800)
        return not page.locator("#mapError").is_hidden() and page.locator("#list .offer").count() > 0, f"{page.locator('#list .offer').count()} ofertas con el mapa caído"
    caso(motor, "CP-16", "Si falla el mapa se conserva el listado", cp16)
    ctx.close()

    ctx = browser.new_context(locale="es-CO")
    page = ctx.new_page()
    page.route(re.compile(r"firestore\.googleapis\.com"), lambda r: r.abort())
    def cp17():
        page.goto(f"{URL}/P03/index.html?presentacion={PRES_LOS}")
        page.wait_for_selector("#list .state", timeout=40000)
        t = page.inner_text("#list")
        return "No fue posible cargar" in t and "No hay ofertas" not in t, t.split("\n")[0]
    caso(motor, "CP-17", "Falla de la base de datos muestra error, no «sin resultados»", cp17)
    ctx.close()
    if errores: print("  errores JS:", errores[:3])


def suite_responsive(motor, browser):
    paginas = ["/", "/P02/index.html?q=losartan", f"/P03/index.html?presentacion={PRES_LOS}", "/P04/index.html", f"/P05/index.html?oferta=f01__{PRES_LOS}__COP", "/A01/index.html", "/404.html"]
    for w, h in ((360, 800), (1366, 768)):
        ctx = browser.new_context(locale="es-CO", viewport={"width": w, "height": h}, is_mobile=(w < 700) if motor != "firefox" else None, has_touch=w < 700) if motor != "firefox" else browser.new_context(locale="es-CO", viewport={"width": w, "height": h})
        page = ctx.new_page()
        malos = []
        for p in paginas:
            page.goto(URL + p)
            page.wait_for_timeout(2200)
            d = page.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: !!document.querySelector('h1, .brand, .navbar')})")
            if d["sw"] > d["cw"] + 1 or not d["h1"]:
                malos.append(f"{p} ({d['sw']}>{d['cw']})")
        registrar(motor, f"RS-{w}", f"Sin desbordamiento horizontal a {w}×{h} en 7 pantallas", not malos, ", ".join(malos) or "7/7 correctas")
        ctx.close()


def suite_admin(motor, browser):
    ctx = browser.new_context(locale="es-CO", viewport={"width": 1366, "height": 768})
    page = ctx.new_page()
    errores = []
    page.on("pageerror", lambda e: errores.append(str(e)[:150]))

    def ad01():
        page.goto(URL + "/A03/index.html")
        page.wait_for_url(re.compile(r"/A01/"), timeout=15000)
        return "volver=A03" in page.url, page.url.replace(URL, "")
    caso(motor, "AD-01", "Pantalla administrativa sin sesión redirige al acceso", ad01)

    def ad02():
        page.fill("#email", "admin@farmaps.com")
        page.fill("#password", "clave-incorrecta")
        page.click("#loginBtn")
        page.wait_for_selector("#formError:not([hidden])", timeout=15000)
        t = page.inner_text("#formError")
        return t == "Correo o contraseña incorrectos.", t
    caso(motor, "AD-02", "Credenciales incorrectas muestran un mensaje general", ad02)

    def ad03():
        page.fill("#password", os.environ["FARMAPS_ADMIN_PASS"])
        page.click("#loginBtn")
        page.wait_for_url(re.compile(r"/A03/"), timeout=20000)
        page.wait_for_function("() => document.querySelectorAll('#tbody tr').length > 5", timeout=20000)
        return True, f"{page.locator('#tbody tr').count()} farmacias en A03"
    caso(motor, "AD-03", "Inicio de sesión válido y retorno a la pantalla solicitada", ad03)

    def ad04():
        page.click("#newBtn")
        page.wait_for_timeout(400)
        page.click("#saveBtn")
        page.wait_for_timeout(600)
        errs = [page.inner_text(f"#{c}Error") for c in ("nombre", "direccion", "latitud", "longitud")]
        return all(errs), " | ".join(e[:40] for e in errs)
    caso(motor, "AD-04", "Formulario de farmacia vacío muestra mensajes de corrección", ad04)

    def ad05():
        page.fill("#nombre", "Farmacia de prueba")
        page.fill("#direccion", "Calle 1 # 2-3")
        page.fill("#latitud", "95")
        page.fill("#longitud", "-74.06")
        page.click("#saveBtn")
        page.wait_for_timeout(600)
        t = page.inner_text("#latitudError")
        page.click("#cancelBtn")
        return bool(t), t
    caso(motor, "AD-05", "Latitud fuera de rango se rechaza antes de guardar", ad05)

    def ad06():
        cargadas = []
        for c in ("A02", "A04", "A05", "A06"):
            page.goto(f"{URL}/{c}/index.html")
            page.wait_for_function("() => document.querySelector('#tbody tr, #checks li, #statFarmacias') && !document.body.innerText.includes('Cargando')", timeout=25000)
            page.wait_for_timeout(1200)
            cargadas.append(c if c in page.url and page.locator("#loadError").is_hidden() else c + "(error)")
        return all("error" not in c for c in cargadas), " ".join(cargadas)
    caso(motor, "AD-06", "Navegación autenticada por A02, A04, A05 y A06", ad06)

    def ad07():
        page.goto(URL + "/A06/index.html")
        page.wait_for_selector("#tbody tr", timeout=25000)
        page.click("#newBtn")
        page.wait_for_timeout(400)
        page.fill("#precio", "0")
        page.click("#saveBtn")
        page.wait_for_timeout(600)
        t = page.inner_text("#precioError")
        page.click("#cancelBtn")
        return bool(t), t
    caso(motor, "AD-07", "Oferta con precio 0 se rechaza con mensaje", ad07)

    dialogos = []
    def ad08():
        page.goto(URL + "/A06/index.html")
        page.wait_for_selector("#tbody tr", timeout=25000)
        page.click("#newBtn")
        page.fill("#precio", "1500")
        page.once("dialog", lambda d: (dialogos.append(d.message), d.accept()))
        page.click("#logoutBtn")
        page.wait_for_url(re.compile(r"/A01/"), timeout=15000)
        page.goto(URL + "/A02/index.html")
        page.wait_for_url(re.compile(r"/A01/"), timeout=15000)
        return bool(dialogos), f"confirmación: «{dialogos[0] if dialogos else ''}»; acceso bloqueado tras salir"
    caso(motor, "AD-08", "Cierre de sesión con cambios sin guardar pide confirmación y bloquea el panel", ad08)

    def ad09():
        c2 = browser.new_context()
        p2 = c2.new_page()
        p2.goto(URL + "/A02/index.html")
        p2.wait_for_url(re.compile(r"/A01/"), timeout=15000)
        c2.close()
        return True, "sesión de pestaña (browserSessionPersistence)"
    caso(motor, "AD-09", "Una ventana nueva no hereda la sesión administrativa", ad09)
    if errores: print("  errores JS:", errores[:3])
    ctx.close()


def rendimiento(motor, browser):
    pres = sorted({o["presentacionId"] for o in CAT["ofertas"] if o["disponibilidadReportada"]})[:40:4]
    ctx = browser.new_context(locale="es-CO", viewport={"width": 1366, "height": 768})
    page = ctx.new_page()
    page.goto(URL + "/")
    page.wait_for_timeout(1500)
    tiempos = []
    for p in pres:
        page.goto(f"{URL}/P03/index.html?presentacion={p}", wait_until="commit")
        page.wait_for_function("() => { const n = document.querySelectorAll('#list .offer').length; return n > 0 && document.querySelectorAll('.leaflet-marker-icon.marcador').length === n; }", timeout=30000)
        ms = page.evaluate("() => performance.now()")
        n = page.locator("#list .offer").count()
        tiempos.append((p, round(ms), n))
        print(f"    {p}: {round(ms)} ms ({n} ofertas)")
    # Autocompletado en P01
    page.goto(URL + "/")
    page.wait_for_function("() => document.getElementById('statMedicamentos').textContent.trim() !== '—'", timeout=20000)
    page.fill("#searchInput", "ib")
    page.wait_for_timeout(1500)
    filtro = []
    for t in ("ibu", "lor", "ome", "dol", "amo"):
        page.fill("#searchInput", "")
        t0 = page.evaluate("() => performance.now()")
        page.fill("#searchInput", t)
        page.wait_for_function("() => document.querySelectorAll('#suggestions .suggestion').length > 0", timeout=5000)
        filtro.append(round(page.evaluate("() => performance.now()") - t0))
    ctx.close()
    cumplen = sum(1 for _, ms, _ in tiempos if ms <= 3000)
    registrar(motor, "RN-01", "Listado y marcadores en ≤ 3 s en 10 búsquedas consecutivas", cumplen >= 9, f"{cumplen}/10; tiempos ms: {[t for _, t, _ in tiempos]}")
    registrar(motor, "RN-02", "Sugerencias del buscador (P01)", max(filtro) < 1000, f"ms: {filtro}")
    return tiempos, filtro


with sync_playwright() as pw:
    motores = {
        "edge": lambda: pw.chromium.launch(channel="msedge"),
        "chrome": lambda: pw.chromium.launch(channel="chrome"),
        "firefox": lambda: pw.firefox.launch(),
        "webkit": lambda: pw.webkit.launch(),
    }
    extra = {}
    for nombre, lanzar in motores.items():
        if SOLO and nombre not in SOLO: continue
        b = lanzar()
        print(f"== {nombre} {b.version}", flush=True)
        extra[nombre] = {"version": b.version}
        if os.environ.get("SOLO_PERF"):
            t, f = rendimiento(nombre, b)
            extra.setdefault("rendimiento", {})[nombre] = {"busquedas": t, "filtro": f}
            b.close(); continue
        suite_publica(nombre, b)
        suite_responsive(nombre, b)
        if nombre == "edge":
            suite_admin(nombre, b)
            t, f = rendimiento(nombre, b)
            extra["rendimiento"] = {"busquedas": t, "filtro": f}
        b.close()
    json.dump({"resultados": resultados, "extra": extra, "fecha": time.strftime("%Y-%m-%d %H:%M")}, open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nTOTAL {sum(r['ok'] for r in resultados)} de {len(resultados)}")
