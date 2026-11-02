import html
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
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "application/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".xml": "application/xml", ".apk": "application/vnd.android.package-archive", ".zip": "application/zip"}
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
        if s.path in ("/health", "/status.json"): return s.send_json(200, json.dumps(status()).encode())
        if s.path.startswith("/u/"):
            ps = re.sub(r"[^a-z0-9_.-]", "", s.path[3:].split("?")[0].replace(".json", "").lower())[:24]
            with DBL: e = (db_load().get("pub") or {}).get(ps)
            if not e: return s.send_json(404, b'{"error":"profil introuvable"}')
            return s.send_json(200, json.dumps({"pseudo": ps, **{k: e.get(k) for k in ("stats", "collections", "badges", "level", "xp", "at")}}, ensure_ascii=False).encode())
        if s.path.startswith("/agenda"): return s.send_json(200, json.dumps(AGENDA, ensure_ascii=False).encode())
        if s.path.startswith("/allocine/"): return s.allocine()
        if s.path.startswith("/yt-trailer/"):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(s.path).query); r = yt_trailer(s.path.split("/")[2].split("?")[0], (qs.get("t") or [""])[0][:120], (qs.get("y") or [""])[0][:4])
            return s.send_json(200, json.dumps({k: r.get(k) for k in ("id", "title", "ch")}, ensure_ascii=False).encode())
        if s.path.startswith("/film-extra/"): return s.send_json(200, film_extra(s.path.split("/")[2]))
        if s.path.startswith("/film/"):
            b = film_page(s.path.split("/")[2].split("?")[0]); s.send_response(200); s.send_header("Content-Type", "text/html; charset=utf-8"); s.send_header("Content-Length", str(len(b))); s.end_headers(); return s.wfile.write(b)
        if s.path == "/sitemap.xml":
            b = sitemap(); s.send_response(200); s.send_header("Content-Type", "application/xml"); s.send_header("Content-Length", str(len(b))); s.end_headers(); return s.wfile.write(b)
        if s.path.startswith("/letterboxd/"):
            try: r = letterboxd(s.path.split("/")[2].split("?")[0]); return s.send_json((503 if r.get("retry") else 404) if "error" in r else 200, json.dumps(r, ensure_ascii=False).encode())
            except Exception as e:
                import traceback; traceback.print_exc(); return s.send_json(502, json.dumps({"error": "Letterboxd ne répond pas, réessayez."}).encode())
        if any(x in s.path for x in ("users.json", "yt_cache", ".git", "server.py", ".tmp")): return s.send_json(404, b'{"error":"not found"}')
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
        with ThreadPoolExecutor(4) as ex: res = dict(ex.map(one, sel))
        s.send_json(200, json.dumps({"date": d, "cinemas": res}, ensure_ascii=False).encode())

def allo_fetch(cid, date):
        parts = [None, cid, date]
        key = "allo:" + cid + date; now = time.time()
        with LOCK: hit = CACHE.get(key)
        if hit and now - hit[0] < TTL: return hit[1]
        if hit and now - hit[0] < 8 * 86400:  # stale-while-revalidate (inclut le dernier instantané sauvegardé)
            if key not in REFRESHING:
                REFRESHING.add(key)
                def bg():
                    try: allo_live(cid, date, key)
                    except Exception: pass
                    finally: REFRESHING.discard(key)
                threading.Thread(target=bg, daemon=True).start()
            return hit[1]
        try: return allo_live(cid, date, key)
        except Exception:
            if hit: return hit[1]
            raise
REFRESHING = set()
ASEM = threading.BoundedSemaphore(1); STAT = {"ok_at": 0, "err_at": 0, "err": "", "backoff_until": 0, "n_ok": 0, "n_err": 0, "backoff_s": 0, "last_req": 0, "snap_loaded": 0, "snap_push": 0, "snap_err": ""}
REPORTS = []; AGENDA = {"at": 0, "films": []}
_snap_dirty = threading.Event(); ALLO_GAP = 1.5  # v17 : 1 requête Allociné à la fois, espacées de 1,5 s; REPORTS = []; AGENDA = {"at": 0, "films": []}
def allo_get(url):
    if time.time() < STAT["backoff_until"]: raise RuntimeError("Allociné ralentit : file d’attente, réessai sous peu")
    with ASEM:
        w = STAT["last_req"] + ALLO_GAP - time.time()
        if w > 0: time.sleep(w)
        STAT["last_req"] = time.time()
        if time.time() < STAT["backoff_until"]: raise RuntimeError("Allociné ralentit : file d’attente, réessai sous peu")
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=20).read())
            STAT["ok_at"] = int(time.time()); STAT["n_ok"] += 1; STAT["backoff_s"] = 0; return d
        except urllib.error.HTTPError as e:
            STAT["err_at"] = int(time.time()); STAT["err"] = str(e); STAT["n_err"] += 1
            if e.code in (429, 503):  # backoff exponentiel : 2 min → 4 → … → 60 min max
                STAT["backoff_s"] = min(3600, max(120, STAT["backoff_s"] * 2)); STAT["backoff_until"] = time.time() + STAT["backoff_s"]
            raise
def status():
    return {"ok": True, "state": "réveillé", "uptime_s": int(time.time() - START), "cache": len(CACHE), "allocine_last_ok": STAT["ok_at"], "allocine_last_error": STAT["err_at"], "allocine_error": STAT["err"],
            "allocine_ok": STAT["n_ok"], "allocine_errors": STAT["n_err"], "throttled": time.time() < STAT["backoff_until"], "agenda_at": AGENDA["at"], "backoff_s": STAT["backoff_s"], "snapshot": {k: STAT[k] for k in ("snap_loaded", "snap_push", "snap_err")}, "reports": len(REPORTS), "now": int(time.time()), "storage": {k: DURABLE.get(k) for k in ("backend", "last_push", "last_pull", "error")}}
def build_agenda():
    import datetime
    big = [c for c in ALLO_CINES if c.get("type") == "pathe" and c.get("allocineId")][:12]
    while True:
        out = {}
        for k in range(0, 28):
            dd = (datetime.date.today() + datetime.timedelta(days=k)).isoformat()
            for c in big:
                try: films = json.loads(allo_fetch(c["allocineId"], dd))["films"]
                except Exception: time.sleep(2); continue
                for f in films:
                    ts = [t for t in f["times"] if t.get("preview") or t.get("events")] or ([] if not f.get("isPremiere") else f["times"])
                    if not ts and k < 7: continue
                    if not ts and k >= 7: ts = f["times"]
                    if not ts: continue
                    e = out.setdefault(str(f["id"]), {"id": f["id"], "title": f["title"], "poster": f.get("poster"), "genres": f.get("genres"), "year": f.get("year"), "dates": {}})
                    for t in ts[:6]: e["dates"].setdefault(dd, []).append({"c": c["id"], "time": t["time"], "ev": t.get("events") or [], "url": t.get("url")})
                time.sleep(0.4)
        AGENDA.update({"at": int(time.time()), "films": sorted(out.values(), key=lambda e: min(e["dates"]))})
        time.sleep(6 * 3600)
def allo_live(cid, date, key):
        parts = [None, cid, date]; now = time.time()
        if True:
            films, page, total = [], 0, 1
            while page < total and page < 10:
                url = "https://www.allocine.fr/_/showtimes/theater-%s/d-%s/p-%d/" % (parts[1], parts[2], page + 1)
                d = allo_get(url)
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
                            fm = [{"E_4DX": "4DX", "SCREEN_X": "ScreenX", "IMAX": "IMAX", "DOLBY_CINEMA": "Dolby Cinema", "DOLBY": "Dolby", "DOLBY_ATMOS": "Dolby Atmos", "PLF": "PLF", "ONYX": "Onyx"}.get(x, None) for x in (st.get("experience") or [])]
                            fm = [x for x in fm if x] + [x.split(".")[-1].replace("Imax", "IMAX").replace("DolbyVision", "Dolby Vision") for x in tg if x.startswith("Format.Projection.") and x.split(".")[-1] in ("3D", "Imax", "DolbyVision")]
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
            if films: _snap_dirty.set()
            return body

ALLO_CINES = [c for c in json.load(open(os.path.join(ROOT, "data", "cinemas.json"), encoding="utf-8")) if c.get("allocineId")]

# ---------- Comptes & favoris (stockage JSON) ----------
import hashlib, secrets, hmac
DB_PATH = os.environ.get("DB_PATH", os.path.join(ROOT, "users.json")); DBL = threading.Lock()
def db_load():
    try: return json.load(open(DB_PATH, encoding="utf-8"))
    except Exception: return {"users": {}, "tokens": {}}
# ---------- Stockage durable (v11) : copie des comptes dans un Gist GitHub privé ----------
# Render gratuit efface users.json à chaque redéploiement : si GIST_TOKEN (+ GIST_ID) sont définis,
# la base est rechargée depuis le Gist au démarrage et sauvegardée (≤ 1 écriture / 10 s) après chaque modification.
GIST_TOKEN = os.environ.get("GIST_TOKEN", ""); GIST_ID = os.environ.get("GIST_ID", ""); GIST_FILE = "cine-idf-users.json"
DURABLE = {"backend": "gist" if GIST_TOKEN and GIST_ID else "local", "last_push": 0, "last_pull": 0, "error": ""}
_dirty = threading.Event()
def _gh(method, data=None):
    r = urllib.request.Request("https://api.github.com/gists/" + GIST_ID, method=method, data=json.dumps(data).encode() if data else None,
        headers={"Authorization": "Bearer " + GIST_TOKEN, "Accept": "application/vnd.github+json", "User-Agent": "cine-idf"})
    return json.load(urllib.request.urlopen(r, timeout=20))
def gist_pull():
    if DURABLE["backend"] != "gist": return
    try:
        f = _gh("GET")["files"].get(GIST_FILE) or {}
        txt = f.get("content") or ""
        if f.get("truncated") and f.get("raw_url"): txt = urllib.request.urlopen(urllib.request.Request(f["raw_url"], headers={"Authorization": "Bearer " + GIST_TOKEN, "User-Agent": "cine-idf"}), timeout=30).read().decode()
        remote = json.loads(txt) if txt.strip() else {}
        if remote.get("users") is not None:
            local = db_load()
            for k in ("users", "tokens", "pub"):
                merged = dict(remote.get(k) or {}); merged.update(local.get(k) or {}); local[k] = merged
            tmp = DB_PATH + ".tmp"; json.dump(local, open(tmp, "w", encoding="utf-8")); os.replace(tmp, DB_PATH)
        DURABLE["last_pull"] = int(time.time()); DURABLE["error"] = ""; print("Gist : comptes rechargés", len((remote.get("users") or {})), flush=True)
    except Exception as e: DURABLE["error"] = "pull: " + str(e)[:120]; print("Gist pull KO", e, flush=True)
def _gist_loop():
    while True:
        _dirty.wait(); time.sleep(10); _dirty.clear()
        try:
            with DBL: body = open(DB_PATH, encoding="utf-8").read()
            _gh("PATCH", {"files": {GIST_FILE: {"content": body}}}); DURABLE["last_push"] = int(time.time()); DURABLE["error"] = ""
        except Exception as e: DURABLE["error"] = "push: " + str(e)[:120]; print("Gist push KO", e, flush=True); time.sleep(30); _dirty.set()
if DURABLE["backend"] == "gist":
    gist_pull(); threading.Thread(target=_gist_loop, daemon=True).start()
# ---------- v17 : instantané des séances dans un 2e fichier du même Gist ----------
# Au démarrage, le dernier cache valide est rechargé et servi tout de suite (même si Allociné répond 429).
SNAP_FILE = "cine-idf-showtimes.json"
def snap_pull():
    if DURABLE["backend"] != "gist": return
    try:
        import datetime
        f = _gh("GET")["files"].get(SNAP_FILE) or {}
        txt = f.get("content") or ""
        if f.get("truncated") and f.get("raw_url"): txt = urllib.request.urlopen(urllib.request.Request(f["raw_url"], headers={"Authorization": "Bearer " + GIST_TOKEN, "User-Agent": "cine-idf"}), timeout=60).read().decode()
        data = json.loads(txt) if txt.strip() else {}
        today = datetime.date.today().isoformat(); n = 0
        with LOCK:
            for k, (ts, body) in data.items():
                if k[-10:] >= today and k not in CACHE: CACHE[k] = (ts, body.encode()); n += 1
        STAT["snap_loaded"] = n; print("Instantané séances rechargé :", n, flush=True)
    except Exception as e: STAT["snap_err"] = "pull: " + str(e)[:120]; print("Snapshot pull KO", e, flush=True)
def _snap_loop():
    import datetime
    while True:
        _snap_dirty.wait(); time.sleep(300); _snap_dirty.clear()
        try:
            today = datetime.date.today().isoformat()
            with LOCK: data = {k: (v[0], v[1].decode()) for k, v in CACHE.items() if k.startswith("allo:") and k[-10:] >= today and b'"films": []' not in v[1]}
            if not data: continue
            _gh("PATCH", {"files": {SNAP_FILE: {"content": json.dumps(data, ensure_ascii=False, separators=(",", ":"))}}}); STAT["snap_push"] = int(time.time()); STAT["snap_err"] = ""
        except Exception as e: STAT["snap_err"] = "push: " + str(e)[:120]; print("Snapshot push KO", e, flush=True); time.sleep(120); _snap_dirty.set()
if DURABLE["backend"] == "gist":
    threading.Thread(target=snap_pull, daemon=True).start(); threading.Thread(target=_snap_loop, daemon=True).start()
def db_save(d):
    tmp = DB_PATH + ".tmp"; json.dump(d, open(tmp, "w", encoding="utf-8")); os.replace(tmp, DB_PATH)
    if DURABLE["backend"] == "gist": _dirty.set()
def pw_hash(pw, salt): return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200000).hex()

PROFILE_KEYS = ("favs", "tickets", "lb", "lists", "alerts", "extra", "game")
def clean_profile(u, body):
    if "favs" in body: u["favs"] = [str(x)[:80] for x in body.get("favs") or []][:300]
    if "tickets" in body: u["tickets"] = [{k: str(t.get(k, ""))[:600] for k in ("id", "title", "poster", "cinema", "cid", "time", "url", "version", "seat", "room", "fid", "src", "ref", "ev")} for t in (body.get("tickets") or [])[:200] if isinstance(t, dict)]
    if "lb" in body: u["lb"] = re.sub(r"[^A-Za-z0-9_-]", "", str(body.get("lb") or ""))[:40]
    if "lists" in body and isinstance(body["lists"], dict):
        u["lists"] = {k: [{f: str(x.get(f, ""))[:400] for f in ("id", "title", "poster", "year", "at")} for x in (body["lists"].get(k) or [])[:500] if isinstance(x, dict)] for k in ("towatch", "seen", "rewatch")}
    if "extra" in body and isinstance(body["extra"], dict) and len(json.dumps(body["extra"])) < 30000: u["extra"] = body["extra"]
    if "game" in body and isinstance(body["game"], dict) and len(json.dumps(body["game"])) < 60000: u["game"] = body["game"]
    if "alerts" in body and isinstance(body["alerts"], dict): u["alerts"] = {k: bool(v) for k, v in list(body["alerts"].items())[:10]}
def prof(email, u): return {"email": email, **{k: u.get(k, [] if k in ("favs", "tickets") else ({} if k in ("lists", "alerts", "extra", "game") else "")) for k in PROFILE_KEYS}, "restore": {"salt": u["salt"], "hash": u["hash"]}}

def api_post(h, path):
    n = int(h.headers.get("Content-Length") or 0)
    if n > 300000: return h.send_json(413, b'{"error":"trop gros"}')
    try: body = json.loads(h.rfile.read(n) or b"{}")
    except Exception: return h.send_json(400, b'{"error":"JSON invalide"}')
    out = lambda code, o: h.send_json(code, json.dumps(o, ensure_ascii=False).encode())
    if path == "/api/report":
        r = {k: str(body.get(k, ""))[:300] for k in ("film", "cinema", "time", "reason", "url")}; r["at"] = int(time.time())
        REPORTS.append(r); del REPORTS[:-200]; print("SIGNALEMENT", json.dumps(r, ensure_ascii=False), flush=True)
        return out(200, {"ok": True})
    tok_in = (h.headers.get("Authorization") or "").replace("Bearer ", "")
    with DBL:
        d = db_load()
        if path in ("/api/signup", "/api/login"):
            email = str(body.get("email", "")).strip().lower(); pw = str(body.get("password", ""))
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 120: return out(400, {"error": "Adresse e-mail invalide."})
            if len(pw) < 6: return out(400, {"error": "Mot de passe : 6 caractères minimum."})
            u = d["users"].get(email)
            if path == "/api/signup":
                if u: return out(409, {"error": "Un compte existe déjà avec cet e-mail : utilisez « Se connecter ».", "code": "exists"})
                salt = secrets.token_hex(16); u = d["users"][email] = {"salt": salt, "hash": pw_hash(pw, salt), "favs": [], "created": int(time.time())}
            else:
                if not u:
                    # v16 : le serveur gratuit a pu perdre ses comptes (mise en veille / redéploiement). L'appareil garde
                    # le sel + hash (jamais le mot de passe) : si le mot de passe saisi correspond, on recrée le compte.
                    r = body.get("restore") or {}
                    if re.fullmatch(r"[0-9a-f]{32}", str(r.get("salt", ""))) and re.fullmatch(r"[0-9a-f]{64}", str(r.get("hash", ""))) and hmac.compare_digest(r["hash"], pw_hash(pw, r["salt"])):
                        u = d["users"][email] = {"salt": r["salt"], "hash": r["hash"], "favs": [], "created": int(time.time()), "restored": True}
                        clean_profile(u, body.get("data") or {})
                    else:
                        return out(401, {"error": "Aucun compte trouvé pour " + email + " sur le serveur (il a peut-être redémarré). Recréez le compte avec « Créer un compte » : vos données de cet appareil seront reprises.", "code": "no_account"})
                elif not hmac.compare_digest(u["hash"], pw_hash(pw, u["salt"])):
                    return out(401, {"error": "Mot de passe incorrect pour " + email + ".", "code": "bad_password"})
            tok = secrets.token_urlsafe(32); d["tokens"][tok] = email; db_save(d)
            return out(200, {"token": tok, **prof(email, u)})
        if path == "/api/restore":
            # Session persistante : si le serveur a perdu ses comptes (redéploiement), l'appareil reconstitue le compte
            email = str(body.get("email", "")).strip().lower(); r = body.get("restore") or {}
            if not tok_in or len(tok_in) < 30 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email): return out(401, {"error": "Session expirée, reconnectez-vous."})
            u = d["users"].get(email)
            if u is None:
                if not (re.fullmatch(r"[0-9a-f]{32}", str(r.get("salt", ""))) and re.fullmatch(r"[0-9a-f]{64}", str(r.get("hash", "")))): return out(401, {"error": "Session expirée, reconnectez-vous."})
                u = d["users"][email] = {"salt": r["salt"], "hash": r["hash"], "favs": [], "created": int(time.time()), "restored": True}
                clean_profile(u, body.get("data") or {})
                d["tokens"][tok_in] = email
            elif d["tokens"].get(tok_in) != email:
                if not hmac.compare_digest(str(r.get("hash", "")), u["hash"]): return out(401, {"error": "Session expirée, reconnectez-vous."})
                d["tokens"][tok_in] = email
            db_save(d); return out(200, prof(email, u))
        email = d["tokens"].get(tok_in)
        if not email or email not in d["users"]: return out(401, {"error": "Session expirée, reconnectez-vous."})
        if path == "/api/logout":
            d["tokens"].pop(tok_in, None); db_save(d); return out(200, {"ok": True})
        u = d["users"][email]
        if path == "/api/favs":
            clean_profile(u, body); db_save(d); return out(200, prof(email, u))
        if path == "/api/me": return out(200, prof(email, u))
        # ---------- Social (v11) ----------
        P = d.setdefault("pub", {}); me = u.get("pseudo")
        def pubview(p, full=False):
            e = P.get(p) or {}; v = {"pseudo": p, **{k: e.get(k) for k in ("stats", "collections", "badges", "level", "xp", "week", "weekXp", "at")}}
            return v
        if path == "/api/public":
            ps = re.sub(r"[^a-z0-9_.-]", "", str(body.get("pseudo", "")).lower())[:24]
            if len(ps) < 3: return out(400, {"error": "Pseudo : 3 caractères minimum (lettres, chiffres, . _ -)."})
            if ps in P and P[ps].get("email") != email: return out(409, {"error": "Ce pseudo est déjà pris."})
            if me and me != ps: P.pop(me, None)
            old = P.get(ps, {}); st = body.get("stats") if isinstance(body.get("stats"), dict) else {}
            P[ps] = {"email": email, "inbox": old.get("inbox", []), "stats": {k: st.get(k) for k in list(st)[:20]}, "collections": (body.get("collections") or [])[:20] if isinstance(body.get("collections"), list) else [],
                     "badges": [str(x)[:40] for x in (body.get("badges") or [])[:40]], "level": str(body.get("level", ""))[:30], "xp": int(body.get("xp") or 0), "week": str(body.get("week", ""))[:10], "weekXp": int(body.get("weekXp") or 0), "at": int(time.time())}
            if len(json.dumps(P[ps])) > 40000: P[ps]["collections"] = []
            u["pseudo"] = ps; db_save(d); return out(200, {"ok": True, "pseudo": ps})
        if path == "/api/friend":
            ps = re.sub(r"[^a-z0-9_.-]", "", str(body.get("pseudo", "")).lower())[:24]; fr = u.setdefault("friends", [])
            if body.get("remove"): u["friends"] = [x for x in fr if x != ps]; db_save(d); return out(200, {"ok": True})
            if ps not in P: return out(404, {"error": "Aucun profil public avec ce pseudo."})
            if ps == me: return out(400, {"error": "C’est votre propre pseudo."})
            if ps not in fr: fr.append(ps); del fr[:-100]
            db_save(d); return out(200, {"ok": True})
        if path == "/api/board":
            names = [x for x in ([me] if me else []) + u.get("friends", []) if x in P]
            rows = sorted([pubview(x) for x in dict.fromkeys(names)], key=lambda r: -(r.get("weekXp") or 0))
            inbox = (P.get(me) or {}).get("inbox", []) if me else []
            return out(200, {"me": me, "friends": u.get("friends", []), "board": rows, "inbox": inbox[-50:]})
        if path == "/api/reco":
            to = re.sub(r"[^a-z0-9_.-]", "", str(body.get("to", "")).lower())[:24]; f = body.get("film") or {}
            if not me: return out(400, {"error": "Créez d’abord votre profil public (pseudo)."})
            if to not in P: return out(404, {"error": "Pseudo introuvable."})
            box = P[to].setdefault("inbox", []); box.append({"from": me, "id": str(f.get("id", ""))[:20], "title": str(f.get("title", ""))[:120], "poster": str(f.get("poster", ""))[:400], "msg": str(body.get("msg", ""))[:200], "at": int(time.time())}); del box[:-100]
            db_save(d); return out(200, {"ok": True})
        if path == "/api/match":  # CinéMatch : swipes validés côté serveur (dédoublonnage, plafonds quotidiens)
            M = u.setdefault("match", {"sw": {}, "days": {}, "xp": 0, "likes": 0})
            op = body.get("op") or "swipe"; today = time.strftime("%Y-%m-%d", time.localtime())
            def state(extra=None):
                lk = sum(1 for v in M["sw"].values() if v.get("d") == "like")
                b = [n for n, k in (("CinéMatch · Premier Match", 1),) if len(M["sw"]) >= k] + [n for n, k in (("CinéMatch · Curieux", 10), ("CinéMatch · Collectionneur", 25), ("CinéMatch · Cinéphile averti", 50)) if lk >= k]
                return {"ok": True, "sw": M["sw"], "once": list(M.get("once", {}))[-3000:], "xp": M["xp"], "likes": lk, "badges": b, **(extra or {})}
            if op == "get": return out(200, state())
            fid = re.sub(r"[^0-9A-Za-z_-]", "", str(body.get("fid", "")))[:20]
            if not fid: return out(400, {"error": "film manquant"})
            if op == "undo":
                M["sw"].pop(fid, None); db_save(d); return out(200, state({"gain": 0}))
            dr = "like" if body.get("dir") == "like" else "pass"
            prev = M["sw"].get(fid); gain = 0
            day = M["days"].setdefault(today, {"like": 0, "swipe": 0, "xp": 0})
            for k in list(M["days"]):
                if k < time.strftime("%Y-%m-%d", time.localtime(time.time() - 60 * 86400)): del M["days"][k]
            once = M.setdefault("once", {}); first = fid not in once
            if first:
                day["swipe"] += 1
                if dr == "like" and day["like"] < 20: day["like"] += 1; gain = 5
                elif dr == "pass" and day["swipe"] <= 30: gain = 1
                if day["xp"] + gain > 60: gain = max(0, 60 - day["xp"])
                day["xp"] += gain; M["xp"] += gain; once[fid] = 1
            M["sw"][fid] = {"d": dr, "at": int(time.time())}
            if len(M["sw"]) > 3000:
                for k in sorted(M["sw"], key=lambda k: M["sw"][k]["at"])[:500]: M["sw"].pop(k)
            db_save(d); return out(200, state({"gain": gain, "dup": prev is not None}))
    return out(404, {"error": "inconnu"})

# ---------- Bande-annonce et photos (fiche Allociné) ----------
def film_extra(fid):
    fid = re.sub(r"\D", "", fid)[:12]; key = "extra:" + fid
    with LOCK: hit = CACHE.get(key)
    if hit and time.time() - hit[0] < (86400 if b'"photos": []' not in hit[1] else 600): return hit[1]
    get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=15).read().decode("utf-8", "replace")
    out = {"trailer": None, "photos": []}
    try:
        t = get(f"https://www.allocine.fr/film/fichefilm_gen_cfilm={fid}.html")
        m = re.search(r"player_gen_cmedia=(\d+)", t)
        if m: out["trailer"] = f"https://player.allocine.fr/{m.group(1)}.html"
        p = get(f"https://www.allocine.fr/film/fichefilm-{fid}/photos/")
        seen = []
        for u in re.findall(r"https://fr\.web\.img\d\.acsta\.net/(?:[a-z]_\d+_\d+/)?(img/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]+\.jpg)", p):
            if u not in seen: seen.append(u)
        out["photos"] = ["https://fr.web.img3.acsta.net/c_400_225/" + u for u in seen[:12]]
    except Exception: pass
    body = json.dumps(out).encode()
    with LOCK: CACHE[key] = (time.time(), body)
    return body

# ---------- v14 : bande-annonce YouTube (rapide) ----------
# Clé YouTube Data API si YT_API_KEY est défini ; sinon lecture de la page publique de résultats YouTube.
# Chaque ID est vérifié via l'oEmbed officiel, puis mis en cache (mémoire + yt_cache.json). Aucun ID n'est inventé.
import unicodedata
YT_KEY = os.environ.get("YT_API_KEY", "") or os.environ.get("YOUTUBE_API_KEY", "")
YT_PATH = os.environ.get("YT_CACHE", os.path.join(ROOT, "yt_cache.json")); YTL = threading.Lock(); YT_SEM = threading.Semaphore(3)
try: YT = json.load(open(YT_PATH))
except Exception: YT = {}
YT_OFFICIAL = ("studiocanal", "pathé", "pathe", "gaumont", "warner bros", "universal pictures", "sony pictures", "disney", "paramount", "le pacte", "diaphana", "metropolitan", "snd", "ugc", "memento", "haut et court", "ad vitam", "pyramide", "bac films", "wild bunch", "tandem", "apollo", "jour2fête", "rezo", "condor", "mk2", "marvel", "pixar", "dreamworks", "20th century", "lionsgate", "a24", "orange studio", "studio tf1", "tf1 studio", "kmbo", "nour films", "zinc", "sophie dulac", "the jokers", "les films du losange", "epicentre", "ufo distribution", "star invest", "eurozoom", "arp", "warner", "netflix", "amazon mgm", "alba films", "destiny films", "dulac", "artistic", "ciné sorbonne")
def _n(s): return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode()).strip()
def _yt_save():
    try:
        tmp = YT_PATH + ".tmp"; json.dump(YT, open(tmp, "w")); os.replace(tmp, YT_PATH)
    except Exception: pass
def _yt_candidates(q):
    if YT_KEY:
        u = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode({"part": "snippet", "q": q, "type": "video", "maxResults": 8, "regionCode": "FR", "relevanceLanguage": "fr", "key": YT_KEY})
        d = json.loads(urllib.request.urlopen(u, timeout=10).read())
        return [{"id": i["id"]["videoId"], "title": i["snippet"]["title"], "ch": i["snippet"]["channelTitle"], "ver": False} for i in d.get("items", [])]
    r = urllib.request.Request("https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": q, "hl": "fr", "gl": "FR"}), headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"})
    t = urllib.request.urlopen(r, timeout=10).read().decode("utf-8", "replace")
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", t)
    if not m: return []
    out = []
    def walk(o):
        if isinstance(o, dict):
            v = o.get("videoRenderer")
            if v and v.get("videoId"):
                out.append({"id": v["videoId"], "title": "".join(x.get("text", "") for x in v.get("title", {}).get("runs", [])), "ch": ((v.get("ownerText") or {}).get("runs") or [{}])[0].get("text", ""), "ver": "VERIFIED" in json.dumps(v.get("ownerBadges", [])), "len": (v.get("lengthText") or {}).get("simpleText", "")})
            else:
                for x in o.values(): walk(x)
        elif isinstance(o, list):
            for x in o: walk(x)
    walk(json.loads(m.group(1))); return out[:12]
def _yt_score(c, title, year):
    vt, ch, nt = _n(c["title"]), _n(c["ch"]), _n(title)
    if not nt or nt not in vt: return -99
    if re.search(r"\b(critique|review|reaction|analyse|explique|ending|fin expliquee|making of|interview|extrait|clip|parodie|fan made|concept|ia|saison|season|episode|serie)\b", vt): return -99
    if c.get("len"):
        p = [int(x) for x in c["len"].split(":") if x.isdigit()]; sec = p[-1] + (p[-2] * 60 if len(p) > 1 else 0) + (p[-3] * 3600 if len(p) > 2 else 0)
        if sec > 360 or sec < 20: return -99
    s = 0
    if re.search(r"bande annonce|trailer", vt): s += 6
    if "teaser" in vt: s -= 2
    if re.search(r"\bvf\b|officiel", vt): s += 2
    if re.search(r"\bvo(st)?\b", vt): s -= 1
    if year and str(year) in vt: s += 2
    elif re.search(r"\b(19|20)\d\d\b", vt) and year: s -= 4
    if any(o in ch for o in map(_n, YT_OFFICIAL)): s += 6
    elif "allocine" in ch: s += 4
    elif "filmsactu" in ch: s += 3
    if c.get("ver"): s += 2
    return s
def _yt_exists(vid):
    try:
        urllib.request.urlopen(urllib.request.Request("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid), headers={"User-Agent": UA}), timeout=8).read(); return True
    except Exception: return False
def yt_trailer(fid, title, year):
    fid = re.sub(r"\D", "", fid)[:12] or _n(title)[:60]
    with YTL: hit = YT.get(fid)
    if hit and time.time() - hit.get("at", 0) < (30 * 86400 if hit.get("id") else 2 * 86400): return hit
    if not title:
        f = films_in_cache().get(fid) or {}; title, year = f.get("title", ""), year or f.get("year", "")
    if not title: return {"id": None}
    res = {"id": None, "at": time.time()}; ok = False
    with YT_SEM:
        try:
            best = None
            for q in (f"{title} {year or ''} bande annonce VF officielle", f"{title} bande annonce"):
                cs = sorted(((_yt_score(c, title, year), i, c) for i, c in enumerate(_yt_candidates(q))), key=lambda x: (-x[0], x[1]))
                for sc, _, c in cs:
                    if sc < 6: break
                    if _yt_exists(c["id"]): best = (sc, c); break
                ok = True
                if best: break
            if best: res.update(id=best[1]["id"], title=best[1]["title"], ch=best[1]["ch"], score=best[0])
        except Exception as e: print("yt", fid, e, file=sys.stderr)
    if ok or res["id"]:
        with YTL: YT[fid] = res; _yt_save()
    return res

def films_in_cache():
    res = {}
    with LOCK: items = [v[1] for k, v in CACHE.items() if k.startswith("allo:")]
    for b in items:
        try:
            for f in json.loads(b)["films"]: res.setdefault(str(f["id"]), f)
        except Exception: pass
    return res
def film_page(fid):
    f = films_in_cache().get(re.sub(r"\D", "", fid))
    page = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    if not f: return page.encode()
    e = lambda x: html.escape(str(x or ""), quote=True)
    title = f"{e(f['title'])} – séances en Île-de-France | Ciné IDF"; desc = e((f.get("synopsis") or "")[:200]) or f"Toutes les séances de {e(f['title'])} à Paris et en Île-de-France."
    page = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", page, flags=re.S)
    page = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', page)
    page = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{title}">', page)
    page = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{desc}">', page)
    page = re.sub(r'<meta property="og:image" content="[^"]*">', f'<meta property="og:image" content="{e(f.get("poster"))}">', page)
    page = page.replace('<link rel="canonical" href="https://cine-idf.onrender.com/">', f'<link rel="canonical" href="https://cine-idf.onrender.com/film/{e(f["id"])}">')
    ld = {"@context": "https://schema.org", "@type": "Movie", "name": f["title"], "image": f.get("poster"), "description": f.get("synopsis"), "director": f.get("directors"), "genre": f.get("genres"), "actor": [{"@type": "Person", "name": a} for a in f.get("cast") or []]}
    page = page.replace("</head>", f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")}</script>\n</head>', 1)
    return page.encode()
def sitemap():
    urls = ["https://cine-idf.onrender.com/"] + ["https://cine-idf.onrender.com/" + p for p in ("comment-ca-marche.html", "confidentialite.html", "statut.html")] + [f"https://cine-idf.onrender.com/film/{i}" for i in list(films_in_cache())[:500]]
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{u}</loc><changefreq>daily</changefreq></url>" for u in urls) + "</urlset>").encode()

# ---------- Letterboxd (pages publiques : vus + watchlist) ----------
LBC = {}
def lb_page(url):
    import urllib.request
    rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"})
    try:
        with urllib.request.urlopen(rq, timeout=15) as r: return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404: return None
        raise
def lb_parse(t, out, seen):
    for slug, name in re.findall(r'data-item-slug="([^"]+)"[^>]*?data-item-name="([^"]+)"', t) + [(b, a) for a, b in re.findall(r'data-item-name="([^"]+)"[^>]*?data-item-slug="([^"]+)"', t)]:
        if slug in seen: continue
        seen.add(slug); name = html.unescape(name); m = re.match(r"(.*) \((\d{4})\)$", name)
        out.append({"n": m.group(1) if m else name, "y": int(m.group(2)) if m else None, "s": slug})
def lb_list(user, kind, maxp):
    """Pages publiques, séquentielles et peu nombreuses (Letterboxd limite les robots)."""
    out, seen = [], set()
    for p in range(1, maxp + 1):
        try: t = lb_page(f"https://letterboxd.com/{user}/{kind}/" + (f"page/{p}/" if p > 1 else ""))
        except Exception: break
        if t is None: return None if p == 1 else out
        n = len(out); lb_parse(t, out, seen)
        if len(out) == n or f"/page/{p + 1}/" not in t: break
        time.sleep(0.5)
    return out
def lb_rss(user):
    try: t = lb_page(f"https://letterboxd.com/{user}/rss/") or ""
    except Exception: return None
    return [{"n": html.unescape(a), "y": int(b) if b else None, "s": ""} for a, b in re.findall(r"<letterboxd:filmTitle>(.*?)</letterboxd:filmTitle>\s*<letterboxd:filmYear>(\d*)</letterboxd:filmYear>", t)]
def letterboxd(user):
    user = urllib.parse.unquote(user).strip().lstrip("@")
    user = re.sub(r"^.*letterboxd\.com/", "", user).split("/")[0]
    if "@" in user: return {"error": "Saisissez votre nom d’utilisateur Letterboxd (visible dans l’adresse letterboxd.com/NOM), pas votre e-mail."}
    user = re.sub(r"[^A-Za-z0-9_-]", "", user)[:40].lower()
    if not user: return {"error": "Nom d’utilisateur Letterboxd manquant."}
    c = LBC.get(user)
    if c and time.time() - c[0] < 3 * 3600: return c[1]
    try: t = lb_page(f"https://letterboxd.com/{user}/rss/")
    except Exception: t = ""
    if t is None: return {"error": f"Profil Letterboxd « {user} » introuvable. Vérifiez le nom d’utilisateur (letterboxd.com/{user})."}
    rss = []
    for it in re.findall(r"<item>(.*?)</item>", t or "", re.S):
        a = re.search(r"<letterboxd:filmTitle>(.*?)</letterboxd:filmTitle>", it)
        if not a: continue
        b = re.search(r"<letterboxd:filmYear>(\d*)</letterboxd:filmYear>", it); r = re.search(r"<letterboxd:memberRating>([\d.]+)</letterboxd:memberRating>", it)
        sl = re.search(r"letterboxd\.com/[^/]+/film/([^/<]+)/", it); w = re.search(r"<letterboxd:watchedDate>([\d-]+)</letterboxd:watchedDate>", it)
        rss.append({"n": html.unescape(a.group(1)), "y": int(b.group(1)) if b and b.group(1) else None, "s": sl.group(1) if sl else "", "r": float(r.group(1)) if r else None, "d": w.group(1) if w else ""})
    films = lb_list(user, "films/by/date", 4)
    watch = lb_list(user, "watchlist", 10) or []
    if not t and not films and not watch:
        return {"error": "Letterboxd bloque temporairement notre serveur. Réessayez dans quelques minutes, ou importez votre export CSV ci-dessous.", "retry": True}
    seen = (films or []) + [x for x in rss if not any(x["n"] == f["n"] for f in (films or []))]
    liked = []
    for x in sorted([x for x in rss if (x.get("r") or 0) >= 4 and x["s"]], key=lambda x: -x["r"])[:6]:
        try:
            pg = lb_page(f"https://letterboxd.com/film/{x['s']}/") or ""; time.sleep(0.4)
            dr = re.search(r'name="twitter:data1" content="([^"]+)"', pg)
            liked.append({**x, "dir": html.unescape(dr.group(1)) if dr else "", "genres": sorted(set(re.findall(r'href="/films/genre/([a-z-]+)/"', pg)))[:5],
                          "cast": [html.unescape(c) for c in re.findall(r'href="/actor/[^"]+"[^>]*>([^<]+)</a>', pg)[:8]]})
        except Exception: break
    for x in rss:  # notes Letterboxd sur les films vus
        for f in seen:
            if f["n"] == x["n"] and x.get("r"): f["r"] = x["r"]
    res = {"user": user, "seen": seen, "watch": watch, "liked": liked, "at": int(time.time()), "partial": not films}
    if seen or watch: LBC[user] = (time.time(), res)
    return res
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
                for c in [c for c in ALLO_CINES if c.get("type") in ("pathe", "partner")]:
                    while time.time() < STAT["backoff_until"]: time.sleep(15)
                    one(c, dd)
            time.sleep(900)
    threading.Thread(target=warm, daemon=True).start()
    threading.Thread(target=build_agenda, daemon=True).start()
    def keepalive():  # évite la mise en veille Render (plan gratuit : 750 h/mois suffisent pour 1 service)
        u = os.environ.get("RENDER_EXTERNAL_URL")
        while u:
            time.sleep(600)
            try: urllib.request.urlopen(u + "/health", timeout=30).read()
            except Exception: pass
    threading.Thread(target=keepalive, daemon=True).start()
    TS((HOST, PORT), H).serve_forever()
