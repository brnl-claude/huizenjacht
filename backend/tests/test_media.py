from pathlib import Path

from test_api import make_client

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


def media_dir(tmp_path: Path) -> Path:
    return tmp_path / "data" / "media"


def test_photo_on_a_checklist_item_and_in_general(tmp_path):
    with make_client(tmp_path) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        res = client.post(
            f"/api/houses/{house}/media",
            files={
                "file": ("kelder.jpg", PNG, "image/jpeg"),
                "thumb": ("thumb.jpg", b"t", "image/jpeg"),
            },
            data={"item": "binnen-1"},
        )
        assert res.status_code == 201
        photo = res.json()
        assert photo["kind"] == "foto" and photo["item"] == "binnen-1" and photo["thumb"]
        assert photo["person"] == "lokaal"
        memo = client.post(
            f"/api/houses/{house}/media",
            files={"file": ("memo.webm", b"ogg", "audio/webm;codecs=opus")},
            data={"duration": "12.5"},
        ).json()
        assert memo["kind"] == "audio" and memo["item"] is None and memo["duration"] == 12.5
        assert [m["id"] for m in client.get(f"/api/houses/{house}").json()["media"]] == [
            photo["id"],
            memo["id"],
        ]
        got = client.get(f"/api/media/{photo['id']}")
        assert got.content == PNG and got.headers["content-type"] == "image/jpeg"
        assert client.get(f"/api/media/{photo['id']}/thumb").content == b"t"
        moved = client.patch(f"/api/media/{photo['id']}", json={"item": None, "note": "Vocht"})
        assert moved.json()["item"] is None and moved.json()["note"] == "Vocht"
        assert client.delete(f"/api/media/{memo['id']}").status_code == 204
        assert client.get(f"/api/media/{memo['id']}").status_code == 404
        assert client.delete(f"/api/houses/{house}").status_code == 204
        assert list(media_dir(tmp_path).iterdir()) == []


def test_only_photos_videos_and_sound(tmp_path):
    with make_client(tmp_path) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        res = client.post(
            f"/api/houses/{house}/media", files={"file": ("x.pdf", b"%PDF", "application/pdf")}
        )
        assert res.status_code == 415
        assert client.get("/api/media/..%2Fhuizenjacht.db").status_code == 404


def test_shared_files_wait_for_a_house(tmp_path):
    with make_client(tmp_path) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        res = client.post(
            "/api/share",
            data={"title": "Foto's", "text": "", "url": ""},
            files=[
                ("files", ("a.jpg", PNG, "image/jpeg")),
                ("files", ("b.mp4", b"mp4", "video/mp4")),
            ],
            follow_redirects=False,
        )
        assert res.status_code == 303 and res.headers["location"].startswith("/#/delen/")
        share = res.headers["location"].rsplit("/", 1)[1]
        files = client.get(f"/api/share/{share}").json()["files"]
        assert [f["kind"] for f in files] == ["foto", "video"]
        assert client.get(f"/api/houses/{house}").json()["media"] == []
        filed = client.post(f"/api/share/{share}", json={"house": house, "item": "buiten-2"})
        assert filed.json() == {"house": house, "files": 2}
        media = client.get(f"/api/houses/{house}").json()["media"]
        assert [m["item"] for m in media] == ["buiten-2", "buiten-2"]
        assert client.get(f"/api/share/{share}").status_code == 404


def test_android_app_gets_json_and_can_drop_a_share(tmp_path):
    with make_client(tmp_path) as client:
        res = client.post(
            "/api/share",
            files=[("files", ("a.jpg", PNG, "image/jpeg"))],
            headers={"Accept": "application/json"},
        )
        assert res.status_code == 201
        share = res.json()
        assert share["url"] == f"/#/delen/{share['id']}"
        assert client.delete(f"/api/share/{share['id']}").status_code == 204
        assert list(media_dir(tmp_path).iterdir()) == []


def test_the_same_upload_twice_is_kept_once(tmp_path):
    with make_client(tmp_path) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        sent = [
            client.post(
                f"/api/houses/{house}/media",
                files={"file": ("kelder.jpg", PNG, "image/jpeg")},
                data={"key": "abc-123"},
            ).json()
            for _ in range(2)
        ]
        assert sent[0]["id"] == sent[1]["id"]
        assert len(client.get(f"/api/houses/{house}").json()["media"]) == 1


def test_disk_usage_and_full_backup(tmp_path):
    import io
    import zipfile

    with make_client(tmp_path) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        photo = client.post(
            f"/api/houses/{house}/media",
            files={
                "file": ("kelder.jpg", PNG, "image/jpeg"),
                "thumb": ("thumb.jpg", b"t", "image/jpeg"),
            },
        ).json()
        memo = client.post(
            f"/api/houses/{house}/media",
            files={"file": ("memo.webm", b"ogg", "audio/webm")},
        ).json()
        listing = tmp_path / "data" / "listings" / house
        listing.mkdir(parents=True)
        (listing / "photo-01.jpg").write_bytes(b"f" * 10)

        usage = client.get("/api/opslag").json()
        cats = usage["categories"]
        assert cats["fotos"] == {"bytes": len(PNG) + 1, "count": 1}
        assert cats["memos"] == {"bytes": 3, "count": 1}
        assert cats["advertenties"] == {"bytes": 10, "count": 1}
        assert cats["gegevens"]["count"] == 1 and cats["gegevens"]["bytes"] > 0
        assert usage["disk"]["total"] > 0

        res = client.get("/api/backup/volledig")
        assert res.status_code == 200 and "volledig.zip" in res.headers["content-disposition"]
        archive = zipfile.ZipFile(io.BytesIO(res.content))
        names = set(archive.namelist())
        assert {
            "huizenjacht.json",
            f"media/{photo['id']}",
            f"media/{photo['id']}.thumb.jpg",
            f"media/{memo['id']}",
            f"advertenties/{house}/photo-01.jpg",
        } <= names
        assert archive.read(f"media/{photo['id']}") == PNG

        # Everything gone, then back from the ZIP.
        client.delete(f"/api/houses/{house}")
        assert not (media_dir(tmp_path) / photo["id"]).exists()
        restored = client.post(
            "/api/backup/restore/volledig",
            files={"file": ("backup.zip", res.content, "application/zip")},
        ).json()
        assert restored == {"houses": 1, "media": 2}
        assert client.get(f"/api/media/{photo['id']}").content == PNG
        assert client.get(f"/api/media/{photo['id']}/thumb").content == b"t"
        assert len(client.get(f"/api/houses/{house}").json()["media"]) == 2
        assert (listing / "photo-01.jpg").read_bytes() == b"f" * 10

        bad = client.post(
            "/api/backup/restore/volledig",
            files={"file": ("x.zip", b"geen zip", "application/zip")},
        )
        assert bad.status_code == 400
        assert client.get(f"/api/media/{photo['id']}").content == PNG


def test_nightly_backups(tmp_path):
    from datetime import date, datetime
    from zoneinfo import ZoneInfo

    from fastapi.testclient import TestClient

    from app.backup import next_run, nightly_backups, prune_nightly, write_nightly
    from app.config import Settings
    from app.main import create_app

    backups = tmp_path / "backups"
    settings = Settings(
        data_dir=tmp_path / "data",
        reports_dir=None,
        reports_scan_interval=0,
        import_token="",
        version="1",
        commit_url="",
        env_label="",
        env_color="#000",
        static_dir=tmp_path / "static",
        backup_dir=backups,
    )
    with TestClient(create_app(settings)) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        photo = client.post(
            f"/api/houses/{house}/media", files={"file": ("a.jpg", PNG, "image/jpeg")}
        ).json()
        db = client.app.state.db
        for day in range(1, 8):
            write_nightly(db, settings.data_dir, None, backups, date(2026, 11, day), 5)
        # Five days kept: the 3rd up to and including the 7th.
        names = [b["name"] for b in nightly_backups(backups)]
        assert names == [f"huizenjacht-2026-11-0{d}.zip" for d in (7, 6, 5, 4, 3)]
        assert not list(backups.glob(".*"))

        listed = client.get("/api/backups").json()
        assert listed["enabled"] and listed["keepDays"] == 5 and len(listed["backups"]) == 5
        got = client.get("/api/backups/huizenjacht-2026-11-07.zip")
        assert got.status_code == 200 and got.content[:2] == b"PK"
        assert client.get("/api/backups/..%2Fdata").status_code == 404
        assert client.get("/api/opslag").json()["categories"]["backups"]["count"] == 5

        client.delete(f"/api/houses/{house}")
        restored = client.post("/api/backups/huizenjacht-2026-11-07.zip/restore").json()
        assert restored == {"houses": 1, "media": 1}
        assert client.get(f"/api/media/{photo['id']}").content == PNG

    # After a long pause the newest stays, however old.
    prune_nightly(backups, date(2027, 1, 1), 5)
    assert [b["name"] for b in nightly_backups(backups)] == ["huizenjacht-2026-11-07.zip"]

    zone = ZoneInfo("Europe/Amsterdam")
    assert next_run(datetime(2026, 11, 26, 2, 0, tzinfo=zone), "03:00").hour == 3
    later = next_run(datetime(2026, 11, 26, 4, 0, tzinfo=zone), "03:00")
    assert (later.day, later.hour) == (27, 3)
