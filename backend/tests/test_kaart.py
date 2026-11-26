from pathlib import Path

import httpx2
from fastapi.testclient import TestClient

from app.config import Settings
from app.kaart import address_query, matches
from app.main import create_app

TILE = b"\x89PNG\r\n\x1a\n" + b"t" * 50


def make(tmp_path: Path, enabled: bool = True):
    calls: list[str] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        calls.append(str(request.url))
        assert request.headers["user-agent"].startswith("Huizenjacht/")
        if request.url.host == "api.pdok.nl":
            q = request.url.params["q"]
            elsewhere = {"straatnaam": "Kade", "woonplaatsnaam": "Zwolle", "postcode": "8011AA"}
            here = {"straatnaam": "Kade", "woonplaatsnaam": "Delft", "postcode": "2611AB"}
            docs = [
                {**elsewhere, "centroide_ll": "POINT(6.09 52.51)"},
                {**here, "centroide_ll": "POINT(4.35 52.01)"},
            ]
            if "Nergens" in q:
                docs = [{**here, "straatnaam": "Laan"}]
            return httpx2.Response(200, json={"response": {"docs": docs}})
        if request.url.host == "tile.openstreetmap.org":
            return httpx2.Response(200, content=TILE)
        return httpx2.Response(404)

    settings = Settings(
        data_dir=tmp_path / "data",
        reports_dir=None,
        reports_scan_interval=0,
        import_token="",
        version="1.2.3",
        commit_url="",
        env_label="",
        env_color="#000",
        static_dir=tmp_path / "static",
        map_enabled=enabled,
    )
    app = create_app(settings, map_transport=httpx2.MockTransport(handle))
    return TestClient(app), calls


def test_address_query():
    assert address_query({"adres": "Kade 2", "postcode": "2611 AB", "plaats": "Delft"}) == (
        "Kade 2, 2611 AB Delft"
    )
    assert address_query({"plaats": "Delft"}) is None


def test_only_the_right_town_counts():
    doc = {"straatnaam": "Lindenlaan", "woonplaatsnaam": "'s-Gravenhage", "postcode": "2585AB"}
    assert matches(doc, {"adres": "Lindenlaan 14", "plaats": "Den Haag"})
    assert matches(doc, {"adres": "Lindenlaan 14", "postcode": "2585 ab", "plaats": "Delft"})
    assert not matches(doc, {"adres": "Lindenlaan 14", "plaats": "Delft"})
    assert not matches(doc, {"adres": "Eikenlaan 14", "plaats": "Den Haag"})
    assert not matches(doc, {"adres": "Lindenlaan 14"})


def test_location_is_looked_up_once(tmp_path):
    client, calls = make(tmp_path)
    with client:
        house = client.post("/api/houses", json={"adres": "Kade 2", "plaats": "Delft"}).json()["id"]
        assert client.get(f"/api/houses/{house}/ligging").json() == {"lat": 52.01, "lon": 4.35}
        assert client.get(f"/api/houses/{house}/ligging").json() == {"lat": 52.01, "lon": 4.35}
        assert sum("pdok" in c for c in calls) == 1
        other = client.post("/api/houses", json={"adres": "Nergens 1"}).json()["id"]
        assert client.get(f"/api/houses/{other}/ligging").status_code == 404


def test_tiles_are_kept(tmp_path):
    client, calls = make(tmp_path)
    with client:
        assert client.get("/api/kaart/16/33650/21620.png").content == TILE
        assert client.get("/api/kaart/16/33650/21620.png").content == TILE
        assert len(calls) == 1
        assert (tmp_path / "data/kaart/tegels/16/33650/21620.png").is_file()
        assert client.get("/api/kaart/5/1/1.png").status_code == 404
        assert client.get("/api/kaart/16/99999999/1.png").status_code == 404


def test_map_off_sends_nothing(tmp_path):
    client, calls = make(tmp_path, enabled=False)
    with client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        assert client.get(f"/api/houses/{house}/ligging").status_code == 404
        assert client.get("/api/kaart/16/33650/21620.png").status_code == 404
        assert calls == []
