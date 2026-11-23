"""Tests v22 : gzip, ETag/304, instantané Gist compressé, chemins internes, sans appel réseau réel."""
import os, sys, json, gzip, time, threading, io, pathlib, hashlib
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for k in ("GIST_TOKEN", "GIST_ID"): os.environ.pop(k, None)
import server as S
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import socketserver

FILM = {
    "id": 900001, "title": "Film de test", "originalTitle": "Test Film",
    "poster": "https://example.test/poster.jpg", "runtime": "2h 00min",
    "genres": ["Drame"], "directors": "A. Test",
    "times": [{"preview": False, "events": [], "fmt": ["IMAX"], "acc": False,
               "time": "2026-11-13T20:15:00", "version": "vf", "url": "https://example.test/seance"}],
    "releases": [{"name": "Released", "date": "2026-11-05"}],
    "year": 2026, "isPremiere": False, "weeklyOuting": True,
    "rating": 3.8, "press": 3.1,
    "cast": ["Acteur Test"], "age": "Tous publics",
    "synopsis": "Synopsis de test conservé dans la fiche.",
}

def _cache_for(n_cines=20, n_days=10, n_films=8):
    import datetime
    today = datetime.date(2026, 11, 13)
    out = {}
    for d in range(n_days):
        dd = (today + datetime.timedelta(days=d)).isoformat()
        for i in range(n_cines):
            films = []
            for j in range(n_films):
                f = dict(FILM, id=900000 + j, title="Film de test %d" % j, synopsis=FILM["synopsis"] + " " + str(j))
                f["times"] = [dict(FILM["times"][0], time="%sT%02d:15:00" % (dd, 14 + j % 8), url="https://example.test/s%d-%d" % (i, j))]
                films.append(f)
            body = json.dumps({"source": "allocine", "films": films}, ensure_ascii=False).encode()
            out["allo:C%04d%s" % (i, dd)] = (time.time(), body)
    return out, today.isoformat()

def test_slim_drops_unused_allocine_ratings_keeps_synopsis():
    out = S.slim_public_films([FILM])
    assert "rating" not in out[0] and "press" not in out[0]
    assert out[0]["synopsis"] == FILM["synopsis"]
    assert out[0]["times"][0]["fmt"] == ["IMAX"] and "preview" not in out[0]["times"][0]

def test_snap_pack_unpack_roundtrip_and_legacy():
    cache, today = _cache_for()
    text, digest, size = S.snap_pack(cache, today)
    env = json.loads(text)
    assert env["v"] == 2 and env["gzip_b64"] and size < 80_000
    text2, digest2, size2 = S.snap_pack(cache, today)
    assert digest == digest2 and size == size2
    packed = S.snap_unpack(text)
    assert len(packed) == len(cache)
    key = next(iter(cache))
    films = json.loads(packed[key][1])["films"]
    assert films and films[0]["title"].startswith("Film de test")
    assert "synopsis" in films[0] and films[0]["times"]
    # legacy v1
    legacy = {k: [ts, body.decode()] for k, (ts, body) in list(cache.items())[:3]}
    old = S.snap_unpack(json.dumps(legacy))
    assert len(old) == 3 and all(isinstance(v[1], (bytes, bytearray)) for v in old.values())

def test_snap_hash_changes_when_content_changes():
    cache, today = _cache_for(n_cines=3, n_days=2, n_films=2)
    _, a, _ = S.snap_pack(cache, today)
    k = next(iter(cache))
    data = json.loads(cache[k][1])
    data["films"][0]["times"][0]["time"] = "2026-11-13T23:59:00"
    cache[k] = (cache[k][0], json.dumps(data, ensure_ascii=False).encode())
    _, b, _ = S.snap_pack(cache, today)
    assert a != b

def test_gist_backoff_schedule():
    assert S.gist_backoff_delay(0) == 5 * 60
    assert S.gist_backoff_delay(1) == 15 * 60
    assert S.gist_backoff_delay(2) == 30 * 60
    assert S.gist_backoff_delay(3) == 60 * 60
    assert S.gist_backoff_delay(9) == 60 * 60

def test_snap_under_size_cap():
    cache, today = _cache_for(n_cines=69, n_days=21, n_films=25)
    raw = sum(len(v[1]) for v in cache.values())
    text, digest, size = S.snap_pack(cache, today)
    assert size < S.SNAP_MAX_BYTES
    assert size < 400_000, size
    assert raw > 1_000_000
    # inchangé → même hash
    _, d2, s2 = S.snap_pack(cache, today)
    assert d2 == digest and s2 == size

def _httpd():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), S.H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]

def _get(port, path, headers=None, method="GET"):
    req = Request("http://127.0.0.1:%d%s" % (port, path), method=method, headers=headers or {})
    try:
        with urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except HTTPError as e:
        return e.code, dict(e.headers), e.read()

def test_http_gzip_etag_304_static_and_guards():
    httpd, port = _httpd()
    try:
        st, h, raw = _get(port, "/app.js", {"Accept-Encoding": "identity"})
        assert st == 200 and "etag" in {k.lower() for k in h}
        assert "gzip" not in (h.get("Content-Encoding") or h.get("content-encoding") or "")
        et = h.get("ETag") or h.get("etag")
        assert h.get("Cache-Control") or h.get("cache-control")
        st2, h2, gz = _get(port, "/app.js", {"Accept-Encoding": "gzip"})
        assert st2 == 200 and (h2.get("Content-Encoding") or h2.get("content-encoding")) == "gzip"
        assert (h2.get("ETag") or h2.get("etag")) == et
        assert len(gz) < len(raw)
        assert gzip.decompress(gz) == raw
        st3, h3, body3 = _get(port, "/app.js", {"Accept-Encoding": "gzip", "If-None-Match": et})
        assert st3 == 304 and len(body3) == 0
        # cinemas.js : gros gain gzip
        _, _, craw = _get(port, "/data/cinemas.js", {"Accept-Encoding": "identity"})
        _, _, cgz = _get(port, "/data/cinemas.js", {"Accept-Encoding": "gzip"})
        assert len(cgz) < len(craw) * 0.3
        st, h, b = _get(port, "/")
        assert st == 200 and b"<title>" in b and (h.get("Content-Type") or h.get("content-type") or "").startswith("text/html")
        st, h, b = _get(port, "/health")
        assert st == 200 and json.loads(b).get("ok") is True
        for path in ("/tests/", "/android/", "/mobile/", "/old/", "/cine-idf.apk", "/server.py", "/data/"):
            st, _, _ = _get(port, path)
            assert st == 404, path
        st, h, b = _get(port, "/download/cine-idf.apk")
        assert st == 200 and len(b) > 1000
        assert "vnd.android" in (h.get("Content-Type") or h.get("content-type") or "")
    finally:
        httpd.shutdown()

def test_http_allocine_all_gzip_etag_and_slim(monkeypatch=None):
    def fake_fetch(cid, date):
        return json.dumps({"source": "allocine", "films": [FILM]}, ensure_ascii=False).encode()
    S.allo_fetch = fake_fetch
    httpd, port = _httpd()
    try:
        st, h, raw = _get(port, "/allocine-all/2026-11-13", {"Accept-Encoding": "identity"})
        assert st == 200
        cc = h.get("Cache-Control") or h.get("cache-control") or ""
        assert "max-age=120" in cc and "stale-while-revalidate" in cc
        data = json.loads(raw)
        films = next(iter(data["cinemas"].values()))
        assert films[0]["synopsis"] and "rating" not in films[0] and "press" not in films[0]
        et = h.get("ETag") or h.get("etag")
        st2, h2, gz = _get(port, "/allocine-all/2026-11-13", {"Accept-Encoding": "gzip"})
        assert (h2.get("Content-Encoding") or h2.get("content-encoding")) == "gzip"
        assert len(gz) < len(raw) and gzip.decompress(gz) == raw
        st3, _, body = _get(port, "/allocine-all/2026-11-13", {"If-None-Match": et, "Accept-Encoding": "gzip"})
        assert st3 == 304 and len(body) == 0
        # mesures affichées (rapport)
        print("MEASURE /allocine-all identity %d bytes, gzip %d bytes (%.1f%%)" % (len(raw), len(gz), 100 * len(gz) / len(raw)))
    finally:
        httpd.shutdown()

def test_frontend_and_sw_markers():
    root = pathlib.Path(__file__).resolve().parents[1]
    sw = (root / "sw.js").read_text()
    assert 'cine-idf-v27' in sw and "If-None-Match" in sw and "addAll" in sw
    assert "/slot.js" in sw and "/v26.js" in sw
    assert "/sw.js" in sw  # excluded from intercept
    app = (root / "app.js").read_text()
    assert "fetchDayShows" in app and "MEM_DAY_CACHE" in app
    assert 'fetch("/allocine-all/"' in app  # used inside fetchDayShows
    assert "SELDATES.map(d => fetchDayShows" in app
    v12 = (root / "v12.js").read_text()
    assert "loadWeek(true)" in v12 and "fetchDayShows" in v12
    v13 = (root / "v13.js").read_text()
    assert 'loadCatalog("auto")' in v13 and "fetchDayShows" in v13
    plus = (root / "plus.js").read_text()
    assert "fetchDayShows" in plus
    # le bouton APK de l'app pointe toujours vers /download/
    assert "/download/cine-idf.apk" in app
    itin = (root / "itineraire.js").read_text()
    index = (root / "index.html").read_text()
    assert "/itineraire.js" in sw and "/itineraire.js" in index
    assert "openRoute" in app and "openRoute" in itin
    assert "routing.openstreetmap.de/routed-foot" in itin and "routing.openstreetmap.de/routed-bike" in itin
    assert "/api/transit" in itin
    assert "maps.google" not in itin and "google.com/maps" not in itin
    assert "maps.apple.com" not in itin and "citymapper.com" not in itin
    assert "Itinéraires en transports indisponibles pour le moment" in itin

if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("OK", n)
