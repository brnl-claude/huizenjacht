import json
from dataclasses import replace
from pathlib import Path

import httpx2
from fastapi.testclient import TestClient

from app.config import Settings
from app.funda import clean_page, download_address, listing_page, photo_urls
from app.main import BOOKMARKLET_VERSION, create_app

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
        )
        assert again.status_code == 422 and "captcha" in again.json()["detail"]
        # The good copy stays, without a failure notice on it.
        kept = client.get(f"/api/houses/{house['id']}").json()["listing"]
        assert kept["status"] == "ok" and kept["photos"] == 2 and kept["message"] is None


def test_bookmarklet_sends_a_page_in_the_background(tmp_path):
    def handle(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, content=b"jpg", headers={"content-type": "image/jpeg"})

    with make_custom(tmp_path, handle) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        token = client.get("/api/bookmarklet").json()["token"]
        page = {"token": token, "url": URL + "?utm=x", "html": PAGE, "v": BOOKMARKLET_VERSION}
        sent = client.post(
            "/api/bookmarklet/page",
            content=json.dumps(page),
            headers={"content-type": "text/plain", "origin": "https://www.funda.nl"},
        )
        assert sent.status_code == 200, sent.text
        assert sent.headers["access-control-allow-origin"] == "*"
        assert sent.json()["house"] == house["id"]
        assert client.get(f"/api/houses/{house['id']}").json()["listing"]["photos"] == 2

        count = len(client.get("/api/houses").json())
        other = {**page, "url": "https://www.funda.nl/detail/koop/x/huis-y/99999999/"}
        unknown = client.post("/api/bookmarklet/page", content=json.dumps(other))
        assert unknown.status_code == 404 and "nog niet in Huizenjacht" in unknown.json()["message"]
        for elsewhere in (
            "https://example.com/detail/koop/x/huis-y/123/",
            "https://www.funda.nl.example.com/detail/koop/x/huis-y/123/",
            "https://www.funda.nl/zoeken/koop?selected_area=lathum",
            "javascript:alert(1)",
        ):
            sent = client.post(
                "/api/bookmarklet/page", content=json.dumps({**page, "url": elsewhere})
            )
            assert sent.status_code == 400 and "alleen op een huis op funda.nl" in sent.text
        assert len(client.get("/api/houses").json()) == count

        for old in ({k: v for k, v in page.items() if k != "v"}, {**page, "v": 1}):
            sent = client.post("/api/bookmarklet/page", content=json.dumps(old))
            assert sent.status_code == 426 and "verouderd" in sent.json()["message"]

        wrong = client.post("/api/bookmarklet/page", content=json.dumps({**page, "token": "x"}))
        assert wrong.status_code == 403
        client.post("/api/bookmarklet/rotate")
        old = client.post("/api/bookmarklet/page", content=json.dumps(page))
        assert old.status_code == 403


def test_failed_try_keeps_a_good_copy(tmp_path):
    calls = {"blocked": False}

    def handle(request: httpx2.Request) -> httpx2.Response:
        return handler(calls["blocked"])(request)

    with make_custom(tmp_path, handle) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        client.post(f"/api/houses/{house['id']}/listing/refresh")
        calls["blocked"] = True
        listing = client.post(f"/api/houses/{house['id']}/listing/refresh").json()["listing"]
        assert listing["status"] == "ok" and listing["message"] is None and listing["photos"] == 2


def test_background_fetching_is_off_by_default(monkeypatch):
    from app.config import load_settings

    monkeypatch.delenv("HJ_FETCH_LISTINGS", raising=False)
    assert load_settings().fetch_listings is False
    monkeypatch.setenv("HJ_FETCH_LISTINGS", "true")
    assert load_settings().fetch_listings is True


def test_old_failure_on_a_good_copy_is_cleared(tmp_path):
    from app.db import Database

    path = tmp_path / "huizenjacht.sqlite"
    database = Database(path)
    database.create_manual("laan-1", {"adres": "Laan 1", "url": URL})
    database.save_listing("laan-1", URL, "ok", photos=3, has_page=True)
    # As an older version stored it: a captcha on top of a good copy.
    database._conn.execute("UPDATE listings SET status = 'blocked', message = 'captcha'")
    database._conn.commit()
    database.close()
    listing = Database(path).get_house("laan-1")["listing"]
    assert listing["status"] == "ok" and listing["message"] is None and listing["photos"] == 3


MEDIA = "https://cloud.funda.nl/valentina_media/236/703"


def photo_page(numbers: range) -> str:
    """Like Funda's /media/fotos/ page: every photo, sizes in the query."""
    imgs = "".join(
        f'<img srcset="{MEDIA}/{n}.jpg?options=width=464 238w, '
        f'{MEDIA}/{n}.jpg?options=width=1080 722w" alt="Foto {n} van Laan 1" '
        f'src="{MEDIA}/{n}.jpg?options=width=1080">'
        for n in numbers
    )
    return f"<html><head><title>Laan 1 | Funda</title></head><body>{imgs}</body></html>"


def test_the_photo_page_brings_every_photo_in_its_order():
    listing = (
        '<html><head><meta property="og:title" content="Laan 1"></head><body>'
        f'<img src="{MEDIA}/203.jpg?options=width=720"><img src="{MEDIA}/999.jpg"></body></html>'
    )
    urls = photo_urls(listing, URL, photo_page(range(200, 234)))
    assert len(urls) == 35
    assert urls[:2] == [f"{MEDIA}/200.jpg", f"{MEDIA}/201.jpg"]
    # A photo only the listing shows still comes along, after the others.
    assert urls[-1] == f"{MEDIA}/999.jpg"


def test_photos_are_downloaded_at_a_sensible_size():
    assert download_address(f"{MEDIA}/200.jpg") == f"{MEDIA}/200.jpg?options=width=1440"
    assert download_address(f"{IMG}_1440x960.jpg") == f"{IMG}_1440x960.jpg"


def test_media_pages_belong_to_the_listing():
    base = "https://www.funda.nl/detail/koop/velp-ge/huis-laan-1/44544340/"
    assert listing_page(base + "media/fotos/") == base
    assert listing_page(base + "media/") == base
    assert listing_page(base) == base


def test_bookmarklet_brings_the_photo_page_along(tmp_path):
    asked: list[str] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        asked.append(str(request.url))
        return httpx2.Response(200, content=b"jpg", headers={"content-type": "image/jpeg"})

    url = "https://www.funda.nl/detail/koop/velp-ge/huis-laan-1/44544340/"
    with make_custom(tmp_path, handle) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": url}).json()
        token = client.get("/api/bookmarklet").json()["token"]
        sent = client.post(
            "/api/bookmarklet/page",
            content=json.dumps(
                {
                    "v": BOOKMARKLET_VERSION,
                    "token": token,
                    "url": url + "media/fotos/",
                    "html": PAGE,
                    "photos": photo_page(range(200, 240)),
                }
            ),
        )
        assert sent.status_code == 200, sent.text
        assert "42 foto's" in sent.json()["message"]
        assert client.get(f"/api/houses/{house['id']}").json()["listing"]["photos"] == 42
    assert f"{MEDIA}/200.jpg?options=width=1440" in asked
