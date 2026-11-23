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


def load_settings() -> Settings:
    reports = os.environ.get("HJ_REPORTS_DIR", "").strip()
    return Settings(
        data_dir=Path(os.environ.get("HJ_DATA_DIR", "./data")),
        reports_dir=Path(reports) if reports else None,
        reports_scan_interval=int(os.environ.get("HJ_REPORTS_SCAN_INTERVAL", "300")),
        import_token=os.environ.get("HJ_IMPORT_TOKEN", ""),
        version=os.environ.get("HJ_VERSION", "dev"),
        commit_url=os.environ.get("HJ_COMMIT_URL", ""),
        env_label=os.environ.get("HJ_ENV_LABEL", ""),
        env_color=os.environ.get("HJ_ENV_COLOR", "#f0a020"),
        static_dir=Path(os.environ.get("HJ_STATIC_DIR", Path(__file__).parent.parent / "static")),
    )
