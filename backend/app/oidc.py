"""Login with an OIDC provider (Authelia, Authentik, Keycloak, ...).

The backend is a confidential client using the authorization code flow with PKCE. The
browser never sees a token: after the callback the app keeps its own session.
"""

import base64
import hashlib
import secrets
import ssl
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode

import httpx2
import jwt

from .config import Settings

# Discovery and keys are fetched again after this many seconds, so key rotation works.
METADATA_TTL = 3600
SIGNING_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384"]


class OIDCError(Exception):
    """Login failed. The message is for the server log; the login screen only gets `code`.

    The codes: "config" (a setting is wrong), "certificate" (the provider's certificate is
    not trusted), "unavailable" (the provider could not be reached or had a problem) and
    "provider" (it did not accept the login).
    """

    def __init__(self, message: str, code: str = "provider") -> None:
        super().__init__(message)
        self.code = code


def _unreachable(message: str, exc: httpx2.HTTPError) -> OIDCError:
    """A request to the provider that got no answer, or an error answer from its server."""
    if "CERTIFICATE_VERIFY_FAILED" in str(exc):
        return OIDCError(f"{message}: {exc}", "certificate")
    if isinstance(exc, httpx2.HTTPStatusError) and exc.response.status_code < 500:
        return OIDCError(f"{message}: {exc}", "config")
    return OIDCError(f"{message}: {exc}", "unavailable")


@dataclass
class LoginRequest:
    """What the callback needs to finish a login, kept in a short-lived cookie."""

    state: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    nonce: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    code_verifier: str = field(default_factory=lambda: secrets.token_urlsafe(48))
    next: str = "/"
    created: float = field(default_factory=time.monotonic)
    # A check of a running session (prompt=none), so the provider must not ask anything:
    # "page" when the whole page went to the provider, "frame" from a hidden frame.
    check: str | None = None

    @property
    def code_challenge(self) -> str:
        digest = hashlib.sha256(self.code_verifier.encode("ascii")).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@dataclass
class Identity:
    """The person the provider logged in."""

    issuer: str
    subject: str
    email: str | None
    name: str | None
    groups: list[str]
    username: str | None = None


class OIDCClient:
    def __init__(self, settings: Settings, transport: httpx2.BaseTransport | None = None) -> None:
        if not (settings.oidc_issuer and settings.oidc_client_id and settings.oidc_client_secret):
            raise OIDCError(
                "Login is not configured: set HJ_OIDC_ISSUER, HJ_OIDC_CLIENT_ID and "
                "HJ_OIDC_CLIENT_SECRET.",
                "config",
            )
        self.issuer = settings.oidc_issuer.rstrip("/")
        self.client_id = settings.oidc_client_id
        self.client_secret = settings.oidc_client_secret
        self.scopes = settings.oidc_scopes
        self.ssl_context = _ssl_context(settings.oidc_ca_pem)
        self._http = httpx2.Client(transport=transport, timeout=15, verify=self.ssl_context or True)
        self._lock = threading.Lock()
        self._metadata: dict[str, Any] | None = None
        self._jwks: jwt.PyJWKSet | None = None
        self._fetched_at = 0.0

    def authorization_url(self, login: LoginRequest, redirect_uri: str) -> str:
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "scope": self.scopes,
            "state": login.state,
            "nonce": login.nonce,
            "code_challenge": login.code_challenge,
            "code_challenge_method": "S256",
        }
        if login.check:
            params["prompt"] = "none"
        return f"{self._meta('authorization_endpoint')}?{urlencode(params)}"

    def finish_login(self, login: LoginRequest, code: str, redirect_uri: str) -> Identity:
        """Exchange the code, check the ID token and read the user's claims."""
        tokens = self._post_token(code, redirect_uri, login.code_verifier)
        claims = self._verify_id_token(tokens.get("id_token"), login.nonce)
        # Authelia puts only the minimum in the ID token; name, email and groups come
        # from the userinfo endpoint.
        if tokens.get("access_token") and self._metadata_value("userinfo_endpoint"):
            info = self._userinfo(tokens["access_token"])
            if info.get("sub") != claims["sub"]:
                raise OIDCError("The login provider returned details for another user.")
            # Who logged in stays what the checked ID token says.
            claims = {**claims, **info, "iss": claims["iss"]}
        groups = claims.get("groups") or []
        return Identity(
            issuer=claims["iss"],
            subject=claims["sub"],
            email=claims.get("email"),
            name=claims.get("name") or claims.get("preferred_username"),
            groups=[groups] if isinstance(groups, str) else [str(g) for g in groups],
            username=claims.get("preferred_username"),
        )

    def _post_token(self, code: str, redirect_uri: str, code_verifier: str) -> dict[str, Any]:
        try:
            response = self._http.post(
                self._meta("token_endpoint"),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
                # client_secret_basic: RFC 6749 wants both parts form-encoded first.
                auth=(quote(self.client_id, safe=""), quote(self.client_secret, safe="")),
            )
        except httpx2.HTTPError as exc:
            raise _unreachable("Could not reach the login provider", exc) from exc
        if response.status_code >= 500:
            raise OIDCError(f"The login provider failed: {_error_text(response)}", "unavailable")
        if response.status_code != 200:
            raise OIDCError(f"The login provider refused the login: {_error_text(response)}")
        return response.json()

    def _userinfo(self, access_token: str) -> dict[str, Any]:
        try:
            response = self._http.get(
                self._meta("userinfo_endpoint"),
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
        except httpx2.HTTPError as exc:
            raise _unreachable("Could not reach the login provider", exc) from exc
        if response.status_code >= 500:
            raise OIDCError(f"The login provider failed: {_error_text(response)}", "unavailable")
        if response.status_code != 200:
            raise OIDCError(f"Could not read your user details: {_error_text(response)}")
        if not response.headers.get("content-type", "").startswith("application/json"):
            # A signed userinfo answer (application/jwt) is not supported; the ID token's
            # claims are used on their own then.
            return {}
        return response.json()

    def _verify_id_token(self, id_token: str | None, nonce: str) -> dict[str, Any]:
        if not id_token:
            raise OIDCError("The login provider did not return an ID token.")
        try:
            header = jwt.get_unverified_header(id_token)
            key = self._signing_key(header.get("kid"))
            claims = jwt.decode(
                id_token,
                key,
                algorithms=SIGNING_ALGORITHMS,
                audience=self.client_id,
                issuer=self._meta("issuer"),
                options={"require": ["iss", "sub", "aud", "exp", "iat"]},
                leeway=60,
            )
        except jwt.PyJWTError as exc:
            raise OIDCError(f"The login provider's ID token is not valid: {exc}") from exc
        if claims.get("nonce") != nonce:
            raise OIDCError("The login answer does not belong to this login.", "expired")
        return claims

    def _signing_key(self, kid: str | None) -> jwt.PyJWK:
        for refresh in (False, True):
            if refresh:
                self._load(force=True)
            elif self._jwks is None:
                self._load()
            assert self._jwks is not None
            keys = [k for k in self._jwks.keys if k.public_key_use in (None, "sig")]
            for key in keys:
                if kid is None or key.key_id == kid:
                    return key
        raise OIDCError("The ID token is signed with a key the login provider does not list.")

    def _meta(self, name: str) -> str:
        value = self._metadata_value(name)
        if not value:
            raise OIDCError(f"The login provider's discovery document has no {name}.", "config")
        return value

    def _metadata_value(self, name: str) -> str | None:
        self._load()
        assert self._metadata is not None
        return self._metadata.get(name)

    def _load(self, force: bool = False) -> None:
        """Fetch the discovery document and signing keys, cached for METADATA_TTL."""
        with self._lock:
            fresh = time.monotonic() - self._fetched_at < METADATA_TTL
            if self._metadata is not None and fresh and not force:
                return
            url = f"{self.issuer}/.well-known/openid-configuration"
            try:
                metadata = self._http.get(url).raise_for_status().json()
                jwks = self._http.get(metadata["jwks_uri"]).raise_for_status().json()
            except httpx2.HTTPError as exc:
                message = f"Could not read the login provider's settings at {url}"
                raise _unreachable(message, exc) from exc
            except (ValueError, KeyError) as exc:
                raise OIDCError(
                    f"Could not read the login provider's settings at {url}: {exc}", "config"
                ) from exc
            if metadata.get("issuer", "").rstrip("/") != self.issuer:
                raise OIDCError(
                    f"HJ_OIDC_ISSUER is {self.issuer}, but the provider calls itself "
                    f"{metadata.get('issuer')}. Use the provider's value.",
                    "config",
                )
            try:
                self._jwks = jwt.PyJWKSet.from_dict(jwks)
            except jwt.PyJWTError as exc:
                raise OIDCError(
                    f"Could not read the login provider's keys: {exc}", "config"
                ) from exc
            self._metadata = metadata
            self._fetched_at = time.monotonic()


def _ssl_context(ca_pem: str | None) -> ssl.SSLContext | None:
    """httpx2's usual trust store plus the extra CAs, or None without them."""
    if not (ca_pem and ca_pem.strip()):
        return None
    # The system's CAs (through truststore), or SSL_CERT_FILE when set: what httpx2 would
    # use anyway.
    context = httpx2.create_ssl_context()
    try:
        context.load_verify_locations(cadata=ca_pem)
    except ssl.SSLError as exc:
        raise OIDCError(f"HJ_OIDC_CA_PEM holds no valid PEM certificate: {exc}", "config") from exc
    return context


def _error_text(response: httpx2.Response) -> str:
    try:
        body = response.json()
        return body.get("error_description") or body.get("error") or f"HTTP {response.status_code}"
    except ValueError:
        return f"HTTP {response.status_code}"
