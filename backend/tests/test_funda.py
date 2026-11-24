from dataclasses import replace
from pathlib import Path

import httpx2
from fastapi.testclient import TestClient

from app.config import Settings
from app.funda import clean_page, photo_urls
from app.main import create_app

URL = "https://www.funda.nl/detail/koop/ergens/huis-laan-1/123/"
IMG = "https://cloud.funda.nl/valentina_media/212/345/678"
PAGE = f"""<html><head><title>Laan 1</title>
<meta property="og:image" content="{IMG}_720x480.jpg">
<meta property="og:description" content="Mooi huis">
<script>alert(1)</script></head>
<body onload="x()"><img data-src="{IMG}_1440x960.jpg"><img src="{IMG.replace("678", "679")}.jpg">
<a href="javascript:void(0)">x</a><iframe src="https://ads"></iframe></body></html>"""


def test_photo_urls_pick_largest_once():
    assert photo_urls(PAGE, URL) == [f"{IMG}_1440x960.jpg", f"{IMG.replace('678', '679')}.jpg"]


def test_clean_page_has_no_scripts():
    page = clean_page(PAGE, URL)
    assert "<script" not in page and "onload" not in page and "<iframe" not in page
    assert 'src="https://cloud.funda.nl' in page
    assert '<base href="https://www.funda.nl/" target="_blank"/>' in page


def handler(blocked: bool):
    def handle(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "www.funda.nl":
            if blocked:
                return httpx2.Response(
                    200, text="<title>Je bent bijna op de pagina die je zoekt</title>"
                )
            return httpx2.Response(200, text=PAGE)
        return httpx2.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})

    return handle


def make(tmp_path: Path, blocked: bool) -> TestClient:
    settings = Settings(
        data_dir=tmp_path,
        reports_dir=None,
        reports_scan_interval=0,
        import_token="",
        version="t",
        commit_url="",
        env_label="",
        env_color="#000",
        static_dir=tmp_path / "static",
        fetch_listings=False,
    )
    app = create_app(replace(settings), listing_transport=httpx2.MockTransport(handler(blocked)))
    return TestClient(app)


def test_refresh_stores_photos_and_page(tmp_path):
    with make(tmp_path, blocked=False) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        listing = client.post(f"/api/houses/{house['id']}/listing/refresh").json()["listing"]
        assert listing["status"] == "ok" and listing["photos"] == 2
        assert client.get(f"/api/houses/{house['id']}/photos/0").content == b"\xff\xd8jpeg"
        page = client.get(f"/api/houses/{house['id']}/listing/page")
        assert "sandbox" in page.headers["content-security-policy"]
        assert "<script" not in page.text


def test_captcha_is_reported(tmp_path):
    with make(tmp_path, blocked=True) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        listing = client.post(f"/api/houses/{house['id']}/listing/refresh").json()["listing"]
        assert listing["status"] == "blocked" and "captcha" in listing["message"]
        assert client.get(f"/api/houses/{house['id']}/photos/0").status_code == 404


def test_escaped_photo_addresses_are_found():
    escaped = "https://cloud.funda.nl/valentina_media/1/2_720x480.jpg".replace("/", "\\u002F")
    page = f'<script>{{"src":"{escaped}"}}</script>'
    assert photo_urls(page, URL) == ["https://cloud.funda.nl/valentina_media/1/2_720x480.jpg"]


def custom(page: str, photo_status: int = 200):
    def handle(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "www.funda.nl":
            return httpx2.Response(200, text=page)
        return httpx2.Response(photo_status, content=b"x", headers={"content-type": "image/jpeg"})

    return handle


def make_custom(tmp_path: Path, handle) -> TestClient:
    settings = Settings(
        data_dir=tmp_path,
        reports_dir=None,
        reports_scan_interval=0,
        import_token="",
        version="t",
        commit_url="",
        env_label="",
        env_color="#000",
        static_dir=tmp_path / "static",
        fetch_listings=False,
    )
    return TestClient(create_app(settings, listing_transport=httpx2.MockTransport(handle)))


def test_page_without_listing_is_an_error_and_kept_for_a_look(tmp_path):
    page = "<html><head><title>Even geduld</title></head><body>" + "x" * 100_000 + "</body>"
    with make_custom(tmp_path, custom(page)) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        listing = client.post(f"/api/houses/{house['id']}/listing/refresh").json()["listing"]
        assert listing["status"] == "error" and "Even geduld" in listing["message"]
        raw = client.get(f"/api/houses/{house['id']}/listing/raw")
        assert raw.status_code == 200 and "Even geduld" in raw.text
        assert raw.headers["content-type"].startswith("text/plain")


def test_refused_photos_are_shown_from_the_photo_server(tmp_path):
    with make_custom(tmp_path, custom(PAGE, photo_status=403)) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        listing = client.post(f"/api/houses/{house['id']}/listing/refresh").json()["listing"]
        assert listing["status"] == "ok" and listing["photos"] == 2
        photo = client.get(f"/api/houses/{house['id']}/photos/0", follow_redirects=False)
        assert photo.status_code == 302 and photo.headers["location"] == f"{IMG}_1440x960.jpg"


def test_page_from_the_browser_is_kept(tmp_path):
    def handle(request: httpx2.Request) -> httpx2.Response:
        assert request.url.host != "www.funda.nl", "the page itself is not fetched again"
        return httpx2.Response(200, content=b"jpg", headers={"content-type": "image/jpeg"})

    with make_custom(tmp_path, handle) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        sent = client.post(
            f"/api/houses/{house['id']}/listing/import", json={"url": URL, "html": PAGE}
        )
        assert sent.status_code == 200, sent.text
        listing = sent.json()["listing"]
        assert listing["status"] == "ok" and listing["photos"] == 2 and listing["hasPage"]
        captcha = "<title>Je bent bijna op de pagina die je zoekt</title>"
        again = client.post(
            f"/api/houses/{house['id']}/listing/import", json={"url": URL, "html": captcha}
        ).json()["listing"]
        assert again["status"] == "blocked" and again["photos"] == 2  # old copy stays
