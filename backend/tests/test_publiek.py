from pathlib import Path

from test_api import make_client


def report(tmp_path: Path) -> Path:
    reports = tmp_path / "reports"
    (reports / "huizen").mkdir(parents=True)
    (reports / "huizen" / "laan-1.md").write_text(
        "---\nadres: Laan 1\nplaats: Utrecht\nvraagprijs: 300000\nbouwjaar: 1932\n"
        "samenvatting: Ruim en licht.\npluspunten: [Tuin op het zuiden]\n---\n# Laan 1\n"
        "Het dak is **oud**.\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n"
    )
    return reports


def test_public_link_shows_overview_and_report_only(tmp_path):
    with make_client(tmp_path, report(tmp_path)) as client:
        client.post("/api/import/scan")
        client.patch("/api/houses/laan-1", json={"notities": "Geheime notitie", "cijfer": 8})
        assert client.get("/api/houses/laan-1/publiek").json() is None
        link = client.put("/api/houses/laan-1/publiek", json={}).json()
        assert len(link["token"]) >= 30
        res = client.get(link["path"])
        assert res.status_code == 200
        text = res.text
        assert "Laan 1" in text and "€ 300.000" in text and "1932" in text
        assert "Ruim en licht." in text and "Tuin op het zuiden" in text
        assert "Het dak is <strong>oud</strong>." in text
        assert "<script>" not in text and 'href="javascript' not in text
        assert "Geheime notitie" not in text
        assert "https://www.google.com/maps/search/?api=1&amp;query=Laan%201%2C%20Utrecht" in text
        assert res.headers["x-robots-tag"].startswith("noindex")
        assert "default-src 'none'" in res.headers["content-security-policy"]
        assert client.put("/api/houses/laan-1/publiek", json={}).json()["token"] == link["token"]


def test_public_link_new_and_revoke(tmp_path):
    with make_client(tmp_path, report(tmp_path)) as client:
        client.post("/api/import/scan")
        old = client.put("/api/houses/laan-1/publiek", json={}).json()
        new = client.put("/api/houses/laan-1/publiek", json={"nieuw": True}).json()
        assert new["token"] != old["token"]
        assert client.get(old["path"]).status_code == 404
        assert client.get(new["path"]).status_code == 200
        assert client.delete("/api/houses/laan-1/publiek").status_code == 204
        res = client.get(new["path"])
        assert res.status_code == 404 and "werkt niet" in res.text
        assert client.get("/gedeeld/kort").status_code == 404
        assert client.get(f"{new['path']}/foto/0").status_code == 404


def test_public_links_not_writable_as_setting(tmp_path):
    with make_client(tmp_path, report(tmp_path)) as client:
        client.post("/api/import/scan")
        res = client.put(
            "/api/settings/publiekeLinks", json={"value": {"x" * 30: {"house": "laan-1"}}}
        )
        assert res.status_code == 400


def test_public_photos_and_delete_house(tmp_path):
    with make_client(tmp_path, report(tmp_path)) as client:
        client.post("/api/import/scan")
        folder = tmp_path / "data" / "listings" / "laan-1"
        folder.mkdir(parents=True)
        (folder / "photo-000.jpg").write_bytes(b"jpg")
        link = client.put("/api/houses/laan-1/publiek", json={}).json()
        text = client.get(link["path"]).text
        assert "/foto/0" in text
        assert (
            f'<meta property="og:image" content="http://testserver{link["path"]}/foto/0">' in text
        )
        assert '<meta property="og:title" content="Laan 1">' in text
        assert "€ 300.000 · Utrecht" in text
        assert client.get(f"{link['path']}/foto/0").content == b"jpg"
        client.delete("/api/houses/laan-1")
        assert client.get(link["path"]).status_code == 404
