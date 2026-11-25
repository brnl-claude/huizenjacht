from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(tmp_path: Path, reports: Path | None = None) -> TestClient:
    settings = Settings(
        data_dir=tmp_path / "data",
        reports_dir=reports,
        reports_scan_interval=0,
        import_token="geheim",
        version="1.2.3",
        commit_url="",
        env_label="",
        env_color="#000",
        static_dir=tmp_path / "static",
    )
    return TestClient(create_app(settings))


def test_folder_import_keeps_own_data(tmp_path):
    reports = tmp_path / "reports"
    (reports / "huizen").mkdir(parents=True)
    (reports / "README.md").write_text("# Uitleg")
    report = reports / "huizen" / "laan-1.md"
    report.write_text("# Laan 1\nVraagprijs: € 300.000\n")
    with make_client(tmp_path, reports) as client:
        assert client.get("/api/health").json()["version"] == "1.2.3"
        houses = client.get("/api/houses").json()
        assert [h["id"] for h in houses] == ["laan-1"]
        client.patch("/api/houses/laan-1", json={"status": "bezichtigd", "favoriet": True})
        report.write_text("# Laan 1\nVraagprijs: € 290.000\n")
        assert client.post("/api/import/scan").json()["updated"] == 1
        house = client.get("/api/houses/laan-1").json()
        assert house["report"]["vraagprijs"] == 290000
        assert house["mine"] == {"status": "bezichtigd", "favoriet": True}
        assert client.get("/api/import").json()["fileCount"] == 1


def test_upload_manual_backup(tmp_path):
    with make_client(tmp_path) as client:
        res = client.post(
            "/api/import/upload",
            files=[
                ("files", ("Kade 2.md", b"# Kade 2\nKamers: 4\n", "text/markdown")),
                ("files", ("foto.png", b"x", "image/png")),
            ],
        )
        body = res.json()
        assert body["created"] == 1 and len(body["errors"]) == 1
        created = client.post("/api/houses", json={"adres": "Kade 2"}).json()
        assert created["id"].startswith("kade-2-")
        backup = client.get("/api/backup").json()
        assert len(backup["houses"]) == 2
        client.delete("/api/houses/kade-2")
        assert client.post("/api/backup/restore", json=backup).json()["houses"] == 2
        assert client.get("/api/nope").status_code == 404
        client.put("/api/settings/checklist", json={"value": [1]})
        assert client.get("/api/settings/checklist").json() == {"value": [1]}


def test_hook_needs_token(tmp_path):
    with make_client(tmp_path) as client:
        # The test client is not localhost.
        assert client.post("/api/import/hook").status_code == 401
        ok = client.post("/api/import/hook", headers={"Authorization": "Bearer geheim"})
        assert ok.status_code == 202


def test_without_login_answers_are_kept_as_one_person(tmp_path):
    with make_client(tmp_path) as client:
        client.post("/api/houses", json={"adres": "Laan 1"})
        client.patch("/api/houses/laan-1", json={"cijfer": 8, "favoriet": True})
        mine = client.get("/api/houses/laan-1").json()["mine"]
        assert mine == {"adres": "Laan 1", "favoriet": True, "personen": {"lokaal": {"cijfer": 8}}}
        people = client.get("/api/people").json()
        assert people == {"me": "lokaal", "people": [{"key": "lokaal", "naam": "Ik", "kleur": 0}]}


def test_changes_are_sent_live(tmp_path):
    with make_client(tmp_path) as client:
        app = client.app
        seen = []
        app.state.events.publish = seen.append
        client.post("/api/houses", json={"adres": "Laan 1"}, headers={"X-Client": "tab-1"})
        client.patch("/api/houses/laan-1", json={"cijfer": 8})
        client.delete("/api/houses/laan-1")
        assert seen == [
            {"type": "house", "id": "laan-1", "from": "tab-1"},
            {"type": "house", "id": "laan-1", "from": None},
            {"type": "removed", "id": "laan-1", "from": None},
        ]


def test_assetlinks_names_the_android_app(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get("/.well-known/assetlinks.json").json() == []
    settings = Settings(
        data_dir=tmp_path / "data2",
        reports_dir=None,
        reports_scan_interval=0,
        import_token="",
        version="1.2.3",
        commit_url="",
        env_label="",
        env_color="#000",
        static_dir=tmp_path / "static",
        android_cert_fingerprints=("AB:CD", "EF:01"),
    )
    with TestClient(create_app(settings)) as client:
        [statement] = client.get("/.well-known/assetlinks.json").json()
        assert statement["relation"] == ["delegate_permission/common.handle_all_urls"]
        assert statement["target"] == {
            "namespace": "android_app",
            "package_name": "app.huizenjacht",
            "sha256_cert_fingerprints": ["AB:CD", "EF:01"],
        }


def test_documents_of_a_house(tmp_path):
    reports = tmp_path / "reports"
    (reports / "huizen").mkdir(parents=True)
    (reports / "huizen" / "laan-1.md").write_text(
        "---\nid: laan-1\ndocumenten:\n"
        "  - titel: Bouwkundig rapport\n    bestand: BK-2026-0187.pdf\n    datum: 2026-11-18\n"
        "  - titel: Lijst van zaken\n"
        "---\n# Laan 1\n"
    )
    folder = reports / "documenten" / "laan-1"
    (folder / "vve").mkdir(parents=True)
    (folder / "BK-2026-0187.pdf").write_bytes(b"%PDF-1.4 rapport")
    (folder / "vve" / "notulen.md").write_text("# Notulen, geen rapport")
    (folder / "pagina.html").write_text("<script>alert(1)</script>")
    with make_client(tmp_path, reports) as client:
        client.post("/api/import/scan")
        # A Markdown document is not imported as a house.
        assert [h["id"] for h in client.get("/api/houses").json()] == ["laan-1"]
        docs = client.get("/api/houses/laan-1/documenten").json()
        assert [d["naam"] for d in docs] == [
            "Bouwkundig rapport",
            "Lijst van zaken",
            "pagina.html",
            "notulen.md",
        ]
        assert docs[0]["bestand"] == "BK-2026-0187.pdf" and docs[0]["grootte"] == 16
        assert "url" not in docs[1]
        assert docs[3]["zonderTitel"] and docs[3]["bestand"] == "vve/notulen.md"
        res = client.get(docs[0]["url"])
        assert res.content == b"%PDF-1.4 rapport"
        assert res.headers["content-disposition"].startswith("inline")
        assert client.get(docs[2]["url"]).headers["content-disposition"].startswith("attachment")
        assert client.get(docs[3]["url"]).status_code == 200
        assert (
            client.get("/api/houses/laan-1/documenten/..%2Fhuizen%2Flaan-1.md").status_code == 404
        )
        assert client.get("/api/houses/laan-1/documenten/nope.pdf").status_code == 404
