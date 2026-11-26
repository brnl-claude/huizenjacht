"""Checks from the security review of 0.19.x."""

import httpx2
from test_api import make_client
from test_funda import URL, make_custom

from app.funda import is_photo_host
from app.main import MAX_LISTING_PAGE


def test_bookmarklet_page_refuses_a_huge_body_before_reading_it(tmp_path):
    with make_client(tmp_path) as client:
        res = client.post(
            "/api/bookmarklet/page",
            content=b"x" * (MAX_LISTING_PAGE + 1),
            headers={"content-type": "text/plain"},
        )
        assert res.status_code == 413


def test_an_svg_photo_never_runs_as_a_page(tmp_path):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    with make_client(tmp_path) as client:
        house = client.post("/api/houses", json={"adres": "Kade 2"}).json()["id"]
        media = client.post(
            f"/api/houses/{house}/media", files={"file": ("x.svg", svg, "image/svg+xml")}
        ).json()
        got = client.get(f"/api/media/{media['id']}")
        assert got.headers["x-content-type-options"] == "nosniff"
        assert got.headers["content-security-policy"].startswith("sandbox")


def test_every_answer_has_security_headers(tmp_path):
    with make_client(tmp_path) as client:
        res = client.get("/api/health")
        assert res.headers["x-frame-options"] == "SAMEORIGIN"
        assert res.headers["x-content-type-options"] == "nosniff"


def test_a_broken_backup_keeps_the_houses(tmp_path):
    with make_client(tmp_path) as client:
        client.post("/api/houses", json={"adres": "Kade 2"})
        backup = client.get("/api/backup").json()
        broken = {**backup, "houses": [*backup["houses"], {"id": "x"}]}
        assert client.post("/api/backup/restore", json=broken).status_code == 400
        sneaky = {**backup, "houses": [{**backup["houses"][0], "id": "../../etc"}]}
        assert client.post("/api/backup/restore", json=sneaky).status_code == 400
        # Another change commits nothing half-done.
        client.put("/api/settings/checklist", json={"value": [1]})
        assert len(client.get("/api/houses").json()) == 1


def test_photos_only_from_funda():
    assert is_photo_host("https://cloud.funda.nl/valentina_media/1/2.jpg")
    assert not is_photo_host("http://cloud.funda.nl/x.jpg")
    assert not is_photo_host("https://funda.nl.evil.example/x.jpg")
    assert not is_photo_host("https://10.0.0.1/x.jpg")


def test_page_naming_an_internal_address_is_not_fetched(tmp_path):
    asked: list[str] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        asked.append(str(request.url))
        if request.url.host == "cloud.funda.nl" and "redirect" in request.url.path:
            return httpx2.Response(302, headers={"location": "http://169.254.169.254/latest"})
        return httpx2.Response(200, content=b"jpg", headers={"content-type": "image/jpeg"})

    page = (
        '<html><head><meta property="og:title" content="Laan 1">'
        '<meta property="og:image" content="http://kubernetes.default/secret.png"></head>'
        '<body><img src="https://cloud.funda.nl/valentina_media/1/redirect.jpg"></body></html>'
    )
    with make_custom(tmp_path, handle) as client:
        house = client.post("/api/houses", json={"adres": "Laan 1", "url": URL}).json()
        client.post(f"/api/houses/{house['id']}/listing/import", json={"url": URL, "html": page})
    assert not any("kubernetes" in u or "169.254" in u for u in asked), asked


def test_documents_other_than_pdf_or_images_only_download(tmp_path):
    reports = tmp_path / "reports"
    (reports / "documenten" / "laan-1").mkdir(parents=True)
    (reports / "laan-1.md").write_text("# Laan 1\n")
    (reports / "documenten" / "laan-1" / "a.pdf").write_bytes(b"%PDF-1.4")
    (reports / "documenten" / "laan-1" / "b.xht").write_text("<html><script>x</script></html>")
    with make_client(tmp_path, reports) as client:
        client.post("/api/import/scan")
        pdf = client.get("/api/houses/laan-1/documenten/a.pdf")
        assert pdf.headers["content-disposition"].startswith("inline")
        page = client.get("/api/houses/laan-1/documenten/b.xht")
        assert page.headers["content-disposition"].startswith("attachment")
