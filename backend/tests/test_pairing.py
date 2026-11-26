"""Logging in a tablet from a phone with a QR code."""

from fastapi.testclient import TestClient
from test_auth import make

from app.pairing import device_name

TABLET = {"user-agent": "Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/131.0 Safari/537.36"}


def test_phone_logs_in_the_tablet(tmp_path):
    phone, provider = make(tmp_path)
    with phone:
        provider.log_in(phone, "bram", [])
        tablet = TestClient(phone.app, headers=TABLET)
        # Not logged in, never through the provider here: a choice with the phone.
        page = tablet.get("/api/auth/start", params={"next": "/#/huis/x"})
        assert page.status_code == 200 and "Inloggen met je telefoon" in page.text
        started = tablet.post("/api/auth/pair").json()
        pair_id = started["url"].rsplit("/", 1)[1]
        assert "<svg" in started["qr"] and len(started["code"]) == 6
        assert tablet.get("/api/auth/pair/status").json() == {"status": "pending"}

        # Someone who only sees the QR code gets nothing.
        stranger = TestClient(phone.app)
        assert stranger.get(f"/api/auth/pair/{pair_id}").status_code == 401
        assert stranger.post(f"/api/auth/pair/{pair_id}/approve").status_code == 401
        assert stranger.get("/api/auth/pair/status").json() == {"status": "expired"}

        shown = phone.get(f"/api/auth/pair/{pair_id}").json()
        assert shown == {"code": started["code"], "device": "Android-tablet (Chrome)"}
        assert phone.post(f"/api/auth/pair/{pair_id}/approve").status_code == 200
        assert stranger.get("/api/auth/pair/status").json() == {"status": "expired"}
        assert tablet.get("/api/auth/pair/status").json() == {"status": "approved"}
        assert tablet.get("/api/houses").status_code == 200
        assert tablet.get("/api/auth/me").json()["user"]["name"] == "Bram"
        # Once only.
        assert phone.post(f"/api/auth/pair/{pair_id}/approve").status_code == 404

        # Both logins are listed; the phone ends the tablet's.
        listed = phone.get("/api/auth/sessions").json()
        assert len(listed["sessions"]) == 2
        other = next(s for s in listed["sessions"] if s["id"] != listed["current"])
        assert other["via"] == "telefoon" and other["device"] == "Android-tablet (Chrome)"
        assert phone.delete(f"/api/auth/sessions/{other['id']}").status_code == 204
        assert tablet.get("/api/houses").status_code == 401
        assert phone.get("/api/houses").status_code == 200


def test_phone_can_refuse(tmp_path):
    phone, provider = make(tmp_path)
    with phone:
        provider.log_in(phone, "bram", [])
        tablet = TestClient(phone.app)
        pair_id = tablet.post("/api/auth/pair").json()["url"].rsplit("/", 1)[1]
        phone.post(f"/api/auth/pair/{pair_id}/deny")
        assert tablet.get("/api/auth/pair/status").json() == {"status": "denied"}
        assert tablet.get("/api/houses").status_code == 401


def test_after_a_provider_login_start_goes_straight_on(tmp_path):
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "bram", [])
        client.post("/api/auth/logout")
        again = client.get("/api/auth/start", params={"next": "/#/x"}, follow_redirects=False)
        assert again.status_code == 303 and again.headers["location"].startswith("/api/auth/login")


def test_start_page_keeps_the_address_inside_its_script(tmp_path):
    client, _ = make(tmp_path)
    with client:
        page = client.get("/api/auth/start", params={"next": "/</script><script>alert(1)//"})
        assert "</script><script>alert" not in page.text


def test_device_names():
    assert device_name("Mozilla/5.0 (iPad; CPU OS 17_0) Safari/604.1") == "iPad (Safari)"
    assert device_name("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/1") == (
        "Android-telefoon (Chrome)"
    )
