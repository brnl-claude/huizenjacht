"""Login with OIDC (HJ_AUTH_MODE=oidc), such as Authelia.

The backend is a confidential client (authorization code flow with PKCE, see app.oidc). After
the callback it keeps its own session: a random token in an HttpOnly cookie, its hash in
SQLite. Every /api/ path needs that session, except the health check, the login itself and
the import hook (which has its own check).
"""

import hashlib
import html
import logging
import secrets
import threading
import time
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from .config import Settings
from .db import Database
from .oidc import Identity, LoginRequest, OIDCClient, OIDCError

log = logging.getLogger("huizenjacht.auth")

SESSION_COOKIE = "hj_session"
STATE_COOKIE = "hj_login"
# A login must come back from the provider within this many seconds.
LOGIN_TTL = 600
OPEN_PATHS = ("/api/health", "/api/auth/", "/api/import/hook")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def cookie_name(name: str, settings: Settings) -> str:
    # With https the __Host- prefix: only this exact host can set the cookie.
    return f"__Host-{name}" if settings.https else name


def safe_next(value: str | None) -> str:
    """Only a path in this app, never another site."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value


def is_allowed(identity: Identity, settings: Settings) -> bool:
    if not settings.allowed_groups and not settings.allowed_users:
        return True
    names = {identity.subject, identity.email, identity.username} - {None, ""}
    if any(u in names for u in settings.allowed_users):
        return True
    return any(g in identity.groups for g in settings.allowed_groups)


ERRORS = {
    "denied": "Je account heeft geen toegang tot Huizenjacht.",
    "expired": "Het inloggen duurde te lang of is in een ander tabblad begonnen.",
    "config": "De login is niet goed ingesteld. Kijk in de serverlog.",
    "certificate": "Het certificaat van de loginprovider wordt niet vertrouwd.",
    "unavailable": "De loginprovider is nu niet bereikbaar.",
    "provider": "De loginprovider heeft het inloggen niet geaccepteerd.",
}


def error_page(code: str, status: int = 400) -> HTMLResponse:
    text = html.escape(ERRORS.get(code, ERRORS["provider"]))
    body = f"""<!doctype html><html lang="nl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Inloggen mislukt</title>
<style>body{{font-family:system-ui,sans-serif;background:#f4f4f4;color:#2b2b2b;display:grid;
place-items:center;min-height:100vh;margin:0}}main{{background:#fff;border-radius:12px;padding:28px;
max-width:420px;margin:16px;box-shadow:0 4px 14px rgb(0 0 0/8%)}}a{{display:inline-block;
margin-top:12px;background:#f7a100;color:#fff;padding:10px 18px;border-radius:8px;
text-decoration:none;font-weight:650}}</style>
<main><h1>Inloggen mislukt</h1><p>{text}</p><a href="/api/auth/login">Opnieuw inloggen</a></main>"""
    return HTMLResponse(body, status_code=status)


def install(app: FastAPI, settings: Settings, db: Any, transport: Any = None) -> None:
    """Add the login routes and the check on every API request."""
    if settings.auth_mode not in {"none", "oidc"}:
        raise RuntimeError(f"HJ_AUTH_MODE must be none or oidc, not {settings.auth_mode!r}.")
    if settings.auth_mode == "oidc" and not settings.public_url:
        raise RuntimeError("Set HJ_PUBLIC_URL (such as https://huizen.example.com) for OIDC.")
    router = APIRouter(prefix="/api/auth")
    pending: dict[str, LoginRequest] = {}
    pending_lock = threading.Lock()
    client: list[OIDCClient] = []

    def oidc() -> OIDCClient:
        if not client:
            client.append(OIDCClient(settings, transport=transport))
        return client[0]

    def redirect_uri(request: Request) -> str:
        # Never an address from request headers: HJ_PUBLIC_URL is required with OIDC.
        return f"{settings.public_url}/api/auth/callback"

    def database() -> Database:
        return db()

    def current_user(request: Request) -> dict[str, Any] | None:
        token = request.cookies.get(cookie_name(SESSION_COOKIE, settings))
        return database().find_session(_hash(token)) if token else None

    @router.get("/me")
    def me(request: Request) -> dict[str, Any]:
        if settings.auth_mode != "oidc":
            return {"mode": "none", "user": None}
        return {"mode": "oidc", "user": current_user(request)}

    @router.get("/login")
    def login(request: Request, next: str | None = None) -> Response:
        if settings.auth_mode != "oidc":
            return RedirectResponse("/", status_code=303)
        attempt = LoginRequest(next=safe_next(next))
        try:
            url = oidc().authorization_url(attempt, redirect_uri(request))
        except OIDCError as exc:
            log.error("Login failed to start: %s", exc)
            return error_page(exc.code, 502 if exc.code == "unavailable" else 500)
        with pending_lock:
            cutoff = time.monotonic() - LOGIN_TTL
            for key in [k for k, v in pending.items() if v.created < cutoff]:
                del pending[key]
            pending[attempt.state] = attempt
        response = RedirectResponse(url, status_code=303)
        response.set_cookie(
            cookie_name(STATE_COOKIE, settings),
            attempt.state,
            max_age=LOGIN_TTL,
            path="/",
            httponly=True,
            secure=settings.https,
            samesite="lax",
        )
        return response

    @router.get("/callback")
    def callback(
        request: Request,
        code: str | None = None,
        state: str | None = None,
        error: str | None = None,
    ) -> Response:
        if settings.auth_mode != "oidc":
            return RedirectResponse("/", status_code=303)
        cookie = request.cookies.get(cookie_name(STATE_COOKIE, settings))
        with pending_lock:
            attempt = pending.pop(state, None) if state else None
        if (
            not attempt
            or not cookie
            or not secrets.compare_digest(cookie, attempt.state)
            or attempt.created < time.monotonic() - LOGIN_TTL
        ):
            return error_page("expired")
        if error or not code:
            log.warning("The provider returned no code: %s", error)
            return error_page("denied" if error == "access_denied" else "provider", 403)
        try:
            identity = oidc().finish_login(attempt, code, redirect_uri(request))
        except OIDCError as exc:
            log.error("Login failed: %s", exc)
            return error_page(exc.code, 502 if exc.code == "unavailable" else 400)
        if not is_allowed(identity, settings):
            log.warning(
                "Refused %s (%s): not in the allowed users or groups",
                identity.subject,
                identity.email,
            )
            return error_page("denied", 403)
        token = secrets.token_urlsafe(32)
        database().create_session(
            _hash(token),
            {
                "subject": f"{identity.issuer}|{identity.subject}",
                "name": identity.name,
                "email": identity.email,
            },
            settings.session_days,
        )
        response = RedirectResponse(attempt.next, status_code=303)
        response.set_cookie(
            cookie_name(SESSION_COOKIE, settings),
            token,
            max_age=settings.session_days * 86400,
            path="/",
            httponly=True,
            secure=settings.https,
            samesite="lax",
        )
        response.delete_cookie(cookie_name(STATE_COOKIE, settings), path="/")
        return response

    @router.post("/logout")
    def logout(request: Request) -> Response:
        token = request.cookies.get(cookie_name(SESSION_COOKIE, settings))
        if token:
            database().end_session(_hash(token))
        response = JSONResponse({"status": "logged out"})
        response.delete_cookie(
            cookie_name(SESSION_COOKIE, settings),
            path="/",
            httponly=True,
            secure=settings.https,
            samesite="lax",
        )
        return response

    app.include_router(router)

    if settings.auth_mode != "oidc":
        return

    @app.middleware("http")
    async def require_login(request: Request, call_next):
        path = request.url.path
        protected = path.startswith("/api/") and not path.startswith(OPEN_PATHS)
        if protected and current_user(request) is None:
            return JSONResponse(
                {"detail": "Log eerst in.", "login": "/api/auth/login"}, status_code=401
            )
        return await call_next(request)
