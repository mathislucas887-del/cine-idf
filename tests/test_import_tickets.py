"""Tests v34 : POST /api/import-tickets (jeton partagé, dédup par réf, mapping cinéma)."""
import json, os, sys, tempfile, threading, socketserver, secrets
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for k in ("GIST_TOKEN", "GIST_ID"):
    os.environ.pop(k, None)
import server as S
from urllib.request import Request, urlopen
from urllib.error import HTTPError

TOKEN = "test-import-token-v34-not-for-prod"
EMAIL = "mathis@example.com"
AUTH = {"Authorization": "Bearer " + TOKEN}

TICKET = {
    "film": "Paper Tiger",
    "cinema": "Pathé Wepler - Côté place",
    "date": "2026-11-25",
    "heure": "17:25",
    "version": "VOST",
    "salle": "1",
    "sieges": "I5, I7",
    "places": "2",
    "ref": "WTZ3BT3",
}

def _httpd():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), S.H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]

def _post(port, path, body, headers=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode(), method="POST", headers=h)
    try:
        with urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode())
    except HTTPError as e:
        return e.code, json.loads(e.read().decode())

def _cfg(monkeypatch, users=None):
    tmp = tempfile.NamedTemporaryFile(prefix="cine-users-", suffix=".json", delete=False)
    data = {"users": users if users is not None else {EMAIL: {"salt": "ab" * 16, "hash": "cd" * 32, "favs": [], "tickets": [], "created": 1}}, "tokens": {}}
    tmp.write(json.dumps(data).encode())
    tmp.close()
    monkeypatch.setattr(S, "DB_PATH", tmp.name)
    monkeypatch.setenv("TICKETS_IMPORT_TOKEN", TOKEN)
    monkeypatch.setenv("TICKETS_IMPORT_EMAIL", EMAIL)
    return tmp.name

def test_import_rejects_missing_or_bad_token(monkeypatch):
    _cfg(monkeypatch)
    httpd, port = _httpd()
    try:
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]})
        assert st == 401, (st, body)
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]}, {"Authorization": "Bearer wrong-token"})
        assert st == 401, (st, body)
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]}, {"Authorization": "Bearer " + secrets.token_urlsafe(32)})
        assert st == 401
    finally:
        httpd.shutdown()

def test_import_token_ok_is_constant_time_and_rejects_empty(monkeypatch):
    monkeypatch.setenv("TICKETS_IMPORT_TOKEN", TOKEN)
    assert S.import_token_ok(TOKEN) is True
    assert S.import_token_ok("nope") is False
    assert S.import_token_ok("") is False
    assert S.import_token_ok(None) is False

def test_import_adds_ticket_maps_cinema_and_dedupes_by_ref(monkeypatch):
    path = _cfg(monkeypatch)
    httpd, port = _httpd()
    try:
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]}, AUTH)
        assert st == 200, body
        assert body["ok"] and body["added"] == 1 and body["skipped"] == 0
        t = body["tickets"][0]
        assert t["title"] == "Paper Tiger"
        assert t["cid"] == "cinema-pathe-wepler"
        assert t["time"] == "2026-11-25T17:25:00"
        assert t["seat"] == "I5, I7" and t["room"] == "1" and t["places"] == "2"
        assert t["ref"] == "WTZ3BT3" and t["src"] == "e-mail Pathé"
        assert t["id"] == "pathe|WTZ3BT3"
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]}, AUTH)
        assert st == 200 and body["added"] == 0 and body["skipped"] == 1
        saved = json.load(open(path, encoding="utf-8"))["users"][EMAIL]["tickets"]
        assert len(saved) == 1
        assert saved[0]["cinema"]
    finally:
        httpd.shutdown()

def test_import_unknown_account_is_404(monkeypatch):
    _cfg(monkeypatch, users={})
    httpd, port = _httpd()
    try:
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]}, AUTH)
        assert st == 404, (st, body)
        assert "Aucun compte" in body["error"]
    finally:
        httpd.shutdown()

def test_import_refuses_other_email_than_configured(monkeypatch):
    _cfg(monkeypatch)
    httpd, port = _httpd()
    try:
        st, body = _post(port, "/api/import-tickets", {"email": "other@example.com", "tickets": [TICKET]}, AUTH)
        assert st == 403, (st, body)
    finally:
        httpd.shutdown()

def test_import_unconfigured_token_is_503(monkeypatch):
    _cfg(monkeypatch)
    monkeypatch.setenv("TICKETS_IMPORT_TOKEN", "")
    monkeypatch.setattr(S, "TICKETS_IMPORT_TOKEN", "")
    httpd, port = _httpd()
    try:
        st, body = _post(port, "/api/import-tickets", {"tickets": [TICKET]}, AUTH)
        assert st == 503, (st, body)
    finally:
        httpd.shutdown()

def test_map_cinema_wepler_batignolles_palace():
    w = S.map_cinema("Pathé Wepler - Côté place")
    assert w and w["id"] == "cinema-pathe-wepler"
    b = S.map_cinema("Les 7 Batignolles")
    assert b and b["id"] == "les-7-batignolles"
    p = S.map_cinema("Pathé Palace")
    assert p and p["id"] == "cinema-pathe-palace"

def test_normalize_accepts_iso_time_and_n_prefix():
    n = S.normalize_import_ticket({
        "title": "Dune : troisième partie",
        "cinema": "Pathé Palace",
        "time": "2026-12-16T19:30",
        "ref": "N°WXPPC4W",
        "seat": "J19, J20",
        "room": "1",
        "version": "VOST",
    })
    assert n["time"] == "2026-12-16T19:30:00"
    assert n["ref"] == "WXPPC4W" and n["cid"] == "cinema-pathe-palace"
    assert n["places"] == "2"
