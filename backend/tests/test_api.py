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
