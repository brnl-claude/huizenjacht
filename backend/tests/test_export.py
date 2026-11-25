from test_api import make_client


def test_pdf_handed_back_as_download(tmp_path):
    with make_client(tmp_path) as client:
        pdf = b"%PDF-1.7\n" + b"0" * 200
        res = client.post(
            "/api/export",
            params={"naam": "Huizenjacht - Kade 2/Delft.pdf"},
            content=pdf,
            headers={"Content-Type": "application/pdf"},
        )
        assert res.status_code == 200
        url = res.json()["url"]
        assert url.startswith("/api/export/") and url.endswith("Kade%202Delft.pdf")
        got = client.get(url)
        assert got.content == pdf and got.headers["content-type"] == "application/pdf"
        assert "attachment" in got.headers["content-disposition"]
        assert client.get("/api/export/onbekend/x.pdf").status_code == 404


def test_only_pdf(tmp_path):
    with make_client(tmp_path) as client:
        assert client.post("/api/export", content=b"<html>").status_code == 400
