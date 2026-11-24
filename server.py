import html
#!/usr/bin/env python3
"""Pathé & co – serveur local : sert l'appli + relais (proxy) vers l'API publique de pathe.fr.
Usage : python3 server.py   puis ouvrir http://localhost:8765
"""
import json, re, urllib.parse, http.server, socketserver, urllib.request, urllib.error, time, os, sys, threading, gzip, base64, hashlib, socket
PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8765))
START = time.time()
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE, TTL, LOCK = {}, 1200, threading.Lock()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# ---------- v22 : compression gzip, ETag / 304, chemins internes masqués ----------
GZIP_MIN = 500
TEXT_EXT = {".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".xml", ".txt", ".map", ".csv"}
CC_ALLO = "public, max-age=120, stale-while-revalidate=300"
CC_API_SHORT = "public, max-age=60, stale-while-revalidate=180"
CC_REVALIDATE = "no-cache"
BLOCK_PREFIXES = (".git/", "tests/", "android/", "mobile/", "old/", ".github/", "__pycache__/", "screenshots/", "cache/")
BLOCK_FILES = {"users.json", "server.py", "fix.py", "build_data.py", "deploy_github.sh", "dockerfile", "procfile", "render.yaml", "cine-idf.apk.idsig", "readme.md", ".gitignore"}

def etag_for(body):
    return '"' + hashlib.sha256(body).hexdigest()[:16] + '"'

def etag_match(inm, etag):
    if not inm or not etag: return False
    if inm.strip() == "*": return True
    want = etag.strip().strip('"')
    for p in inm.split(","):
        p = p.strip()
        if p.startswith("W/"): p = p[2:].strip()
        if p.strip('"') == want: return True
    return False

def accepts_gzip(handler):
    return "gzip" in (handler.headers.get("Accept-Encoding") or "").lower()

def blocked_rel(rel):
    rel = rel.replace("\\", "/").lstrip("/")
    low = rel.lower()
    if any(low == p.rstrip("/") or low.startswith(p) for p in BLOCK_PREFIXES): return True
    base = os.path.basename(low)
    if base in BLOCK_FILES or "yt_cache" in low or low.endswith(".tmp") or low.endswith(".py"): return True
    if base == "cine-idf.apk" and not low.startswith("download/"): return True
    return False

def times_slim(times):
    out = []
    for t in times or []:
        s = {"time": t.get("time"), "version": t.get("version"), "url": t.get("url")}
        if t.get("fmt"): s["fmt"] = t["fmt"]
        if t.get("events"): s["events"] = t["events"]
        if t.get("preview"): s["preview"] = True
        if t.get("acc"): s["acc"] = True
        out.append(s)
    return out

def slim_public_films(films):
    # synopsis conservé (fiches film / CinéMatch). rating/press Allociné inutilisés depuis la note TMDB.
    out = []
    for f in films or []:
        g = {k: v for k, v in f.items() if k not in ("rating", "press")}
        g["times"] = times_slim(f.get("times"))
        out.append(g)
    return out


# ---------- v25 : itinéraires transports (proxy IDFM PRIM / Navitia) ----------
IDFM_JOURNEYS = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys"
IDFM_CACHE, IDFM_TTL, IDFML = {}, 60, threading.Lock()

def idfm_key():
    return (os.environ.get("IDFM_API_KEY") or "").strip()

def parse_latlng(val):
    if not val or "," not in val: return None
    try:
        lat_s, lng_s = val.split(",", 1)
        lat, lng = float(lat_s.strip()), float(lng_s.strip())
    except Exception:
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180): return None
    return lat, lng

def navitia_dt(s):
    s = str(s or "")
    if len(s) >= 15 and s[8] == "T":
        return "%s-%s-%sT%s:%s:%s" % (s[0:4], s[4:6], s[6:8], s[9:11], s[11:13], s[13:15])
    return s

def place_name(p):
    if not isinstance(p, dict): return ""
    sp = p.get("stop_point") if isinstance(p.get("stop_point"), dict) else {}
    ad = p.get("address") if isinstance(p.get("address"), dict) else {}
    return (p.get("name") or sp.get("name") or ad.get("label") or ad.get("name") or "").strip()

def section_mode(sec):
    t = (sec.get("type") or "")
    mode = (sec.get("mode") or "").lower()
    di = sec.get("display_informations") or {}
    cm = (di.get("commercial_mode") or di.get("physical_mode") or "").lower()
    if t == "waiting": return "waiting"
    if t == "transfer": return "transfer"
    if t in ("street_network", "crow_fly", "park", "bss_rent", "bss_put_back"):
        if "bike" in mode or "bicycle" in mode or "bss" in t: return "bike"
        return "walking"
    if "metro" in cm or "métro" in cm: return "metro"
    if "rer" in cm: return "rer"
    if "tram" in cm: return "tram"
    if "bus" in cm or "noctilien" in cm: return "bus"
    if "train" in cm or "transilien" in cm: return "train"
    if t == "public_transport": return "transit"
    return t or "transit"

def slim_transit_journeys(data):
    out = []
    for j in (data.get("journeys") or [])[:3]:
        sections = []
        for sec in j.get("sections") or []:
            di = sec.get("display_informations") or {}
            color = di.get("color")
            if color and not str(color).startswith("#"): color = "#" + str(color)
            geo = sec.get("geojson")
            if isinstance(geo, dict) and geo.get("type") == "Feature":
                geo = geo.get("geometry")
            if not (isinstance(geo, dict) and geo.get("coordinates")): geo = None
            sections.append({
                "mode": section_mode(sec),
                "duration": int(sec.get("duration") or 0),
                "line": (str(di.get("code") or di.get("label") or "").strip() or None),
                "color": color or None,
                "from": place_name(sec.get("from") or {}),
                "to": place_name(sec.get("to") or {}),
                "geojson": geo,
            })
        out.append({
            "duration": int(j.get("duration") or 0),
            "departure": navitia_dt(j.get("departure_date_time") or ""),
            "arrival": navitia_dt(j.get("arrival_date_time") or ""),
            "transfers": int(j.get("nb_transfers") or 0),
            "sections": sections,
        })
    return {"journeys": out}

def idfm_fetch(olon, olat, dlon, dlat):
    q = urllib.parse.urlencode({"from": "%s;%s" % (olon, olat), "to": "%s;%s" % (dlon, dlat), "count": 3})
    url = IDFM_JOURNEYS + "?" + q
    req = urllib.request.Request(url, headers={
        "apikey": idfm_key(), "Accept": "application/json",
        "User-Agent": "cine-idf-patheco",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def transit_get(handler):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(handler.path).query)
    frm, to = parse_latlng((q.get("from") or [""])[0]), parse_latlng((q.get("to") or [""])[0])
    if not frm or not to:
        return handler.send_json(400, b'{"error":"bad_coords"}', cache_control=CC_REVALIDATE, etag=False)
    if not idfm_key():
        return handler.send_json(503, b'{"error":"no_key"}', cache_control=CC_REVALIDATE, etag=False)
    key = "%.4f,%.4f:%.4f,%.4f" % (frm[0], frm[1], to[0], to[1])
    now = time.time()
    with IDFML:
        hit = IDFM_CACHE.get(key)
        if hit and now - hit[0] < IDFM_TTL:
            return handler.send_json(200, hit[1], cache_control=CC_API_SHORT)
    try:
        raw = idfm_fetch(frm[1], frm[0], to[1], to[0])
        body = json.dumps(slim_transit_journeys(raw), ensure_ascii=False).encode()
    except urllib.error.HTTPError as e:
        return handler.send_json(502, b'{"error":"transit_upstream"}', cache_control=CC_REVALIDATE, etag=False)
    except Exception:
        return handler.send_json(502, b'{"error":"transit_upstream"}', cache_control=CC_REVALIDATE, etag=False)
    with IDFML: IDFM_CACHE[key] = (now, body)
    return handler.send_json(200, body, cache_control=CC_API_SHORT)

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "application/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".xml": "application/xml", ".apk": "application/vnd.android.package-archive", ".zip": "application/zip"}
    def end_headers(s):
        if not getattr(s, "_cc_set", False):
            p = s.path.split("?")[0]
            if p.endswith((".js", ".css", ".html", "/")) or p.endswith("sw.js"): s.send_header("Cache-Control", "no-cache")
            elif p.endswith((".png", ".svg", ".jpg", ".jpeg", ".ico", ".webp")): s.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(s, *a): pass
    def list_directory(s, path):
        s.send_json(404, b'{"error":"not found"}'); return None
    def send_bytes(s, code, body, content_type, cache_control=None, etag=None):
        if body is None: body = b""
        if isinstance(body, str): body = body.encode()
        if etag and code == 200 and etag_match(s.headers.get("If-None-Match"), etag):
            s.send_response(304)
            s.send_header("ETag", etag)
            if cache_control: s.send_header("Cache-Control", cache_control)
            s.send_header("Vary", "Accept-Encoding"); s._cc_set = True
            s.end_headers(); return
        enc = None
        ext = os.path.splitext(s.path.split("?")[0])[1].lower()
        textish = content_type.startswith(("application/json", "text/", "application/javascript", "application/xml", "application/manifest+json", "image/svg+xml")) or ext in TEXT_EXT
        if code == 200 and textish and accepts_gzip(s) and len(body) >= GZIP_MIN:
            gz = gzip.compress(body, 6)
            if len(gz) < len(body): body, enc = gz, "gzip"
        s.send_response(code)
        s.send_header("Content-Type", content_type)
        s.send_header("Content-Length", str(len(body)))
        if enc: s.send_header("Content-Encoding", enc)
        if textish or enc: s.send_header("Vary", "Accept-Encoding")
        if etag: s.send_header("ETag", etag)
        if cache_control: s.send_header("Cache-Control", cache_control)
        s._cc_set = True
        s.end_headers()
        if code != 204 and code != 304: s.wfile.write(body)
    def send_json(s, code, body, cache_control=None, etag=True):
        if isinstance(body, str): body = body.encode()
        s.send_bytes(code, body, "application/json; charset=utf-8",
                     cache_control=cache_control, etag=etag_for(body) if (etag and code == 200) else None)
    def serve_static(s):
        path = s.translate_path(s.path.split("?")[0])
        try: rel = os.path.relpath(path, ROOT)
        except Exception: return s.send_json(404, b'{"error":"not found"}')
        if rel.startswith("..") or blocked_rel(rel): return s.send_json(404, b'{"error":"not found"}')
        if os.path.isdir(path):
            for index in ("index.html", "index.htm"):
                cand = os.path.join(path, index)
                if os.path.isfile(cand) and not blocked_rel(os.path.relpath(cand, ROOT)):
                    path = cand; break
            else:
                return s.send_json(404, b'{"error":"not found"}')
        if not os.path.isfile(path): return s.send_json(404, b'{"error":"not found"}')
        body = open(path, "rb").read()
        ctype = s.guess_type(path)
        ext = os.path.splitext(path)[1].lower()
        if ext in {".js", ".css", ".html", ".webmanifest"} or path.endswith("sw.js"): cc = CC_REVALIDATE
        elif ext in {".png", ".svg", ".jpg", ".jpeg", ".ico", ".webp"}: cc = "public, max-age=86400"
        elif ext == ".apk": cc = "public, max-age=3600"
        else: cc = CC_REVALIDATE
        s.send_bytes(200, body, ctype, cache_control=cc, etag=etag_for(body))
    def do_GET(s):
        if s.path.startswith("/allocine-all/"): return s.allo_all()
        if s.path in ("/health", "/status.json"): return s.send_json(200, json.dumps(status()).encode(), cache_control=CC_REVALIDATE)
        if s.path.startswith("/u/"):
            ps = re.sub(r"[^a-z0-9_.-]", "", s.path[3:].split("?")[0].replace(".json", "").lower())[:24]
            with DBL: e = (db_load().get("pub") or {}).get(ps)
            if not e: return s.send_json(404, b'{"error":"profil introuvable"}')
            return s.send_json(200, json.dumps({"pseudo": ps, **{k: e.get(k) for k in ("stats", "collections", "badges", "level", "xp", "at")}}, ensure_ascii=False).encode(), cache_control=CC_REVALIDATE)
        if s.path.startswith("/tmdb-ratings"): return s.send_json(200, json.dumps({"on": TMDB_ON, "min_votes": TMDB_MIN_VOTES, "pending": len(TMDBQ), "ratings": tmdb_public()}).encode(), cache_control=CC_API_SHORT)
        if s.path.startswith("/agenda"): return s.send_json(200, json.dumps(AGENDA, ensure_ascii=False).encode(), cache_control=CC_API_SHORT)
        if s.path.startswith("/allocine/"): return s.allocine()
        if s.path.startswith("/yt-trailer/"):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(s.path).query); r = yt_trailer(s.path.split("/")[2].split("?")[0], (qs.get("t") or [""])[0][:120], (qs.get("y") or [""])[0][:4])
            return s.send_json(200, json.dumps({k: r.get(k) for k in ("id", "title", "ch")}, ensure_ascii=False).encode(), cache_control=CC_API_SHORT)
        if s.path.startswith("/film-extra/"): return s.send_json(200, film_extra(s.path.split("/")[2]), cache_control="public, max-age=300")
        if s.path.startswith("/film/"):
            b = film_page(s.path.split("/")[2].split("?")[0]); return s.send_bytes(200, b, "text/html; charset=utf-8", cache_control=CC_REVALIDATE, etag=etag_for(b))
        if s.path == "/sitemap.xml":
            b = sitemap(); return s.send_bytes(200, b, "application/xml", cache_control="public, max-age=3600", etag=etag_for(b))
        if s.path.startswith("/letterboxd/"):
            try: r = letterboxd(s.path.split("/")[2].split("?")[0]); return s.send_json((503 if r.get("retry") else 404) if "error" in r else 200, json.dumps(r, ensure_ascii=False).encode(), cache_control=CC_REVALIDATE)
            except Exception as e:
                import traceback; traceback.print_exc(); return s.send_json(502, json.dumps({"error": "Letterboxd ne répond pas, réessayez."}).encode())
        if s.path.startswith("/api/transit"): return s.transit()
        if not s.path.startswith("/pathe/"): return s.serve_static()
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
        s.send_json(code, body, cache_control=CC_API_SHORT, etag=(code == 200))

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
            try: return c["id"], slim_public_films(tmdb_annotate(json.loads(allo_fetch(c["allocineId"], d))["films"]))
            except Exception: return c["id"], None
        q = urllib.parse.parse_qs(urllib.parse.urlparse(s.path).query)
        ids = set((q.get("ids") or [""])[0].split(",")) - {""}
        sel = [c for c in ALLO_CINES if c["id"] in ids][:80] if ids else [c for c in ALLO_CINES if c.get("type") in ("pathe", "partner")]
        import datetime as _dt
        lazy = (q.get("lazy") or ["0"])[0] in ("1", "true", "yes")
        today = _dt.date.today().isoformat()
        tomorrow = (_dt.date.today() + _dt.timedelta(days=1)).isoformat()
        urgent = d <= tomorrow
        if lazy and not urgent and not day_is_computed(d, sel):
            res = {}
            for c in sel:
                key = "allo:" + c["allocineId"] + d
                with LOCK: hit = CACHE.get(key)
                if not hit:
                    hit = allo_disk_get(key)
                    if hit:
                        with LOCK:
                            CACHE.setdefault(key, hit)
                            hit = CACHE.get(key)
                if hit:
                    try: res[c["id"]] = slim_public_films(tmdb_annotate(json.loads(hit[1])["films"]))
                    except Exception: res[c["id"]] = None
                else:
                    res[c["id"]] = None
            computed = False
        else:
            with ThreadPoolExecutor(4) as ex: res = dict(ex.map(one, sel))
            computed = day_is_computed(d, sel) or all(v is not None for v in res.values())
        s.send_json(200, json.dumps({"date": d, "cinemas": res, "computed": computed}, ensure_ascii=False).encode(), cache_control=CC_ALLO)

    def transit(s):
        return transit_get(s)

def allo_fetch(cid, date, force=False):
        parts = [None, cid, date]
        key = "allo:" + cid + date; now = time.time()
        with LOCK: hit = CACHE.get(key)
        if not hit:
            hit = allo_disk_get(key)
            if hit:
                with LOCK:
                    if key not in CACHE: CACHE[key] = hit
                    hit = CACHE[key]
        if force:
            try: return allo_live(cid, date, key)
            except Exception:
                if hit: return hit[1]
                raise
        if hit and now - hit[0] < TTL: return hit[1]
        if hit and now - hit[0] < 8 * 86400:  # stale-while-revalidate (inclut le dernier instantané sauvegardé)
            if key not in REFRESHING:
                REFRESHING.add(key)
                def bg():
                    BG.on = True
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
BG = threading.local(); WAITQ = [0]; WQL = threading.Lock()  # v19 : priorité aux requêtes des visiteurs sur le préchargement en arrière-plan
def allo_get(url):
    if time.time() < STAT["backoff_until"]: raise RuntimeError("Allociné ralentit : file d’attente, réessai sous peu")
    bg = getattr(BG, "on", False)
    if bg:
        while WAITQ[0] > 0: time.sleep(0.3)
    else:
        with WQL: WAITQ[0] += 1
    try: return _allo_get(url)
    finally:
        if not bg:
            with WQL: WAITQ[0] -= 1
def _allo_get(url):
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
            "allocine_ok": STAT["n_ok"], "allocine_errors": STAT["n_err"], "throttled": time.time() < STAT["backoff_until"], "agenda_at": AGENDA["at"], "backoff_s": STAT["backoff_s"], "snapshot": {k: STAT[k] for k in ("snap_loaded", "snap_push", "snap_err", "snap_bytes") if k in STAT}, "reports": len(REPORTS), "now": int(time.time()), "storage": {k: DURABLE.get(k) for k in ("backend", "last_push", "last_pull", "error")}, "mail": mail_provider() or "aucun", "tmdb": {**TSTAT, "cached": len(TMDB), "queue": len(TMDBQ)}, "allo": allo_status()}
def build_agenda():
    import datetime
    BG.on = True
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
            try: allo_disk_save(key, now, body)
            except Exception: pass
            if films: _snap_dirty.set()
            if films: tmdb_enqueue(films)
            return body

ALLO_CINES = [c for c in json.load(open(os.path.join(ROOT, "data", "cinemas.json"), encoding="utf-8")) if c.get("allocineId")]

# ---------- v32 : cache disque Allociné + préchauffage (survit à un redémarrage alwaysdata) ----------
# Un jour n’est « vide » que s’il a été calculé pour tous les cinémas et qu’aucune séance n’y figure.
# Un jour pas encore calculé (absence de cache, erreur, timeout) n’est pas compté comme vide.
ALLO_CACHE_DIR = os.environ.get("ALLO_CACHE", os.path.join(ROOT, "cache", "allocine"))
ALLO_WARM = {"on": False, "last": "", "started": 0, "pass_at": 0, "day": "", "done_days": 0, "total_days": 0, "empty_streak": 0, "eta_s": 0}
ALLO_WARM_MAX = 42
ALLO_WARM_REFRESH = 3 * 3600
ALLO_WARM_FORCE_DAYS = 7  # J à J+6 : la semaine à l’affiche, souvent complétée après un premier cache partiel
_ALLO_DISK_KEY = re.compile(r"^allo:[A-Za-z0-9]{5}\d{4}-\d{2}-\d{2}$")

def allo_cache_dir():
    return os.environ.get("ALLO_CACHE", ALLO_CACHE_DIR)

def _allo_disk_path(key):
    if not _ALLO_DISK_KEY.match(key or ""): return None
    return os.path.join(allo_cache_dir(), key.replace(":", "_") + ".json")

def allo_disk_save(key, ts, body):
    path = _allo_disk_path(key)
    if not path: return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = json.loads(body) if isinstance(body, (bytes, bytearray)) else json.loads(body)
    data = json.dumps({"at": ts, "payload": payload}, ensure_ascii=False, separators=(",", ":")).encode()
    tmp = path + ".tmp"
    with open(tmp, "wb") as f: f.write(data)
    os.replace(tmp, path)

def allo_disk_get(key):
    path = _allo_disk_path(key)
    if not path or not os.path.isfile(path): return None
    try:
        o = json.load(open(path, encoding="utf-8"))
        ts, payload = o.get("at"), o.get("payload")
        if not ts or not isinstance(payload, dict): return None
        return (float(ts), json.dumps(payload, ensure_ascii=False).encode())
    except Exception:
        return None

def allo_near_dates(today=None, n=None):
    """Dates J..J+6 (semaine à l’affiche) dont le programme peut encore être complété par Allociné."""
    import datetime
    n = ALLO_WARM_FORCE_DAYS if n is None else n
    today = today or datetime.date.today().isoformat()
    start = datetime.date.fromisoformat(today)
    return {(start + datetime.timedelta(days=i)).isoformat() for i in range(n)}

def allo_revalidate_ts(ts, date, now=None, today=None):
    """Pour les jours proches, on force la revalidation : un cache partiel ne doit pas passer pour frais."""
    now = time.time() if now is None else now
    try:
        if date in allo_near_dates(today):
            return min(float(ts), now - TTL - 1)
    except Exception:
        pass
    return ts

def allo_disk_boot():
    """Recharge le cache disque en mémoire au démarrage. N’invente aucune séance."""
    root = allo_cache_dir()
    n = 0
    allo_meta_load()
    if not os.path.isdir(root):
        return 0
    today = __import__("datetime").date.today().isoformat()
    now = time.time()
    for name in os.listdir(root):
        if not name.startswith("allo_") or not name.endswith(".json"): continue
        key = name[:-5].replace("_", ":", 1)
        if not _ALLO_DISK_KEY.match(key): continue
        if key[-10:] < today: continue
        hit = allo_disk_get(key)
        if not hit: continue
        ts, body = hit
        ts = allo_revalidate_ts(ts, key[-10:], now=now, today=today)
        with LOCK:
            if key not in CACHE: CACHE[key] = (ts, body); n += 1
    print("Cache disque Allociné rechargé :", n, "entrées", flush=True)
    return n

def _allo_meta_path():
    return os.path.join(allo_cache_dir(), "meta.json")

def allo_meta_load():
    try:
        o = json.load(open(_allo_meta_path(), encoding="utf-8"))
        last = o.get("last") or ""
        if last and re.fullmatch(r"\d{4}-\d{2}-\d{2}", last):
            if not ALLO_WARM["last"] or last > ALLO_WARM["last"]:
                ALLO_WARM["last"] = last
    except Exception:
        pass

def allo_meta_save():
    try:
        os.makedirs(allo_cache_dir(), exist_ok=True)
        path = _allo_meta_path()
        data = json.dumps({"last": ALLO_WARM.get("last") or "", "pass_at": ALLO_WARM.get("pass_at") or 0, "at": int(time.time())}, ensure_ascii=False)
        tmp = path + ".tmp"
        open(tmp, "w", encoding="utf-8").write(data)
        os.replace(tmp, path)
    except Exception:
        pass

def warm_cines():
    return [c for c in ALLO_CINES if c.get("type") in ("pathe", "partner") and c.get("allocineId")]

def day_is_computed(dd, cines=None):
    """Vrai seulement si chaque cinéma a une entrée de cache (éventuellement sans films)."""
    cines = cines if cines is not None else warm_cines()
    if not cines: return False
    with LOCK:
        for c in cines:
            if "allo:" + c["allocineId"] + dd not in CACHE:
                return False
    return True

def day_has_shows(dd, cines=None):
    cines = cines if cines is not None else warm_cines()
    with LOCK:
        for c in cines:
            hit = CACHE.get("allo:" + c["allocineId"] + dd)
            if hit and b'"films": []' not in hit[1] and b'"films":[]' not in hit[1]:
                try:
                    if json.loads(hit[1]).get("films"): return True
                except Exception:
                    continue
    return False

def day_confirmed_empty(dd, cines=None):
    """Un jour non calculé n’est jamais considéré comme vide."""
    cines = cines if cines is not None else warm_cines()
    return day_is_computed(dd, cines) and not day_has_shows(dd, cines)

def allo_status():
    return {"last": ALLO_WARM.get("last") or "", "warm": {k: ALLO_WARM.get(k) for k in ("on", "day", "done_days", "total_days", "pass_at", "empty_streak", "eta_s")}}

def warm_horizon(today=None, last=None, cap=None):
    """Nombre de jours J..J+N à préchauffer : au moins 28, jusqu’au dernier jour publié connu, plafonné."""
    import datetime
    cap = ALLO_WARM_MAX if cap is None else cap
    today = today or datetime.date.today().isoformat()
    last = last if last is not None else (ALLO_WARM.get("last") or "")
    n = 28
    if last and last >= today:
        try:
            t = datetime.date.fromisoformat(today)
            L = datetime.date.fromisoformat(last)
            n = max(n, (L - t).days + 1)
        except Exception:
            pass
    return max(1, min(cap, n))

def _warm_one(c, dd, force=False):
    try:
        allo_fetch(c["allocineId"], dd, force=force)
        return True
    except Exception:
        return False

def warm_pass(cines=None, today=None, fetch=None, now_ts=None, sleep=None):
    """Un passage de préchauffage. `fetch` est injectable pour les tests (pas d’appel réseau)."""
    import datetime
    cines = cines if cines is not None else warm_cines()
    today = today or datetime.date.today().isoformat()
    fetch = fetch or _warm_one
    now_ts = time.time() if now_ts is None else now_ts
    start = datetime.date.fromisoformat(today)
    empty = 0
    last_show = ALLO_WARM.get("last") or ""
    n = warm_horizon(today, last_show)
    ALLO_WARM["on"] = True
    ALLO_WARM["total_days"] = n
    ALLO_WARM["done_days"] = 0
    ALLO_WARM["empty_streak"] = 0
    computed_n = 0
    t0 = time.time()
    k = 0
    walked = 0
    while k < n and k < ALLO_WARM_MAX:
        dd = (start + datetime.timedelta(days=k)).isoformat()
        ALLO_WARM["day"] = dd
        for c in cines:
            # J..J+6 : toujours rafraîchir (le programme de la semaine peut être complété après un 1er cache partiel).
            if k >= ALLO_WARM_FORCE_DAYS:
                with LOCK: hit = CACHE.get("allo:" + c["allocineId"] + dd)
                if hit and now_ts - hit[0] < ALLO_WARM_REFRESH:
                    continue
            if sleep:
                while time.time() < STAT["backoff_until"]: sleep(15)
            if fetch is _warm_one:
                _warm_one(c, dd, force=(k < ALLO_WARM_FORCE_DAYS))
            else:
                fetch(c, dd)
        ALLO_WARM["done_days"] = k + 1
        walked = k + 1
        if not day_is_computed(dd, cines):
            n = min(ALLO_WARM_MAX, max(n, k + 4))
            ALLO_WARM["total_days"] = n
        elif day_has_shows(dd, cines):
            empty = 0
            if dd > last_show: last_show = dd
            n = max(n, warm_horizon(today, last_show))
            ALLO_WARM["total_days"] = n
        else:
            empty += 1
        ALLO_WARM["empty_streak"] = empty
        if day_is_computed(dd, cines): computed_n += 1
        elapsed = max(0.001, time.time() - t0)
        remain = max(0, n - (k + 1))
        ALLO_WARM["eta_s"] = int(remain * (elapsed / (k + 1)))
        if k >= 6 and empty >= 3:
            break
        k += 1
    if last_show:
        ALLO_WARM["last"] = last_show
        allo_meta_save()
    ALLO_WARM["pass_at"] = int(time.time())
    ALLO_WARM["day"] = ""
    return {"last": last_show, "days": walked, "empty_streak": empty, "computed": computed_n}


# ---------- Comptes & favoris (stockage JSON) ----------
import secrets, hmac
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
# ---------- v17/v22 : instantané des séances dans un 2e fichier du même Gist ----------
# Au démarrage, le dernier cache valide est rechargé et servi tout de suite (même si Allociné répond 429).
# v22 : format compact gzip+base64 (v:2), dédup sha256, intervalle min. 15 min, backoff exponentiel, plafond de taille.
SNAP_FILE = "cine-idf-showtimes.json"
SNAP_MIN_INTERVAL = 15 * 60
SNAP_MAX_BYTES = 1_500_000
SNAP_BACKOFF = (5 * 60, 15 * 60, 30 * 60, 60 * 60)
SNAP_STATE = {"hash": "", "push": 0, "err_n": 0, "backoff_until": 0}

def _film_meta(f):
    return {k: v for k, v in f.items() if k not in ("times", "rating", "press") and v not in (None, "", [], {})}

def snap_pack(cache, today=None):
    """Construit l'enveloppe v2 (films uniques + horaires par cinéma-jour, gzip+base64). Retourne (texte, sha256, taille)."""
    import datetime
    if today is None: today = datetime.date.today().isoformat()
    films, days = {}, {}
    for k, (ts, body) in cache.items():
        if not k.startswith("allo:") or len(k) < 10 or k[-10:] < today: continue
        try: fl = json.loads(body).get("films") or []
        except Exception: continue
        if not fl: continue
        entry = {}
        for f in fl:
            fid = str(f.get("id") or "") or ("t:" + (f.get("title") or ""))
            if fid not in films: films[fid] = _film_meta(f)
            entry[fid] = times_slim(f.get("times"))
        days[k] = [ts, entry]
    inner = json.dumps({"films": films, "days": days}, ensure_ascii=False, separators=(",", ":")).encode()
    env = {"v": 2, "gzip_b64": base64.b64encode(gzip.compress(inner, 6)).decode("ascii")}
    text = json.dumps(env, separators=(",", ":"))
    digest = hashlib.sha256(text.encode()).hexdigest()
    return text, digest, len(text)

def snap_unpack(text):
    """Lit un instantané v2 (gzip+base64) ou l'ancien format {clé: [ts, json]} — pour recharger un Gist existant."""
    data = json.loads(text) if isinstance(text, (str, bytes, bytearray)) else text
    if not data: return {}
    if isinstance(data, dict) and data.get("v") == 2 and data.get("gzip_b64"):
        inner = json.loads(gzip.decompress(base64.b64decode(data["gzip_b64"])))
        films = inner.get("films") or {}
        out = {}
        for k, pair in (inner.get("days") or {}).items():
            ts, entry = pair[0], pair[1] if len(pair) > 1 else {}
            fl = []
            for fid, times in (entry or {}).items():
                meta = dict(films.get(fid) or {})
                if "id" not in meta and not str(fid).startswith("t:"):
                    meta["id"] = int(fid) if str(fid).isdigit() else fid
                meta["times"] = times
                fl.append(meta)
            out[k] = (ts, json.dumps({"source": "allocine", "films": fl}, ensure_ascii=False).encode())
        return out
    out = {}
    for k, pair in data.items():
        if not isinstance(pair, (list, tuple)) or len(pair) < 2: continue
        ts, body = pair[0], pair[1]
        if isinstance(body, dict): body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str): body = body.encode()
        out[k] = (ts, body)
    return out

def gist_backoff_delay(err_n):
    return SNAP_BACKOFF[min(max(0, err_n), len(SNAP_BACKOFF) - 1)]

def _snap_backoff():
    delay = gist_backoff_delay(SNAP_STATE["err_n"])
    SNAP_STATE["err_n"] += 1
    SNAP_STATE["backoff_until"] = time.time() + delay
    return delay

def snap_pull():
    if DURABLE["backend"] != "gist": return
    try:
        import datetime
        f = _gh("GET")["files"].get(SNAP_FILE) or {}
        txt = f.get("content") or ""
        if f.get("truncated") and f.get("raw_url"): txt = urllib.request.urlopen(urllib.request.Request(f["raw_url"], headers={"Authorization": "Bearer " + GIST_TOKEN, "User-Agent": "cine-idf"}), timeout=60).read().decode()
        packed = snap_unpack(txt) if txt.strip() else {}
        today = datetime.date.today().isoformat(); n = 0
        with LOCK:
            for k, (ts, body) in packed.items():
                if k[-10:] >= today and k not in CACHE:
                    CACHE[k] = (allo_revalidate_ts(ts, k[-10:], today=today), body); n += 1
        try:
            _, digest, size = snap_pack(packed, today)
            SNAP_STATE["hash"] = digest; STAT["snap_bytes"] = size
        except Exception: pass
        STAT["snap_loaded"] = n; print("Instantané séances rechargé :", n, flush=True)
    except Exception as e: STAT["snap_err"] = "pull: " + str(e)[:120]; print("Snapshot pull KO", e, flush=True)
def _snap_loop():
    import datetime
    while True:
        _snap_dirty.wait()
        while True:
            now = time.time(); wait = 0
            if SNAP_STATE["backoff_until"] > now: wait = SNAP_STATE["backoff_until"] - now
            elif SNAP_STATE["push"] and now - SNAP_STATE["push"] < SNAP_MIN_INTERVAL:
                wait = SNAP_MIN_INTERVAL - (now - SNAP_STATE["push"])
            elif not SNAP_STATE["push"]:
                wait = min(180, SNAP_MIN_INTERVAL)  # 1er envoi : 3 min, ensuite 15 min
                if now - START < wait: wait = wait - (now - START)
                else: wait = 0
            if wait <= 0: break
            time.sleep(min(wait, 30))
        _snap_dirty.clear()
        try:
            today = datetime.date.today().isoformat()
            with LOCK: data = {k: v for k, v in CACHE.items() if k.startswith("allo:") and k[-10:] >= today and b'"films": []' not in v[1]}
            if not data: continue
            text, digest, size = snap_pack(data, today)
            STAT["snap_bytes"] = size
            if digest == SNAP_STATE["hash"]:
                continue
            if size > SNAP_MAX_BYTES:
                STAT["snap_err"] = "snapshot trop volumineux (%d octets), envoi annulé" % size
                print("Snapshot trop gros, envoi annulé :", size, flush=True)
                _snap_backoff(); continue
            _gh("PATCH", {"files": {SNAP_FILE: {"content": text}}})
            SNAP_STATE["hash"] = digest; SNAP_STATE["push"] = int(time.time()); SNAP_STATE["err_n"] = 0; SNAP_STATE["backoff_until"] = 0
            STAT["snap_push"] = SNAP_STATE["push"]; STAT["snap_err"] = ""
            print("Instantané séances envoyé :", size, "octets", flush=True)
        except Exception as e:
            STAT["snap_err"] = "push: " + str(e)[:120]; d = _snap_backoff()
            print("Snapshot push KO", e, "backoff", int(d), "s", flush=True)
            _snap_dirty.set()
if DURABLE["backend"] == "gist":
    threading.Thread(target=snap_pull, daemon=True).start(); threading.Thread(target=_snap_loop, daemon=True).start()
# ---------- v21 : note moyenne TMDB (API officielle themoviedb.org) à la place des notes Allociné ----------
# Clé : TMDB_READ_TOKEN (jeton v4 « API Read Access Token », en-tête Bearer) ou TMDB_API_KEY (clé v3).
# Sans clé : l'appli fonctionne, les notes sont simplement masquées. Correspondance par titre original + année
# (repli titre français), résultat mis en cache en mémoire et dans le Gist (cine-idf-tmdb.json).
TMDB_TOKEN = os.environ.get("TMDB_READ_TOKEN", "").strip(); TMDB_KEY = os.environ.get("TMDB_API_KEY", "").strip()
TMDB_ON = bool(TMDB_TOKEN or TMDB_KEY); TMDB_FILE = "cine-idf-tmdb.json"; TMDB_MIN_VOTES = 10
TMDB = {}; TMDBL = threading.Lock(); TMDBQ = {}; _tmdb_wake = threading.Event(); _tmdb_dirty = threading.Event()
TSTAT = {"on": TMDB_ON, "ok": 0, "err": 0, "last_err": "", "matched": 0, "nomatch": 0, "loaded": 0, "push": 0}
TMDB_GIST_STATE = {"hash": "", "err_n": 0, "backoff_until": 0}
if not TMDB_ON: print("ATTENTION : ni TMDB_READ_TOKEN ni TMDB_API_KEY défini – notes TMDB désactivées (masquées dans l'appli).", flush=True)
def _tnorm(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()
def tmdb_http(path, params):  # remplacé dans les tests unitaires
    p = dict(params)
    if not TMDB_TOKEN: p["api_key"] = TMDB_KEY
    h = {"Accept": "application/json", "User-Agent": "cine-idf"}
    if TMDB_TOKEN: h["Authorization"] = "Bearer " + TMDB_TOKEN
    url = "https://api.themoviedb.org/3" + path + "?" + urllib.parse.urlencode(p)
    for i in range(4):
        try: return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=15).read())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(int(e.headers.get("Retry-After") or 0) or 2 * (i + 1)); continue
            raise
    raise RuntimeError("TMDB 429 persistant")
def _year(r):
    d = r.get("release_date") or ""; return int(d[:4]) if d[:4].isdigit() else None
def tmdb_pick(results, titles, year):
    # Jamais de note « devinée » : titre identique exigé, et année à ±1 an si connue (sinon un seul candidat au titre exact).
    tn = {_tnorm(t) for t in titles if t}
    exact = [r for r in results or [] if _tnorm(r.get("title")) in tn or _tnorm(r.get("original_title")) in tn]
    if year:
        ok = [r for r in exact if _year(r) and abs(_year(r) - int(year)) <= 1]
        ok.sort(key=lambda r: (abs(_year(r) - int(year)), -(r.get("vote_count") or 0)))
        return ok[0] if ok else None
    return exact[0] if len(exact) == 1 else None
def tmdb_match(title, otitle, year):
    titles = [t for t in (otitle, title) if t]
    tries = []
    for t in dict.fromkeys(titles):
        if year: tries += [(t, {"year": year}), (t, {"primary_release_year": int(year) + 1}), (t, {"primary_release_year": int(year) - 1})]
        else: tries.append((t, {}))
    for q, extra in tries:
        d = tmdb_http("/search/movie", {"query": q, "language": "fr-FR", "include_adult": "false", **extra})
        r = tmdb_pick(d.get("results"), titles, year)
        if r: return r
        time.sleep(0.25)
    return None
def tmdb_enqueue(films):
    if not TMDB_ON: return
    now = time.time(); n = 0
    with TMDBL:
        for f in films or []:
            fid = str(f.get("id") or "")
            if not fid or fid in TMDBQ: continue
            e = TMDB.get(fid)
            if e and now - e.get("at", 0) < (3 * 86400 if e.get("tid") else 86400): continue
            TMDBQ[fid] = (f.get("title"), f.get("originalTitle"), f.get("year")); n += 1
    if n: _tmdb_wake.set()
def tmdb_lookup_one(fid, title, otitle, year):
    try:
        r = tmdb_match(title, otitle, year); TSTAT["ok"] += 1
        e = {"at": int(time.time())}
        if r: e.update({"tid": r.get("id"), "r": round(float(r.get("vote_average") or 0), 1), "v": int(r.get("vote_count") or 0)}); TSTAT["matched"] += 1
        else: TSTAT["nomatch"] += 1
        with TMDBL: TMDB[fid] = e
        _tmdb_dirty.set(); return e
    except Exception as ex:
        TSTAT["err"] += 1; TSTAT["last_err"] = str(ex)[:120]; return None
def _tmdb_loop():
    while True:
        _tmdb_wake.wait(); _tmdb_wake.clear()
        while True:
            with TMDBL:
                if not TMDBQ: break
                fid, args = next(iter(TMDBQ.items()))
            tmdb_lookup_one(fid, *args)
            with TMDBL: TMDBQ.pop(fid, None)
            time.sleep(0.3)  # ≈3 requêtes/s max, très en dessous de la limite TMDB (~40/s)
def tmdb_public():
    # {idAllociné: [moyenne, nb de votes]} – seulement les correspondances avec ≥ 10 votes
    with TMDBL: return {k: [e["r"], e["v"], e["tid"]] for k, e in TMDB.items() if e.get("tid") and (e.get("v") or 0) >= TMDB_MIN_VOTES}
def tmdb_annotate(films):
    if not TMDB_ON or not films: return films
    tmdb_enqueue(films)
    with TMDBL:
        for f in films:
            e = TMDB.get(str(f.get("id") or ""))
            if e and e.get("tid") and (e.get("v") or 0) >= TMDB_MIN_VOTES: f["tmdbRating"], f["tmdbVotes"] = e["r"], e["v"]
    return films
def _tmdb_gist():
    try:
        f = _gh("GET")["files"].get(TMDB_FILE) or {}; txt = f.get("content") or ""
        if f.get("truncated") and f.get("raw_url"): txt = urllib.request.urlopen(urllib.request.Request(f["raw_url"], headers={"Authorization": "Bearer " + GIST_TOKEN, "User-Agent": "cine-idf"}), timeout=60).read().decode()
        data = json.loads(txt) if txt.strip() else {}
        with TMDBL:
            for k, v in data.items(): TMDB.setdefault(k, v)
        TSTAT["loaded"] = len(data)
        TMDB_GIST_STATE["hash"] = hashlib.sha256(json.dumps(data, separators=(",", ":")).encode()).hexdigest()
    except Exception as e: TSTAT["last_err"] = "gist pull: " + str(e)[:100]
    while True:
        _tmdb_dirty.wait()
        while TMDB_GIST_STATE["backoff_until"] > time.time():
            time.sleep(min(30, TMDB_GIST_STATE["backoff_until"] - time.time()))
        time.sleep(600); _tmdb_dirty.clear()
        try:
            with TMDBL: body = json.dumps(TMDB, separators=(",", ":"))
            digest = hashlib.sha256(body.encode()).hexdigest()
            if digest == TMDB_GIST_STATE["hash"]: continue
            _gh("PATCH", {"files": {TMDB_FILE: {"content": body}}})
            TMDB_GIST_STATE["hash"] = digest; TMDB_GIST_STATE["err_n"] = 0; TMDB_GIST_STATE["backoff_until"] = 0
            TSTAT["push"] = int(time.time())
        except Exception as e:
            TSTAT["last_err"] = "gist push: " + str(e)[:100]
            d = gist_backoff_delay(TMDB_GIST_STATE["err_n"]); TMDB_GIST_STATE["err_n"] += 1
            TMDB_GIST_STATE["backoff_until"] = time.time() + d
            print("TMDB gist push KO", e, "backoff", int(d), "s", flush=True)
            _tmdb_dirty.set()
if TMDB_ON:
    threading.Thread(target=_tmdb_loop, daemon=True).start()
    if DURABLE["backend"] == "gist": threading.Thread(target=_tmdb_gist, daemon=True).start()
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

# ---------- v20 : « Mot de passe oublié » (lien à usage unique envoyé par e-mail) ----------
# Seul le SHA-256 du jeton est stocké, dans la fiche du compte (donc copié dans le Gist et conservé après redémarrage),
# avec une expiration de 30 min. Réponse toujours identique (pas de révélation des comptes existants), limites par IP et par e-mail.
# Envoi : BREVO_API_KEY, RESEND_API_KEY (API HTTPS, compatibles Render gratuit) ou SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS ; expéditeur MAIL_FROM.
import smtplib, ssl
from email.message import EmailMessage
from email.utils import parseaddr, formataddr
APP_URL = (os.environ.get("APP_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "https://patheco.alwaysdata.net").rstrip("/")
RESET_TTL = 30 * 60
RL, RLL = {}, threading.Lock()
def rate_ok(key, limit, window):
    now = time.time()
    with RLL:
        q = [t for t in RL.get(key, []) if now - t < window]
        if len(q) >= limit: RL[key] = q; return False
        q.append(now); RL[key] = q
        if len(RL) > 5000:
            for k in [k for k, v in RL.items() if not v or now - v[-1] > 7200]: RL.pop(k, None)
        return True
def client_ip(h):
    return ((h.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or h.client_address[0])[:64]
def mask_email(e):
    a, _, b = e.partition("@"); return (a[:2] + "•••" if len(a) > 2 else a[:1] + "•••") + "@" + b
def mail_provider():
    if os.environ.get("BREVO_API_KEY"): return "brevo"
    if os.environ.get("RESEND_API_KEY"): return "resend"
    if os.environ.get("SMTP_HOST"): return "smtp"
    return ""
def send_mail(to, subject, text, html_body):
    p = mail_provider(); frm = os.environ.get("MAIL_FROM") or os.environ.get("SMTP_USER") or ""
    name, addr = parseaddr(frm); name = name or "Pathé & co"
    if not p: print("⚠️  Mot de passe oublié : aucun service d'e-mail configuré (BREVO_API_KEY, RESEND_API_KEY ou SMTP_HOST + MAIL_FROM) — e-mail NON envoyé à", mask_email(to), flush=True); return False
    if not addr: print("⚠️  Mot de passe oublié : MAIL_FROM manquant — e-mail NON envoyé à", mask_email(to), flush=True); return False
    try:
        if p == "brevo":
            r = urllib.request.Request("https://api.brevo.com/v3/smtp/email", method="POST", headers={"api-key": os.environ["BREVO_API_KEY"], "Content-Type": "application/json", "Accept": "application/json"},
                data=json.dumps({"sender": {"name": name, "email": addr}, "to": [{"email": to}], "subject": subject, "textContent": text, "htmlContent": html_body}).encode())
            urllib.request.urlopen(r, timeout=20).read()
        elif p == "resend":
            r = urllib.request.Request("https://api.resend.com/emails", method="POST", headers={"Authorization": "Bearer " + os.environ["RESEND_API_KEY"], "Content-Type": "application/json", "User-Agent": "cine-idf"},
                data=json.dumps({"from": formataddr((name, addr)), "to": [to], "subject": subject, "text": text, "html": html_body}).encode())
            urllib.request.urlopen(r, timeout=20).read()
        else:
            m = EmailMessage(); m["From"] = formataddr((name, addr)); m["To"] = to; m["Subject"] = subject
            m.set_content(text); m.add_alternative(html_body, subtype="html")
            host, port = os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT") or 587); user, pw = os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASS", "")
            if port == 465: s = smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context())
            else:
                s = smtplib.SMTP(host, port, timeout=20)
                if os.environ.get("SMTP_TLS", "1") != "0": s.starttls(context=ssl.create_default_context())
            with s:
                if user: s.login(user, pw)
                s.send_message(m)
        print("Mot de passe oublié : e-mail envoyé (" + p + ") à", mask_email(to), flush=True); return True
    except urllib.error.HTTPError as e:
        print("⚠️  Mot de passe oublié : échec d'envoi (" + p + ")", e.code, e.read()[:300].decode("utf-8", "ignore"), flush=True)
    except Exception as e: print("⚠️  Mot de passe oublié : échec d'envoi (" + p + ")", type(e).__name__, str(e)[:200], flush=True)
    return False
def reset_mail(to, tok):
    link = APP_URL + "/?reset=" + tok
    text = ("Bonjour,\n\nUne demande de réinitialisation du mot de passe de votre compte Pathé & co (" + to + ") a été faite.\n\n"
            "Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, une seule fois) :\n" + link + "\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.\n\n— Pathé & co")
    hb = ('<div style="background:#0b0b0b;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#eee">'
          '<div style="max-width:460px;margin:0 auto;background:#151515;border:1px solid #3a2f12;border-radius:16px;padding:26px">'
          '<div style="color:#d4af37;font-size:22px;font-weight:700;margin-bottom:6px">Pathé &amp; co</div>'
          '<p style="font-size:16px;line-height:1.5">Une demande de réinitialisation du mot de passe a été faite pour <b>' + html.escape(to) + '</b>.</p>'
          '<p style="text-align:center;margin:26px 0"><a href="' + html.escape(link) + '" style="background:#d4af37;color:#111;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;display:inline-block">Choisir un nouveau mot de passe</a></p>'
          '<p style="font-size:13px;color:#aaa;line-height:1.5">Lien valable 30 minutes, utilisable une seule fois. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.</p>'
          '<p style="font-size:12px;color:#777;word-break:break-all">' + html.escape(link) + '</p></div></div>')
    return send_mail(to, "Pathé & co – réinitialiser votre mot de passe", text, hb)
def find_reset(d, tok):
    hh = hashlib.sha256(tok.encode()).hexdigest(); now = time.time()
    for em, u in d["users"].items():
        r = u.get("reset")
        if isinstance(r, dict) and hmac.compare_digest(str(r.get("h", "")), hh):
            return (em, u) if r.get("exp", 0) > now else (None, None)
    return None, None
GENERIC_FORGOT = "Si un compte existe pour cette adresse, un e-mail avec un lien de réinitialisation vient d’être envoyé. Pensez à regarder dans les indésirables. Le lien est valable 30 minutes."

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
    if path == "/api/forgot":
        email = str(body.get("email", "")).strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 120: return out(400, {"error": "Adresse e-mail invalide."})
        if not rate_ok("fip:" + client_ip(h), 5, 900): return out(429, {"error": "Trop de demandes depuis cet appareil. Réessayez dans 15 minutes."})
        tok = None
        if rate_ok("fem:" + email, 3, 3600):  # au-delà : on n'envoie plus, mais la réponse reste identique
            with DBL:
                d = db_load(); u = d["users"].get(email)
                if u:
                    tok = secrets.token_urlsafe(32)
                    u["reset"] = {"h": hashlib.sha256(tok.encode()).hexdigest(), "exp": int(time.time()) + RESET_TTL}; db_save(d)
        if tok: threading.Thread(target=reset_mail, args=(email, tok), daemon=True).start()
        return out(200, {"ok": True, "message": GENERIC_FORGOT})
    if path in ("/api/reset/check", "/api/reset"):
        if not rate_ok("rip:" + client_ip(h), 20, 900): return out(429, {"error": "Trop de tentatives. Réessayez dans 15 minutes."})
        tok = str(body.get("token", ""))[:200]; pw = str(body.get("password", ""))
        bad = {"error": "Ce lien n’est plus valable (expiré ou déjà utilisé). Refaites une demande avec « Mot de passe oublié ? ».", "code": "bad_reset"}
        if not re.fullmatch(r"[A-Za-z0-9_-]{30,100}", tok): return out(400, bad)
        with DBL:
            d = db_load(); email, u = find_reset(d, tok)
            if not u: return out(400, bad)
            if path == "/api/reset/check": return out(200, {"ok": True, "email": mask_email(email)})
            if len(pw) < 6: return out(400, {"error": "Mot de passe : 6 caractères minimum."})
            salt = secrets.token_hex(16); u["salt"] = salt; u["hash"] = pw_hash(pw, salt); u.pop("reset", None); u["pw_changed"] = int(time.time())
            for k in [k for k, v in d["tokens"].items() if v == email]: d["tokens"].pop(k, None)  # déconnecte toutes les anciennes sessions
            nt = secrets.token_urlsafe(32); d["tokens"][nt] = email; db_save(d)
            print("Mot de passe réinitialisé pour", mask_email(email), flush=True)
            return out(200, {"token": nt, **prof(email, u)})
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
    title = f"{e(f['title'])} – séances en Île-de-France | Pathé &amp; co"; desc = e((f.get("synopsis") or "")[:200]) or f"Toutes les séances de {e(f['title'])} à Paris et en Île-de-France."
    page = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", page, flags=re.S)
    page = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', page)
    page = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{title}">', page)
    page = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{desc}">', page)
    page = re.sub(r'<meta property="og:image" content="[^"]*">', f'<meta property="og:image" content="{e(f.get("poster"))}">', page)
    page = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{APP_URL}/film/{e(f["id"])}">', page)
    ld = {"@context": "https://schema.org", "@type": "Movie", "name": f["title"], "image": f.get("poster"), "description": f.get("synopsis"), "director": f.get("directors"), "genre": f.get("genres"), "actor": [{"@type": "Person", "name": a} for a in f.get("cast") or []]}
    page = page.replace("</head>", f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")}</script>\n</head>', 1)
    return page.encode()
def sitemap():
    urls = [APP_URL + "/"] + [APP_URL + "/" + p for p in ("comment-ca-marche.html", "confidentialite.html", "statut.html")] + [f"{APP_URL}/film/{i}" for i in list(films_in_cache())[:500]]
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
class TS6(TS):
    address_family = socket.AF_INET6
if __name__ == "__main__":
    HOST = (os.environ.get("HOST") or os.environ.get("IP") or "0.0.0.0").strip()
    if HOST.startswith("[") and HOST.endswith("]"):
        HOST = HOST[1:-1]
    try:
        k = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); k.connect(("8.8.8.8", 80)); ip = k.getsockname()[0]; k.close()
    except Exception: ip = "IP-de-cet-ordinateur"
    print(f"Pathé & co → sur cet ordinateur : http://localhost:{PORT}", flush=True)
    print(f"           sur votre téléphone (même Wi-Fi) : http://{ip}:{PORT}", flush=True)
    print("Ctrl+C pour arrêter", flush=True)
    def warm():
        # v32 : un seul worker, même intervalle ALLO_GAP, cache disque, un jour non calculé n’est pas « vide ».
        BG.on = True
        ALLO_WARM["started"] = int(time.time())
        while True:
            try:
                warm_pass(sleep=time.sleep)
            except Exception as e:
                print("warm", e, flush=True)
            time.sleep(900)
    allo_disk_boot()
    threading.Thread(target=warm, daemon=True).start()
    threading.Thread(target=build_agenda, daemon=True).start()
    def keepalive():  # évite la mise en veille Render (plan gratuit : 750 h/mois suffisent pour 1 service)
        u = os.environ.get("RENDER_EXTERNAL_URL")
        while u:
            time.sleep(600)
            try: urllib.request.urlopen(u + "/health", timeout=30).read()
            except Exception: pass
    threading.Thread(target=keepalive, daemon=True).start()
    Server = TS6 if ":" in HOST else TS
    Server((HOST, PORT), H).serve_forever()
