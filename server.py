#!/usr/bin/env python3
"""Ciné IDF – serveur local : sert l'appli + relais (proxy) vers l'API publique de pathe.fr.
Usage : python3 server.py   puis ouvrir http://localhost:8765
"""
import json, re, urllib.parse, http.server, socketserver, urllib.request, urllib.error, time, os, sys, threading
PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8765))
START = time.time()
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE, TTL, LOCK = {}, 1200, threading.Lock()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "application/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".xml": "application/xml"}
    def end_headers(s):
        p = s.path.split("?")[0]
        if p.endswith((".js", ".css", ".html", "/")) or p.endswith("sw.js"): s.send_header("Cache-Control", "no-cache")
        elif p.endswith((".png", ".svg")): s.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(s, *a): pass
    def send_json(s, code, body):
        s.send_response(code); s.send_header("Content-Type", "application/json; charset=utf-8")
        s.send_header("Content-Length", str(len(body))); s.end_headers(); s.wfile.write(body)
    def do_GET(s):
        if s.path.startswith("/allocine-all/"): return s.allo_all()
        if s.path == "/health": return s.send_json(200, json.dumps({"ok": True, "uptime_s": int(time.time() - START), "cache": len(CACHE)}).encode())
        if s.path.startswith("/allocine/"): return s.allocine()
        if any(x in s.path for x in ("users.json", ".git", "server.py", ".tmp")): return s.send_json(404, b'{"error":"not found"}')
        if not s.path.startswith("/pathe/"): return super().do_GET()
        path = s.path[len("/pathe/"):]
        url = "https://www.pathe.fr/api/" + path + ("&" if "?" in path else "?") + "language=fr"
        now = time.time()
        with LOCK: hit = CACHE.get(url)
        if hit and now - hit[0] < TTL: code, body = 200, hit[1]
        else:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Language": "fr-FR,fr;q=0.9", "Referer": "https://www.pathe.fr/"})
                body = urllib.request.urlopen(req, timeout=20).read(); code = 200
                with LOCK: CACHE[url] = (now, body)
            except urllib.error.HTTPError as e: code, body = e.code, e.read() or b'{"error":"http"}'
            except Exception as e: code, body = 502, ('{"error":"%s"}' % str(e).replace('"', "'")).encode()
        s.send_response(code); s.send_header("Content-Type", "application/json; charset=utf-8")
        s.send_header("Content-Length", str(len(body))); s.end_headers(); s.wfile.write(body)

    def allocine(s):
        # /allocine/<idCinema>/<YYYY-MM-DD>  (méthode de github.com/lefevre-dev/AllocineAPI)
        parts = s.path.split("?")[0].strip("/").split("/")
        if len(parts) != 3 or not re.fullmatch(r"[A-Z0-9]{5}", parts[1]) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", parts[2]):
            return s.send_json(400, b'{"error":"bad request"}')
        try: s.send_json(200, allo_fetch(parts[1], parts[2]))
        except Exception as e: s.send_json(502, json.dumps({"error": str(e)}).encode())
    def allo_all(s):
        # /allocine-all/<YYYY-MM-DD> : tous les cinémas Pathé IDF en une requête
        d = s.path.split("?")[0].strip("/").split("/")[-1]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d): return s.send_json(400, b'{"error":"bad date"}')
        from concurrent.futures import ThreadPoolExecutor
        def one(c):
            try: return c["id"], json.loads(allo_fetch(c["allocineId"], d))["films"]
            except Exception: return c["id"], None
        q = urllib.parse.parse_qs(urllib.parse.urlparse(s.path).query)
        ids = set((q.get("ids") or [""])[0].split(",")) - {""}
        sel = [c for c in ALLO_CINES if c["id"] in ids][:80] if ids else [c for c in ALLO_CINES if c.get("type") in ("pathe", "partner")]
        with ThreadPoolExecutor(12) as ex: res = dict(ex.map(one, sel))
        s.send_json(200, json.dumps({"date": d, "cinemas": res}, ensure_ascii=False).encode())

def allo_fetch(cid, date):
        parts = [None, cid, date]
        key = "allo:" + cid + date; now = time.time()
        with LOCK: hit = CACHE.get(key)
        if hit and now - hit[0] < TTL: return hit[1]
        if True:
            films, page, total = [], 0, 1
            while page < total and page < 10:
                url = "https://www.allocine.fr/_/showtimes/theater-%s/d-%s/p-%d/" % (parts[1], parts[2], page + 1)
                d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=20).read())
                page = int(d["pagination"]["page"]); total = int(d["pagination"]["totalPages"])
                for el in d.get("results", []):
                    m = el.get("movie")
                    if not m: continue
                    seen, times = set(), []
                    for k, lst in (el.get("showtimes") or {}).items():
                        for st in lst or []:
                            if st["internalId"] in seen: continue
                            seen.add(st["internalId"])
                            url_b = None
                            for t in ((st.get("data") or {}).get("ticketing") or []):
                                if t.get("urls") and (t.get("provider") == "default" or not url_b): url_b = t["urls"][0]
                            v = st.get("diffusionVersion") or ""
                            tg = st.get("tags") or []
                            fm = [{"E_4DX": "4DX", "SCREEN_X": "ScreenX", "IMAX": "IMAX", "DOLBY_CINEMA": "Dolby Cinema", "DOLBY": "Dolby", "ONYX": "Onyx"}.get(x, None) for x in (st.get("experience") or [])]
                            fm = [x for x in fm if x] + [x.split(".")[-1].replace("Imax", "IMAX") for x in tg if x.startswith("Format.Projection.") and x.split(".")[-1] in ("3D", "Imax")]
                            times.append({"preview": bool(st.get("isPreview")), "events": [x.split(".")[-1] for x in tg if ".Event." in x],
                                          "fmt": sorted(set(fm)), "acc": any("Accessibility" in x for x in tg),
                                          "time": st["startsAt"], "version": {"ORIGINAL": "vo", "LOCAL": "vf", "DUBBED": "vf"}.get(st.get("diffusionVersion") or "", (st.get("diffusionVersion") or "").lower()),
                                          "url": url_b})
                    dirs = ", ".join(" ".join(filter(None, [(c.get("person") or {}).get("firstName"), (c.get("person") or {}).get("lastName")]))
                                     for c in (m.get("credits") or []) if (c.get("position") or {}).get("name") == "DIRECTOR")
                    films.append({"id": m.get("internalId"), "title": m.get("title"), "originalTitle": m.get("originalTitle"),
                                  "poster": (m.get("poster") or {}).get("url"), "runtime": m.get("runtime"),
                                  "genres": [g.get("translate") for g in m.get("genres") or []], "directors": dirs, "times": times,
                                  "releases": [{"name": r.get("name"), "date": (r.get("releaseDate") or {}).get("date")} for r in m.get("releases") or []],
                                  "year": (m.get("data") or {}).get("productionYear"), "isPremiere": bool((m.get("customFlags") or {}).get("isPremiere")), "weeklyOuting": bool((m.get("customFlags") or {}).get("weeklyOuting")),
                                  "rating": ((m.get("stats") or {}).get("userRating") or {}).get("score"), "press": ((m.get("stats") or {}).get("pressReview") or {}).get("score"),
                                  "cast": [" ".join(filter(None, [((e.get("node") or {}).get("actor") or {}).get("firstName"), ((e.get("node") or {}).get("actor") or {}).get("lastName")])) for e in ((m.get("cast") or {}).get("edges") or [])[:4] if (e.get("node") or {}).get("actor")],
                                  "age": next((r["certificate"]["label"] for r in m.get("releases") or [] if r.get("certificate") and r["certificate"].get("label") and r["certificate"].get("code") != "U"), ""),
                                  "synopsis": re.sub(r"<[^>]+>", "", m.get("synopsis") or "")[:400]})
            body = json.dumps({"source": "allocine", "films": films}, ensure_ascii=False).encode()
            with LOCK: CACHE[key] = (now, body)
            return body

ALLO_CINES = [c for c in json.load(open(os.path.join(ROOT, "data", "cinemas.json"), encoding="utf-8")) if c.get("allocineId")]

# ---------- Comptes & favoris (stockage JSON) ----------
import hashlib, secrets, hmac
DB_PATH = os.environ.get("DB_PATH", os.path.join(ROOT, "users.json")); DBL = threading.Lock()
def db_load():
    try: return json.load(open(DB_PATH, encoding="utf-8"))
    except Exception: return {"users": {}, "tokens": {}}
def db_save(d):
    tmp = DB_PATH + ".tmp"; json.dump(d, open(tmp, "w", encoding="utf-8")); os.replace(tmp, DB_PATH)
def pw_hash(pw, salt): return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200000).hex()

def api_post(h, path):
    n = int(h.headers.get("Content-Length") or 0)
    if n > 20000: return h.send_json(413, b'{"error":"trop gros"}')
    try: body = json.loads(h.rfile.read(n) or b"{}")
    except Exception: return h.send_json(400, b'{"error":"JSON invalide"}')
    out = lambda code, o: h.send_json(code, json.dumps(o, ensure_ascii=False).encode())
    with DBL:
        d = db_load()
        if path in ("/api/signup", "/api/login"):
            email = str(body.get("email", "")).strip().lower(); pw = str(body.get("password", ""))
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 120: return out(400, {"error": "Adresse e-mail invalide."})
            if len(pw) < 6: return out(400, {"error": "Mot de passe : 6 caractères minimum."})
            u = d["users"].get(email)
            if path == "/api/signup":
                if u: return out(409, {"error": "Un compte existe déjà avec cet e-mail."})
                salt = secrets.token_hex(16); u = d["users"][email] = {"salt": salt, "hash": pw_hash(pw, salt), "favs": [], "created": int(time.time())}
            elif not u or not hmac.compare_digest(u["hash"], pw_hash(pw, u["salt"])):
                return out(401, {"error": "E-mail ou mot de passe incorrect."})
            tok = secrets.token_urlsafe(32); d["tokens"][tok] = email; db_save(d)
            return out(200, {"token": tok, "email": email, "favs": u["favs"], "tickets": u.get("tickets", [])})
        email = d["tokens"].get((h.headers.get("Authorization") or "").replace("Bearer ", ""))
        if not email or email not in d["users"]: return out(401, {"error": "Session expirée, reconnectez-vous."})
        if path == "/api/logout":
            d["tokens"] = {k: v for k, v in d["tokens"].items() if k != (h.headers.get("Authorization") or "").replace("Bearer ", "")}; db_save(d); return out(200, {"ok": True})
        u = d["users"][email]
        if path == "/api/favs":
            if "favs" in body: u["favs"] = [str(x)[:80] for x in body.get("favs") or []][:200]
            if "tickets" in body: u["tickets"] = [{k: str(t.get(k, ""))[:600] for k in ("id", "title", "poster", "cinema", "time", "url", "version")} for t in (body.get("tickets") or [])[:200] if isinstance(t, dict)]
            db_save(d); return out(200, {"favs": u["favs"], "tickets": u.get("tickets", [])})
        if path == "/api/me": return out(200, {"email": email, "favs": u["favs"], "tickets": u.get("tickets", [])})
    return out(404, {"error": "inconnu"})
H.do_POST = lambda h: api_post(h, h.path.split("?")[0]) if h.path.startswith("/api/") else h.send_json(404, b'{}')

class TS(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
if __name__ == "__main__":
    import socket
    HOST = os.environ.get("HOST", "0.0.0.0")
    try:
        k = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); k.connect(("8.8.8.8", 80)); ip = k.getsockname()[0]; k.close()
    except Exception: ip = "IP-de-cet-ordinateur"
    print(f"Ciné IDF → sur cet ordinateur : http://localhost:{PORT}")
    print(f"           sur votre téléphone (même Wi-Fi) : http://{ip}:{PORT}")
    print("Ctrl+C pour arrêter")
    def warm():
        import datetime
        from concurrent.futures import ThreadPoolExecutor
        def one(c, dd):
            try: allo_fetch(c["allocineId"], dd)
            except Exception: pass
        while True:
            for k in range(2):
                dd = (datetime.date.today() + datetime.timedelta(days=k)).isoformat()
                with ThreadPoolExecutor(6) as ex: list(ex.map(lambda c: one(c, dd), [c for c in ALLO_CINES if c.get("type") in ("pathe", "partner")]))
            time.sleep(900)
    threading.Thread(target=warm, daemon=True).start()
    TS((HOST, PORT), H).serve_forever()
