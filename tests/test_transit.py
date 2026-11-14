"""Tests v25 : proxy /api/transit (IDFM) sans appel réseau réel."""
import json, os, sys, threading, socketserver
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for k in ("GIST_TOKEN", "GIST_ID", "IDFM_API_KEY"): os.environ.pop(k, None)
import server as S
from urllib.request import Request, urlopen
from urllib.error import HTTPError

NAVITIA = {
    "journeys": [
        {
            "duration": 1500,
            "departure_date_time": "20261114T215000",
            "arrival_date_time": "20261114T221500",
            "nb_transfers": 1,
            "sections": [
                {
                    "type": "street_network", "mode": "walking", "duration": 240,
                    "from": {"name": "Départ"}, "to": {"name": "Esplanade de La Défense", "stop_point": {"name": "Esplanade de La Défense"}},
                    "geojson": {"type": "LineString", "coordinates": [[2.256, 48.897], [2.250, 48.892]]},
                },
                {
                    "type": "public_transport", "duration": 720,
                    "from": {"name": "Esplanade de La Défense"}, "to": {"name": "Charles de Gaulle–Étoile"},
                    "display_informations": {"code": "1", "label": "1", "color": "FFBE00", "commercial_mode": "Métro"},
                    "geojson": {"type": "LineString", "coordinates": [[2.250, 48.892], [2.295, 48.874]]},
                },
                {"type": "waiting", "duration": 180, "from": {"name": "A"}, "to": {"name": "A"}},
                {
                    "type": "public_transport", "duration": 300,
                    "from": {"name": "Étoile"}, "to": {"name": "Porte Maillot"},
                    "display_informations": {"code": "1", "color": "FFBE00", "commercial_mode": "RER"},
                    "geojson": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[2.295, 48.874], [2.282, 48.878]]}},
                },
            ],
        }
    ]
}

def _httpd():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), S.H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]

def _get(port, path):
    req = Request("http://127.0.0.1:%d%s" % (port, path), method="GET")
    try:
        with urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except HTTPError as e:
        return e.code, e.read()

def setup_function():
    os.environ.pop("IDFM_API_KEY", None)
    with S.IDFML:
        S.IDFM_CACHE.clear()

def test_slim_transit_journeys():
    out = S.slim_transit_journeys(NAVITIA)
    j = out["journeys"][0]
    assert j["duration"] == 1500 and j["transfers"] == 1
    assert j["departure"] == "2026-11-14T21:50:00" and j["arrival"] == "2026-11-14T22:15:00"
    assert j["sections"][0]["mode"] == "walking" and j["sections"][1]["mode"] == "metro"
    assert j["sections"][1]["line"] == "1" and j["sections"][1]["color"] == "#FFBE00"
    assert j["sections"][2]["mode"] == "waiting"
    assert j["sections"][3]["mode"] == "rer"
    assert j["sections"][3]["geojson"]["type"] == "LineString"
    assert j["sections"][0]["to"] == "Esplanade de La Défense"

def test_transit_no_key_returns_503():
    os.environ.pop("IDFM_API_KEY", None)
    httpd, port = _httpd()
    try:
        st, body = _get(port, " /api/transit?from=48.897,2.256&to=48.89048,2.238012".replace(" ", ""))
        assert st == 503 and json.loads(body) == {"error": "no_key"}
    finally:
        httpd.shutdown()

def test_transit_bad_coords_returns_400():
    os.environ["IDFM_API_KEY"] = "test-key"
    httpd, port = _httpd()
    try:
        for path in ("/api/transit", "/api/transit?from=48.897&to=48.89,2.23", "/api/transit?from=foo,bar&to=48.89,2.23"):
            st, body = _get(port, path)
            assert st == 400, path
            assert json.loads(body)["error"] == "bad_coords"
    finally:
        httpd.shutdown()
        os.environ.pop("IDFM_API_KEY", None)

def test_transit_with_key_mocks_navitia(monkeypatch=None):
    os.environ["IDFM_API_KEY"] = "test-key"
    called = {}
    def fake(olon, olat, dlon, dlat):
        called["args"] = (olon, olat, dlon, dlat)
        return NAVITIA
    S.idfm_fetch = fake
    httpd, port = _httpd()
    try:
        st, body = _get(port, "/api/transit?from=48.897,2.256&to=48.89048,2.238012")
        assert st == 200
        data = json.loads(body)
        assert len(data["journeys"]) == 1
        assert data["journeys"][0]["duration"] == 1500
        assert data["journeys"][0]["sections"][1]["color"] == "#FFBE00"
        # Navitia attend lng;lat
        assert called["args"] == (2.256, 48.897, 2.238012, 48.89048)
        # cache : pas de second appel amont
        def boom(*a, **k):
            raise AssertionError("cache miss")
        S.idfm_fetch = boom
        st2, body2 = _get(port, "/api/transit?from=48.897,2.256&to=48.89048,2.238012")
        assert st2 == 200 and json.loads(body2)["journeys"][0]["duration"] == 1500
    finally:
        httpd.shutdown()
        os.environ.pop("IDFM_API_KEY", None)

if __name__ == "__main__":
    test_slim_transit_journeys(); print("OK slim")
    test_transit_no_key_returns_503(); print("OK no_key")
    test_transit_bad_coords_returns_400(); print("OK bad_coords")
    test_transit_with_key_mocks_navitia(); print("OK mock")
