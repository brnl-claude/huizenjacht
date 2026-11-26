"""Log in another device (a tablet that cannot reach the login provider) from a phone.

1. The new device opens /api/auth/start and chooses "with my phone". It gets a pairing: a
   public id (in a QR code) and a secret that only it holds, in an HttpOnly cookie.
2. A phone that is logged in scans the QR code, opens #/koppel/<id> and sees the device and
   a short code. When the same code is on the new device, the person approves.
3. The new device asks for the outcome with its secret and gets a login of its own for the
   approver. The pairing is gone after that, and after a few minutes in any case.

Seeing the QR code is not enough to log in: the login only goes to the device with the
secret. Every login shows up under Instellingen → Ingelogd, where it can be ended.
"""

import hashlib
import io
import re
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import segno
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

PAIR_COOKIE = "hj_pair"
PAIR_TTL = 300
MAX_PAIRS = 50


@dataclass
class Pairing:
    secret_hash: str
    device: str
    code: str = field(default_factory=lambda: f"{secrets.randbelow(1_000_000):06d}")
    created: float = field(default_factory=time.monotonic)
    approved_by: dict[str, Any] | None = None
    denied: bool = False

    @property
    def expired(self) -> bool:
        return time.monotonic() - self.created > PAIR_TTL


def device_name(user_agent: str) -> str:
    """A rough name for a device from its User-Agent, such as "Android-tablet (Chrome)"."""
    ua = user_agent or ""
    if "iPad" in ua or ("Macintosh" in ua and "Mobile" in ua):
        kind = "iPad"
    elif "iPhone" in ua:
        kind = "iPhone"
    elif "Android" in ua:
        kind = "Android-telefoon" if "Mobile" in ua else "Android-tablet"
    elif "Windows" in ua:
        kind = "Windows-computer"
    elif "Macintosh" in ua:
        kind = "Mac"
    elif "Linux" in ua:
        kind = "Linux-computer"
    else:
        kind = "Onbekend apparaat"
    for pattern, browser in (
        (r"Huizenjacht/", "Huizenjacht-app"),
        (r"Edg/", "Edge"),
        (r"Firefox/", "Firefox"),
        (r"(Chrome|CriOS)/", "Chrome"),
        (r"Safari/", "Safari"),
    ):
        if re.search(pattern, ua):
            return f"{kind} ({browser})"
    return kind


def qr_svg(text: str) -> str:
    out = io.BytesIO()
    segno.make(text, error="m").save(
        out, kind="svg", scale=6, border=2, xmldecl=False, dark="#2b2b2b", light="#ffffff"
    )
    return out.getvalue().decode()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def add_routes(
    router: APIRouter,
    *,
    public_url: str,
    https: bool,
    cookie_name: Callable[[str], str],
    current_user: Callable[[Request], dict[str, Any] | None],
    start_session: Callable[[JSONResponse, dict[str, Any], str], None],
) -> None:
    """The pairing routes, on the /api/auth router (which needs no login: each route that
    acts for a person checks that someone is logged in itself)."""
    pairs: dict[str, Pairing] = {}
    lock = threading.Lock()

    def tidy() -> None:
        for key in [k for k, p in pairs.items() if p.expired]:
            del pairs[key]

    def logged_in(request: Request) -> dict[str, Any]:
        user = current_user(request)
        if user is None:
            raise HTTPException(401, "Log eerst in op dit apparaat.")
        return user

    def open_pairing(pair_id: str) -> Pairing:
        with lock:
            tidy()
            pair = pairs.get(pair_id)
        if not pair or pair.denied or pair.approved_by:
            raise HTTPException(404, "Deze QR-code is verlopen of al gebruikt.")
        return pair

    @router.post("/pair")
    def start(request: Request) -> JSONResponse:
        secret = secrets.token_urlsafe(32)
        pair_id = secrets.token_urlsafe(16)
        pair = Pairing(_hash(secret), device_name(request.headers.get("user-agent", "")))
        with lock:
            tidy()
            # Anyone can start one: keep memory bounded, dropping the oldest.
            while len(pairs) >= MAX_PAIRS:
                del pairs[next(iter(pairs))]
            pairs[pair_id] = pair
        url = f"{public_url}/#/koppel/{pair_id}"
        response = JSONResponse(
            {"code": pair.code, "url": url, "qr": qr_svg(url), "seconds": PAIR_TTL},
            headers={"Cache-Control": "no-store"},
        )
        response.set_cookie(
            cookie_name(PAIR_COOKIE),
            secret,
            max_age=PAIR_TTL,
            path="/",
            httponly=True,
            secure=https,
            samesite="strict",
        )
        return response

    @router.get("/pair/status")
    def status(request: Request) -> JSONResponse:
        """Asked by the new device every few seconds, with its secret cookie."""
        secret = request.cookies.get(cookie_name(PAIR_COOKIE), "")
        wanted = _hash(secret) if secret else None
        with lock:
            tidy()
            found = next(
                (
                    (k, p)
                    for k, p in pairs.items()
                    if wanted and secrets.compare_digest(p.secret_hash, wanted)
                ),
                None,
            )
            if found and (found[1].approved_by or found[1].denied):
                # One login per pairing: gone the moment its outcome is collected.
                del pairs[found[0]]
        headers = {"Cache-Control": "no-store"}
        if not found:
            return JSONResponse({"status": "expired"}, headers=headers)
        pair = found[1]
        if pair.denied:
            return JSONResponse({"status": "denied"}, headers=headers)
        if not pair.approved_by:
            return JSONResponse({"status": "pending"}, headers=headers)
        response = JSONResponse({"status": "approved"}, headers=headers)
        start_session(response, pair.approved_by, pair.device)
        response.delete_cookie(cookie_name(PAIR_COOKIE), path="/")
        return response

    @router.get("/pair/{pair_id}")
    def show(pair_id: str, request: Request) -> dict[str, Any]:
        logged_in(request)
        pair = open_pairing(pair_id)
        return {"code": pair.code, "device": pair.device}

    @router.post("/pair/{pair_id}/approve")
    def approve(pair_id: str, request: Request) -> dict[str, str]:
        user = logged_in(request)
        with lock:
            pair = pairs.get(pair_id)
            if not pair or pair.expired or pair.denied or pair.approved_by:
                raise HTTPException(404, "Deze QR-code is verlopen of al gebruikt.")
            pair.approved_by = dict(user)
        return {"status": "approved", "device": pair.device}

    @router.post("/pair/{pair_id}/deny")
    def deny(pair_id: str, request: Request) -> dict[str, str]:
        logged_in(request)
        with lock:
            pair = pairs.get(pair_id)
            if pair and not pair.approved_by:
                pair.denied = True
        return {"status": "denied"}
