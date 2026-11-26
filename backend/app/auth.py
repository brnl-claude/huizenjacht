"""Login with OIDC (HJ_AUTH_MODE=oidc), such as Authelia.

The backend is a confidential client (authorization code flow with PKCE, see app.oidc). After
the callback it keeps its own session: a random token in an HttpOnly cookie, its hash in
SQLite. Every /api/ path needs that session, except the health check, the login itself and
the import hook (which has its own check).
"""

import hashlib
import html
import json
import logging
import secrets
import threading
import time
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from . import pairing
from .config import Settings
from .db import Database
from .oidc import Identity, LoginRequest, OIDCClient, OIDCError

log = logging.getLogger("huizenjacht.auth")

SESSION_COOKIE = "hj_session"
STATE_COOKIE = "hj_login"
# Set while the app retries a login that came back without a matching start (another tab,
# another browser container, a restart): it retries once, then shows the error.
RETRY_COOKIE = "hj_login_retry"
RETRY_TTL = 120
# Set after a login through the provider: this browser can do that, so /api/auth/start goes
# straight on instead of offering the phone. Not secret.
VIA_COOKIE = "hj_via"
# A login must come back from the provider within this many seconds.
LOGIN_TTL = 600
MAX_PENDING = 1000
# The bookmarklet page endpoint checks its own token (the browser sends no cookie there).
OPEN_PATHS = ("/api/health", "/api/auth/", "/api/import/hook", "/api/bookmarklet/page")


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


def is_admin(user: dict[str, Any] | None, settings: Settings) -> bool:
    """May manage backups (make, download, restore). Without login everyone may."""
    if settings.auth_mode != "oidc":
        return True
    if user is None:
        return False
    return any(g in settings.admin_groups for g in user.get("groups") or [])


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


def user_of(request: Request) -> dict[str, Any] | None:
    """The logged-in user of a request, or None without OIDC."""
    current_user = getattr(request.app.state, "current_user", None)
    return current_user(request) if current_user else None


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

    def start_session(
        response: Response, user: dict[str, Any], device: str, via: str = "telefoon"
    ) -> None:
        """A new login for `user` on the device that gets `response`."""
        token = secrets.token_urlsafe(32)
        database().create_session(
            _hash(token),
            {
                "subject": user["subject"],
                "name": user.get("name"),
                "email": user.get("email"),
                # A phone login (pairing) gets the groups of the login that approved it.
                "groups": user.get("groups") or [],
            },
            settings.session_days,
            device=device,
            via=via,
        )
        response.set_cookie(
            cookie_name(SESSION_COOKIE, settings),
            token,
            max_age=settings.session_days * 86400,
            path="/",
            httponly=True,
            secure=settings.https,
            samesite="lax",
        )

    @router.get("/start")
    def start(request: Request, next: str | None = None) -> Response:
        """Where the app sends someone who is not logged in: straight to the provider when this
        browser has logged in there before, otherwise a choice, with a QR code for the phone."""
        target = safe_next(next)
        if settings.auth_mode != "oidc" or current_user(request) is not None:
            return RedirectResponse(target, status_code=303)
        login = f"/api/auth/login?next={quote(target, safe='')}"
        if request.cookies.get(cookie_name(VIA_COOKIE, settings)) == "oidc":
            return RedirectResponse(login, status_code=303)
        return HTMLResponse(
            start_page(login, target),
            headers={"Cache-Control": "no-store"},
        )

    @router.get("/sessions")
    def sessions(request: Request) -> dict[str, Any]:
        user = current_user(request)
        if user is None:
            raise HTTPException(401, "Log eerst in.")
        token = request.cookies.get(cookie_name(SESSION_COOKIE, settings), "")
        return {
            "current": _hash(token)[:16],
            "sessions": database().list_sessions(user["subject"]),
        }

    @router.delete("/sessions/{session_id}", status_code=204)
    def end_one(session_id: str, request: Request) -> Response:
        user = current_user(request)
        if user is None:
            raise HTTPException(401, "Log eerst in.")
        if not database().end_session_of(user["subject"], session_id):
            raise HTTPException(404, "Deze login bestaat niet (meer).")
        return Response(status_code=204)

    if settings.auth_mode == "oidc":
        pairing.add_routes(
            router,
            public_url=settings.public_url,
            https=settings.https,
            cookie_name=lambda name: cookie_name(name, settings),
            current_user=current_user,
            start_session=start_session,
        )

    @router.get("/me")
    def me(request: Request) -> dict[str, Any]:
        if settings.auth_mode != "oidc":
            return {"mode": "none", "user": None, "admin": True}
        user = current_user(request)
        return {"mode": "oidc", "user": user, "admin": is_admin(user, settings)}

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
            # Anyone can start a login: keep memory bounded, dropping the oldest attempts.
            while len(pending) >= MAX_PENDING:
                del pending[next(iter(pending))]
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
            if current_user(request) is not None:
                # Already logged in, say from an old tab or the back button.
                return RedirectResponse(attempt.next if attempt else "/", status_code=303)
            retry_cookie = cookie_name(RETRY_COOKIE, settings)
            if request.cookies.get(retry_cookie):
                failed = error_page("expired")
                failed.delete_cookie(retry_cookie, path="/")
                return failed
            # Start the login once more in this browser; the provider usually still knows
            # the user, so this is a quick round trip without a question.
            log.info("Login came back without a matching start; trying once more")
            again = RedirectResponse(
                f"/api/auth/login?next={quote(attempt.next if attempt else '/', safe='')}",
                status_code=303,
            )
            again.set_cookie(
                retry_cookie,
                "1",
                max_age=RETRY_TTL,
                path="/",
                httponly=True,
                secure=settings.https,
                samesite="lax",
            )
            return again
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
        response = RedirectResponse(attempt.next, status_code=303)
        start_session(
            response,
            {
                "subject": f"{identity.issuer}|{identity.subject}",
                "name": identity.name,
                "email": identity.email,
                "groups": identity.groups,
            },
            pairing.device_name(request.headers.get("user-agent", "")),
            via="oidc",
        )
        response.set_cookie(
            cookie_name(VIA_COOKIE, settings),
            "oidc",
            max_age=365 * 86400,
            path="/",
            secure=settings.https,
            samesite="lax",
        )
        response.delete_cookie(cookie_name(STATE_COOKIE, settings), path="/")
        response.delete_cookie(cookie_name(RETRY_COOKIE, settings), path="/")
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
    app.state.current_user = current_user if settings.auth_mode == "oidc" else None

    if settings.auth_mode != "oidc":
        return

    @app.middleware("http")
    async def require_login(request: Request, call_next):
        path = request.url.path
        protected = path.startswith("/api/") and not path.startswith(OPEN_PATHS)
        if protected and current_user(request) is None:
            return JSONResponse(
                {"detail": "Log eerst in.", "login": "/api/auth/start"}, status_code=401
            )
        return await call_next(request)


def start_page(login: str, target: str) -> str:
    """The choice for a device that is not logged in. The phone option starts a pairing and
    asks for its outcome every two seconds (see app.pairing)."""
    login_attr = html.escape(login, quote=True)
    # A script block: "<" escaped, so the address can never close it.
    target_js = json.dumps(target).replace("<", "\\u003c")
    return f"""<!doctype html><html lang="nl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Inloggen</title>
<style>body{{font-family:system-ui,sans-serif;background:#f4f4f4;color:#2b2b2b;display:grid;
place-items:center;min-height:100vh;margin:0}}main{{background:#fff;border-radius:12px;padding:28px;
max-width:420px;margin:16px;box-shadow:0 4px 14px rgb(0 0 0/8%)}}h1{{margin-top:0}}
.btn{{display:inline-block;background:#f7a100;color:#fff;padding:12px 20px;border-radius:8px;
text-decoration:none;font-weight:650;border:0;font-size:1rem;cursor:pointer}}
.ghost{{background:#fff;color:#0071b3;border:1px solid #ccc}}#qr svg{{width:100%;max-width:260px;
height:auto;display:block;margin:12px auto}}.code{{font-size:2rem;letter-spacing:.3em;
text-align:center;font-weight:700;margin:4px 0}}.muted{{color:#666}}[hidden]{{display:none}}</style>
<main><h1>Inloggen</h1>
<p><a class="btn" href="{login_attr}">Inloggen</a></p>
<p class="muted">Lukt inloggen op dit apparaat niet? Log in via je telefoon.</p>
<p><button class="btn ghost" id="phone" type="button">Inloggen met je telefoon</button></p>
<section id="pair" hidden>
<p>Scan deze code met de camera van je telefoon, waarop je al bent ingelogd in Huizenjacht.</p>
<div id="qr"></div>
<p class="muted">Controleer dat je telefoon deze code toont:</p><p class="code" id="code"></p>
<p class="muted" id="state">Wacht op je telefoon…</p></section></main>
<script>
const next = {target_js};
const say = (t) => (document.getElementById("state").textContent = t);
let timer, started = 0;
async function begin() {{
  clearInterval(timer);
  started = Date.now();
  const r = await fetch("/api/auth/pair", {{ method: "POST" }});
  if (!r.ok) return say("Dat lukte niet. Probeer het opnieuw.");
  const p = await r.json();
  document.getElementById("pair").hidden = false;
  document.getElementById("qr").innerHTML = p.qr;
  document.getElementById("code").textContent = p.code;
  say("Wacht op je telefoon…");
  timer = setInterval(check, 2000);
}}
async function check() {{
  const r = await fetch("/api/auth/pair/status", {{ cache: "no-store" }}).catch(() => null);
  if (!r || !r.ok) return;
  const s = (await r.json()).status;
  if (s === "approved") {{ clearInterval(timer); say("Ingelogd."); location.replace(next); }}
  else if (s === "denied") {{ clearInterval(timer); say("Geweigerd op je telefoon."); }}
  else if (s === "expired" && Date.now() - started < 240000) {{
    clearInterval(timer);
    say("Dit apparaat bewaart geen cookies; zo lukt inloggen met je telefoon niet.");
  }}
  else if (s === "expired") {{ say("De code is verlopen; er komt een nieuwe."); begin(); }}
}}
document.getElementById("phone").addEventListener("click", begin);
</script></html>"""
