"""Tests unitaires (mock) de la correspondance TMDB — aucune donnée réelle, aucun appel réseau."""
import os, sys, time, json, importlib
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for k in ("GIST_TOKEN", "GIST_ID", "TMDB_READ_TOKEN"): os.environ.pop(k, None)
os.environ["TMDB_API_KEY"] = "test-only"
import server as S
CALLS = []
FAKE = {  # réponses fictives de /search/movie
    "Wicked: For Good": [{"id": 1, "title": "Wicked : Partie II", "original_title": "Wicked: For Good", "release_date": "2025-11-19", "vote_average": 7.36, "vote_count": 120}],
    "Homonyme": [{"id": 2, "title": "Homonyme", "original_title": "Homonyme", "release_date": "1987-01-01", "vote_average": 6.0, "vote_count": 50}],
    "Peu de votes": [{"id": 3, "title": "Peu de votes", "original_title": "Peu de votes", "release_date": "2026-01-01", "vote_average": 9.0, "vote_count": 4}],
}
def fake_http(path, params): CALLS.append(params); return {"results": FAKE.get(params["query"], [])}
S.tmdb_http = fake_http; S.time.sleep = lambda s: None
def test_match_original_title_and_year():
    r = S.tmdb_match("Wicked : Partie II", "Wicked: For Good", 2025); assert r and r["id"] == 1
    assert all(p["language"] == "fr-FR" for p in CALLS)
def test_reject_wrong_year():  # même titre, mais film de 1987 ≠ film de 2026 : pas de note
    assert S.tmdb_match("Homonyme", "Homonyme", 2026) is None
def test_no_year_needs_single_exact():
    assert S.tmdb_match("Homonyme", None, None)["id"] == 2
    assert S.tmdb_match("Titre inconnu", None, None) is None
def test_public_hides_low_votes_and_annotate():
    S.tmdb_lookup_one("100", "Wicked : Partie II", "Wicked: For Good", 2025)
    S.tmdb_lookup_one("101", "Peu de votes", "Peu de votes", 2026)
    S.tmdb_lookup_one("102", "Homonyme", "Homonyme", 2026)
    pub = S.tmdb_public(); assert pub["100"] == [7.4, 120, 1] and "101" not in pub and "102" not in pub
    films = S.tmdb_annotate([{"id": 100, "title": "x"}, {"id": 101, "title": "y"}])
    assert films[0]["tmdbRating"] == 7.4 and films[0]["tmdbVotes"] == 120 and "tmdbRating" not in films[1]
if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"): f(); print("OK", n)
