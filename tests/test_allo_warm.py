"""v32 : cache disque Allociné, préchauffage, un jour non calculé n’est pas vide."""
import json, os, time, tempfile, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PORT", "8765")
os.environ["ALLO_CACHE"] = tempfile.mkdtemp(prefix="allo-cache-")

import server as S


def _cines(*ids):
    return [{"id": i, "allocineId": i, "type": "pathe"} for i in ids]


def _body(films):
    return json.dumps({"source": "allocine", "films": films}, ensure_ascii=False).encode()


def _put(cid, day, films, ts=None):
    key = "allo:" + cid + day
    ts = time.time() if ts is None else ts
    S.CACHE[key] = (ts, _body(films))
    return key


def setup_function():
    # isole le cache mémoire entre les tests
    with S.LOCK:
        for k in [k for k in S.CACHE if k.startswith("allo:")]:
            S.CACHE.pop(k, None)
    S.ALLO_WARM.update(last="", done_days=0, total_days=0, empty_streak=0, day="", pass_at=0)


def test_day_uncomputed_is_not_empty():
    cines = _cines("C0179", "C0024")
    assert S.day_is_computed("2026-12-01", cines) is False
    assert S.day_confirmed_empty("2026-12-01", cines) is False
    _put("C0179", "2026-12-01", [{"id": 1, "title": "A", "times": [{"time": "2026-12-01T20:00:00"}]}])
    # un seul cinéma calculé : pas encore « vide » ni « calculé »
    assert S.day_is_computed("2026-12-01", cines) is False
    assert S.day_confirmed_empty("2026-12-01", cines) is False


def test_day_computed_empty_and_with_shows():
    cines = _cines("C0179", "C0024")
    _put("C0179", "2026-12-01", [])
    _put("C0024", "2026-12-01", [])
    assert S.day_is_computed("2026-12-01", cines) is True
    assert S.day_has_shows("2026-12-01", cines) is False
    assert S.day_confirmed_empty("2026-12-01", cines) is True
    _put("C0024", "2026-12-01", [{"id": 2, "title": "B", "times": [{"time": "2026-12-01T21:00:00"}]}])
    assert S.day_has_shows("2026-12-01", cines) is True
    assert S.day_confirmed_empty("2026-12-01", cines) is False


def test_disk_roundtrip_and_boot(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLO_CACHE", str(tmp_path))
    key = "allo:C0179" + "2026-12-20"
    films = [{"id": 9, "title": "C", "times": [{"time": "2026-12-20T19:00:00"}]}]
    body = _body(films)
    S.allo_disk_save(key, 111.0, body)
    hit = S.allo_disk_get(key)
    assert hit is not None
    ts, b = hit
    assert ts == 111.0
    assert json.loads(b)["films"][0]["title"] == "C"
    # clé invalide refusée (rien n’est inventé ni écrit hors schéma)
    S.allo_disk_save("allo:../etc/passwd", 1, body)
    assert S.allo_disk_get("allo:../etc/passwd") is None
    with S.LOCK:
        S.CACHE.pop(key, None)
    n = S.allo_disk_boot()
    assert n >= 1
    assert key in S.CACHE
    assert json.loads(S.CACHE[key][1])["films"][0]["id"] == 9


def test_warm_horizon_extends_to_published_last():
    assert S.warm_horizon("2026-11-24", "", 42) == 28
    # 24 nov → 20 déc = 27 j., mais le plancher reste 28
    assert S.warm_horizon("2026-11-24", "2026-12-20", 42) == 28
    # si plus loin que 28 j., on étend jusqu’au plafond
    assert S.warm_horizon("2026-11-24", "2026-12-22", 42) == 29  # 24 nov → 22 déc inclus
    assert S.warm_horizon("2026-11-24", "2027-01-10", 42) == 42


def test_warm_pass_does_not_count_uncomputed_as_empty():
    cines = _cines("AAA01", "BBB02")
    fetched = []

    def fetch(c, dd):
        fetched.append((c["allocineId"], dd))
        # On « calcule » seulement les 5 premiers jours, et le jour 3 est réellement vide.
        # Les jours suivants restent non calculés.
        idx = (int(dd[8:10]) - 24)  # 2026-11-24 = 0
        if 0 <= idx <= 4:
            films = [] if dd == "2026-11-26" else [{"id": idx, "title": "F" + dd, "times": [{"time": dd + "T20:00:00"}]}]
            _put(c["allocineId"], dd, films)

    S.ALLO_WARM["last"] = ""
    out = S.warm_pass(cines=cines, today="2026-11-24", fetch=fetch, now_ts=time.time() + 10_000)
    days = sorted({d for _, d in fetched})
    # horizon initial 28, mais on ne s'arrête pas après le jour vide du 26 (un seul vide, et des jours non calculés ensuite)
    assert "2026-11-24" in days and "2026-11-28" in days
    assert out["empty_streak"] != 3 or out["last"] >= "2026-11-28"
    # le 26 est confirmé vide mais le streak a été remis à 0 par les jours avec séances après
    assert S.day_confirmed_empty("2026-11-26", cines) is True
    assert out["last"] >= "2026-11-28"
    # des jours non calculés n'ont pas été pris pour des jours vides définitifs
    late = "2026-12-10"
    assert S.day_is_computed(late, cines) is False
    assert S.day_confirmed_empty(late, cines) is False


def test_warm_pass_stops_after_three_confirmed_empty_days():
    cines = _cines("AAA01")
    def fetch(c, dd):
        # 24-29 : séances ; 30, 01, 02 : vides confirmés
        if dd <= "2026-11-29":
            _put(c["allocineId"], dd, [{"id": 1, "title": "F", "times": [{"time": dd + "T18:00:00"}]}])
        else:
            _put(c["allocineId"], dd, [])
    out = S.warm_pass(cines=cines, today="2026-11-24", fetch=fetch, now_ts=time.time() + 10_000)
    assert out["last"] == "2026-11-29"
    assert out["empty_streak"] == 3
    # on s'arrête au 3e vide (2 déc), on ne parcourt pas tout l'horizon
    assert out["days"] == 9  # 24 nov → 2 déc inclus


def test_meta_persists_last(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLO_CACHE", str(tmp_path))
    S.ALLO_WARM["last"] = "2026-12-20"
    S.allo_meta_save()
    S.ALLO_WARM["last"] = ""
    S.allo_meta_load()
    assert S.ALLO_WARM["last"] == "2026-12-20"


def test_warm_refreshes_first_seven_days_even_if_cache_is_fresh():
    """Un programme partiel tout juste mis en cache ne doit pas bloquer le rafraîchissement de J..J+6."""
    cines = _cines("W9230")
    fetched = []
    now = 1_000_000.0
    # Cache « frais » et incomplet pour 11 jours (1 film seulement)
    for i, d in enumerate(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]):
        _put("W9230", d, [{"id": 1, "title": "Partiel", "times": [{"time": d + "T20:00:00"}]}], ts=now - 60)
    def fetch(c, dd):
        fetched.append(dd)
        _put(c["allocineId"], dd, [{"id": 2, "title": "Complet", "times": [{"time": dd + "T18:00:00"}, {"time": dd + "T21:00:00"}]}], ts=now)
    out = S.warm_pass(cines=cines, today="2026-11-24", fetch=fetch, now_ts=now)
    # J à J+6 doivent être rappelés malgré un cache frais
    for d in ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"]:
        assert d in fetched, d
    # J+7 (1er déc.) est encore dans la fenêtre de skip 3 h
    assert "2026-12-01" not in fetched
    assert out["last"] >= "2026-11-30"


def test_allo_revalidate_ts_marks_near_days_stale():
    now = 5_000_000.0
    fresh = now - 10
    assert S.allo_revalidate_ts(fresh, "2026-11-26", now=now, today="2026-11-24") <= now - S.TTL - 1
    # au-delà de J+6, on conserve l’horodatage
    assert S.allo_revalidate_ts(fresh, "2026-12-05", now=now, today="2026-11-24") == fresh


def test_allo_fetch_force_bypasses_ttl(monkeypatch):
    key = "allo:W9230" + "2026-11-25"
    stale = json.dumps({"source": "allocine", "films": [{"id": 1, "title": "Partiel", "times": [{"time": "2026-11-25T21:45:00"}]}]}, ensure_ascii=False).encode()
    full = json.dumps({"source": "allocine", "films": [{"id": 1, "title": "Partiel"}, {"id": 2, "title": "Hunger Games"}]}, ensure_ascii=False).encode()
    S.CACHE[key] = (time.time(), stale)
    calls = []
    def fake_live(cid, date, k):
        calls.append((cid, date))
        S.CACHE[k] = (time.time(), full)
        return full
    monkeypatch.setattr(S, "allo_live", fake_live)
    # sans force : TTL, on sert le cache partiel
    got = S.allo_fetch("W9230", "2026-11-25")
    assert json.loads(got)["films"][0]["title"] == "Partiel"
    assert len(json.loads(got)["films"]) == 1
    assert calls == []
    # avec force : on rappelle Allociné
    got2 = S.allo_fetch("W9230", "2026-11-25", force=True)
    assert calls == [("W9230", "2026-11-25")]
    assert len(json.loads(got2)["films"]) == 2
