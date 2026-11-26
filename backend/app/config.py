"""Settings from the environment (HJ_*)."""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    # SQLite database and uploaded reports. On Kubernetes this is a PersistentVolumeClaim.
    data_dir: Path
    # Read-only folder with reports, such as a git-sync checkout of a private repository.
    # Empty or missing: only uploads.
    reports_dir: Path | None
    # Seconds between scans of reports_dir. 0: only at start and on request.
    reports_scan_interval: int
    # Bearer token for POST /api/import/hook from outside the pod. Empty: only from localhost
    # (the git-sync sidecar).
    import_token: str
    version: str
    commit_url: str
    env_label: str
    env_color: str
    static_dir: Path
    # Login: "none" (put the app behind something that logs people in, or keep it internal)
    # or "oidc" (Authelia, Authentik, Keycloak, ...).
    auth_mode: str = "none"
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_scopes: str = "openid profile email groups"
    # Extra CA certificates (PEM) for a provider with a private CA.
    oidc_ca_pem: str = ""
    # Only these may log in: groups and user names (preferred_username) or e-mail addresses,
    # comma separated. Both empty: everyone the provider lets through.
    allowed_groups: tuple[str, ...] = ()
    allowed_users: tuple[str, ...] = ()
    # With OIDC only these groups may make, download and restore backups.
    admin_groups: tuple[str, ...] = ("admins",)
    # The https address people open the app on. The login redirect goes there.
    public_url: str = ""
    session_days: int = 30
    # Try to fetch each house's listing page (Funda) in the background. Off by default: Funda
    # answers servers with a captcha, so the bookmarklet sends the page instead.
    fetch_listings: bool = False
    # A map of the house in the PDF: the server looks the address up at PDOK and fetches
    # OpenStreetMap tiles (kept in <data>/kaart). Off: nothing about a house leaves the server.
    map_enabled: bool = True
    # The Android app (android/): its id and the SHA-256 fingerprints of its signing key, for
    # /.well-known/assetlinks.json. Chrome then shows the app without an address bar.
    android_package: str = "app.huizenjacht"
    android_cert_fingerprints: tuple[str, ...] = ()
    # Nightly full backup (the same ZIP as Instellingen → Back-up), kept this many days.
    # 0 turns it off. The folder may be its own volume, so a lost data volume keeps them.
    backup_dir: Path | None = None
    backup_time: str = "03:00"
    backup_timezone: str = "Europe/Amsterdam"
    backup_keep_days: int = 5

    @property
    def https(self) -> bool:
        return self.public_url.startswith("https://")


def load_settings() -> Settings:
    reports = os.environ.get("HJ_REPORTS_DIR", "").strip()
    data_dir = Path(os.environ.get("HJ_DATA_DIR", "./data"))
    return Settings(
        data_dir=data_dir,
        reports_dir=Path(reports) if reports else None,
        reports_scan_interval=int(os.environ.get("HJ_REPORTS_SCAN_INTERVAL", "300")),
        import_token=os.environ.get("HJ_IMPORT_TOKEN", ""),
        version=os.environ.get("HJ_VERSION", "dev"),
        commit_url=os.environ.get("HJ_COMMIT_URL", ""),
        env_label=os.environ.get("HJ_ENV_LABEL", ""),
        env_color=os.environ.get("HJ_ENV_COLOR", "#f0a020"),
        static_dir=Path(os.environ.get("HJ_STATIC_DIR", Path(__file__).parent.parent / "static")),
        auth_mode=os.environ.get("HJ_AUTH_MODE", "none").strip().lower(),
        oidc_issuer=os.environ.get("HJ_OIDC_ISSUER", ""),
        oidc_client_id=os.environ.get("HJ_OIDC_CLIENT_ID", ""),
        oidc_client_secret=os.environ.get("HJ_OIDC_CLIENT_SECRET", ""),
        oidc_scopes=os.environ.get("HJ_OIDC_SCOPES", "openid profile email groups"),
        oidc_ca_pem=os.environ.get("HJ_OIDC_CA_PEM", ""),
        allowed_groups=_split(os.environ.get("HJ_ALLOWED_GROUPS", "")),
        allowed_users=_split(os.environ.get("HJ_ALLOWED_USERS", "")),
        admin_groups=_split(os.environ.get("HJ_ADMIN_GROUPS", "admins")),
        public_url=os.environ.get("HJ_PUBLIC_URL", "").rstrip("/"),
        session_days=int(os.environ.get("HJ_SESSION_DAYS", "30")),
        backup_dir=Path(os.environ.get("HJ_BACKUP_DIR", "").strip() or data_dir / "backups"),
        backup_time=os.environ.get("HJ_BACKUP_TIME", "03:00").strip(),
        backup_timezone=os.environ.get("HJ_BACKUP_TIMEZONE", "Europe/Amsterdam").strip(),
        backup_keep_days=int(os.environ.get("HJ_BACKUP_KEEP_DAYS", "5")),
        map_enabled=os.environ.get("HJ_MAP", "true").lower() != "false",
        fetch_listings=os.environ.get("HJ_FETCH_LISTINGS", "false").lower() == "true",
        android_package=os.environ.get("HJ_ANDROID_PACKAGE", "").strip() or "app.huizenjacht",
        android_cert_fingerprints=tuple(
            f.upper() for f in _split(os.environ.get("HJ_ANDROID_CERT_FINGERPRINTS", ""))
        ),
    )


def _split(value: str) -> tuple[str, ...]:
    return tuple(v.strip() for v in value.split(",") if v.strip())
