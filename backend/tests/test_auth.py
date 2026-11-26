"""OIDC login against a small in-memory provider standing in for Authelia."""

import base64
import hashlib
import json
import secrets
import time
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx2
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import create_app

ISSUER = "https://auth.example.test"


class FakeOIDC:
    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.codes: dict[str, dict] = {}
        self.users: dict[str, dict] = {}

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx2.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/token",
                    "userinfo_endpoint": f"{ISSUER}/userinfo",
                    "jwks_uri": f"{ISSUER}/jwks.json",
                },
            )
        if path == "/jwks.json":
            jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            return httpx2.Response(200, json={"keys": [{**jwk, "kid": "k1", "use": "sig"}]})
        if path == "/userinfo":
            sub = request.headers["authorization"].removeprefix("Bearer ")
            return httpx2.Response(200, json=self.users[sub])
        if path == "/token":
            form = parse_qs(request.content.decode())
            grant = self.codes.pop(form["code"][0])
            verifier = form["code_verifier"][0].encode()
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier).digest()).rstrip(b"=")
            assert challenge.decode() == grant["challenge"]
            now = int(time.time())
            claims = {
                "iss": ISSUER,
                "sub": grant["sub"],
                "aud": "huizenjacht",
                "iat": now,
                "exp": now + 300,
                "nonce": grant["nonce"],
            }
            token = jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "k1"})
            return httpx2.Response(200, json={"access_token": grant["sub"], "id_token": token})
        return httpx2.Response(404)

    def log_in(
        self, client: TestClient, sub: str, groups: list[str], next: str = "/", name: str = "Bram"
    ):
        start = client.get("/api/auth/login", params={"next": next}, follow_redirects=False)
        assert start.status_code == 303, start.text
        query = parse_qs(urlparse(start.headers["location"]).query)
        code = secrets.token_urlsafe(8)
        self.codes[code] = {
            "sub": sub,
            "nonce": query["nonce"][0],
            "challenge": query["code_challenge"][0],
        }
        self.users[sub] = {
            "sub": sub,
            "name": name,
            "preferred_username": sub,
            "email": f"{sub}@example.test",
            "groups": groups,
        }
        return client.get(
            "/api/auth/callback",
            params={"code": code, "state": query["state"][0]},
            follow_redirects=False,
        )


def make(tmp_path: Path, **overrides) -> tuple[TestClient, FakeOIDC]:
    provider = FakeOIDC()
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
        auth_mode="oidc",
        oidc_issuer=ISSUER,
        oidc_client_id="huizenjacht",
        oidc_client_secret="geheim",
        public_url="http://testserver",
    )
    settings = replace(settings, **overrides)
    app = create_app(settings, oidc_transport=httpx2.MockTransport(provider.handle))
    return TestClient(app), provider


def test_api_needs_login_and_login_works(tmp_path):
    client, provider = make(tmp_path)
    with client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/houses").status_code == 401
        assert client.get("/api/auth/me").json() == {"mode": "oidc", "user": None, "admin": False}
        done = provider.log_in(client, "bram", [], next="/#/vergelijk")
        assert done.status_code == 303 and done.headers["location"] == "/#/vergelijk"
        assert client.get("/api/houses").status_code == 200
        assert client.get("/api/auth/me").json()["user"]["name"] == "Bram"
        client.post("/api/auth/logout")
        assert client.get("/api/houses").status_code == 401


def test_only_allowed_groups(tmp_path):
    client, provider = make(tmp_path, allowed_groups=("huizen",))
    with client:
        assert provider.log_in(client, "gast", ["anders"]).status_code == 403
        assert client.get("/api/houses").status_code == 401
        assert provider.log_in(client, "bram", ["huizen"]).status_code == 303
        assert client.get("/api/houses").status_code == 200


def test_next_stays_on_this_site_and_state_is_checked(tmp_path):
    client, provider = make(tmp_path)
    with client:
        assert provider.log_in(client, "bram", [], next="//evil.example").headers["location"] == "/"
        # A stray callback while logged in (old tab, back button) goes back to the app.
        stray = client.get(
            "/api/auth/callback", params={"code": "x", "state": "nope"}, follow_redirects=False
        )
        assert stray.status_code == 303 and stray.headers["location"] == "/"


def test_unknown_login_is_retried_once(tmp_path):
    client, provider = make(tmp_path)
    with client:
        first = client.get(
            "/api/auth/callback", params={"code": "x", "state": "nope"}, follow_redirects=False
        )
        assert first.status_code == 303
        assert first.headers["location"].startswith("/api/auth/login")
        again = client.get(
            "/api/auth/callback", params={"code": "x", "state": "nope"}, follow_redirects=False
        )
        assert again.status_code == 400 and "duurde te lang" in again.text
        # After the error a new login may retry again.
        assert "hj_login_retry" not in client.cookies
        assert provider.log_in(client, "bram", []).status_code == 303


def test_each_person_keeps_own_answers(tmp_path):
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "bram", [], name="Bram de Vries")
        client.post("/api/houses", json={"adres": "Laan 1"})
        client.patch("/api/houses/laan-1", json={"cijfer": 8, "status": "bezichtigd"})
        bram = client.get("/api/people").json()["me"]
        provider.log_in(client, "sanne", [], name="Sanne")
        client.patch("/api/houses/laan-1", json={"cijfer": 6, "checklist": {"a": {"s": "ok"}}})
        people = client.get("/api/people").json()
        sanne = people["me"]
        assert {p["naam"]: p["kleur"] for p in people["people"]} == {"Bram": 0, "Sanne": 1}
        mine = client.get("/api/houses/laan-1").json()["mine"]
        assert mine["status"] == "bezichtigd"
        assert mine["personen"] == {
            bram: {"cijfer": 8},
            sanne: {"cijfer": 6, "checklist": {"a": {"s": "ok"}}},
        }
        client.patch("/api/houses/laan-1", json={"cijfer": None, "checklist": None})
        assert client.get("/api/houses/laan-1").json()["mine"]["personen"] == {bram: {"cijfer": 8}}


def old_version(tmp_path: Path, mine: dict) -> None:
    """A house as a version before 0.6.0 stored it: personal fields at the top."""
    database = Database(tmp_path / "huizenjacht.sqlite")
    database.create_manual("laan-1", mine)
    database.close()


def test_old_answers_go_to_the_only_person_who_logged_in(tmp_path):
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "bram", [])
        me = client.get("/api/people").json()["me"]
    old_version(tmp_path, {"adres": "Laan 1", "cijfer": 7, "status": "nieuw"})
    # Restart: the answers from before 0.6.0 are Bram's, the only login so far.
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "bram", [])
        mine = client.get("/api/houses/laan-1").json()["mine"]
        assert mine == {"adres": "Laan 1", "status": "nieuw", "personen": {me: {"cijfer": 7}}}


def test_old_answers_of_unknown_owner_can_be_claimed(tmp_path):
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "bram", [])
        provider.log_in(client, "sanne", [], name="Sanne")
    old_version(tmp_path, {"adres": "Laan 1", "notities": "Mooi"})
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "sanne", [], name="Sanne")
        people = client.get("/api/people").json()
        assert "eerder" in [p["key"] for p in people["people"]]
        mine = client.get("/api/houses/laan-1").json()["mine"]
        assert mine["personen"] == {"eerder": {"notities": "Mooi"}}
        assert client.post("/api/people/claim").json() == {"houses": 1}
        mine = client.get("/api/houses/laan-1").json()["mine"]
        assert mine["personen"] == {people["me"]: {"notities": "Mooi"}}
        assert "eerder" not in [p["key"] for p in client.get("/api/people").json()["people"]]


def test_only_admins_manage_backups(tmp_path):
    client, provider = make(tmp_path)
    with client:
        provider.log_in(client, "partner", ["huizen"], name="Partner")
        assert client.get("/api/auth/me").json()["admin"] is False
        assert client.get("/api/opslag").status_code == 200
        for path in ("/api/backup", "/api/backup/volledig", "/api/backups"):
            assert client.get(path).status_code == 403, path
        assert client.post("/api/backup/restore", json={}).status_code == 403
        assert client.post("/api/backups/huizenjacht-2026-11-01.zip/restore").status_code == 403
        client.post("/api/auth/logout")
        provider.log_in(client, "bram", ["admins"])
        assert client.get("/api/auth/me").json()["admin"] is True
        assert client.get("/api/backup").status_code == 200
        assert client.get("/api/backup/volledig").status_code == 200
