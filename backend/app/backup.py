"""Disk usage and the full backup: a ZIP with the JSON backup plus every file behind it.

ZIP layout:
    huizenjacht.json             the JSON backup, plus the media and listing rows ("files")
    media/<id>, media/<id>.thumb.jpg
    advertenties/<house id>/...  the saved copy of each listing (page and photos)
    documenten/<house id>/...    the documents from the reports repository (not restored:
                                 they come back from that repository)

The ZIP is written while it downloads, so a large backup needs no room on the server.
"""

import json
import re
import shutil
import time
import zipfile
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import IO, Any

from .db import Database

BACKUP_JSON = "huizenjacht.json"
CHUNK = 1024 * 1024
# Already compressed: deflating these again only costs time.
_STORED = re.compile(r"\.(jpe?g|png|webp|gif|heic|mp4|mov|webm|m4a|mp3|ogg|opus|zip|pdf)$", re.I)
_MEDIA_NAME = re.compile(r"media/([A-Za-z0-9_-]{8,40})(\.thumb\.jpg)?")
_LISTING_NAME = re.compile(
    r"advertenties/([a-z0-9][a-z0-9-]{0,99})/([A-Za-z0-9][A-Za-z0-9._-]{0,99})"
)

NIGHTLY = re.compile(r"huizenjacht-(\d{4}-\d{2}-\d{2})\.zip")

MEDIA_CATEGORY = {"foto": "fotos", "video": "videos", "audio": "memos"}


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _files(folder: Path) -> Iterator[Path]:
    """Every file below `folder`, without hidden ones (such as .git)."""
    if not folder.is_dir():
        return
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(folder)
        if any(part.startswith(".") for part in rel.parts) or not path.is_file():
            continue
        yield path


def disk_usage(
    db: Database, data_dir: Path, reports_dir: Path | None, backup_dir: Path | None = None
) -> dict[str, Any]:
    """Bytes and file count per category, and how full the data volume is."""
    usage = {
        key: {"bytes": 0, "count": 0}
        for key in ("fotos", "videos", "memos", "documenten", "advertenties", "gegevens", "backups")
    }
    media = data_dir / "media"
    for media_id, kind in db.media_sizes():
        entry = usage[MEDIA_CATEGORY.get(kind, "fotos")]
        entry["bytes"] += _size(media / media_id) + _size(media / f"{media_id}.thumb.jpg")
        entry["count"] += 1
    for path in _files(data_dir / "listings"):
        usage["advertenties"]["bytes"] += path.stat().st_size
        if path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            usage["advertenties"]["count"] += 1
    if reports_dir:
        for path in _files(reports_dir / "documenten"):
            usage["documenten"]["bytes"] += path.stat().st_size
            usage["documenten"]["count"] += 1
    for path in data_dir.glob("huizenjacht.sqlite*"):
        usage["gegevens"]["bytes"] += _size(path)
    usage["gegevens"]["count"] = db.house_count()
    if backup_dir:
        for found in nightly_backups(backup_dir):
            usage["backups"]["bytes"] += found["size"]
            usage["backups"]["count"] += 1
    try:
        disk = shutil.disk_usage(data_dir)
        volume = {"total": disk.total, "free": disk.free}
    except OSError:
        volume = None
    return {
        "categories": usage,
        "total": sum(e["bytes"] for e in usage.values()),
        "disk": volume,
    }


class _Pipe:
    """A file that only collects what is written, for zipfile to stream into."""

    def __init__(self) -> None:
        self.buffer = bytearray()
        self.written = 0

    def write(self, data: bytes) -> int:
        self.buffer += data
        self.written += len(data)
        return len(data)

    def tell(self) -> int:
        return self.written

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        out = bytes(self.buffer)
        self.buffer.clear()
        return out


def _entry(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, time.localtime()[:6])
    info.compress_type = zipfile.ZIP_STORED if _STORED.search(name) else zipfile.ZIP_DEFLATED
    return info


def full_backup(db: Database, data_dir: Path, reports_dir: Path | None) -> Iterator[bytes]:
    """The full backup as ZIP, chunk by chunk."""
    backup = db.export()
    backup["files"] = db.file_rows()
    house_ids = [h["id"] for h in backup["houses"]]
    files: list[tuple[str, Path]] = []
    for row in backup["files"]["media"]:
        files.append((f"media/{row['id']}", data_dir / "media" / row["id"]))
        if row["thumb"]:
            thumb = f"{row['id']}.thumb.jpg"
            files.append((f"media/{thumb}", data_dir / "media" / thumb))
    for path in _files(data_dir / "listings"):
        files.append((f"advertenties/{path.relative_to(data_dir / 'listings').as_posix()}", path))
    if reports_dir:
        for house_id in house_ids:
            folder = reports_dir / "documenten" / house_id
            for path in _files(folder):
                files.append((f"documenten/{house_id}/{path.relative_to(folder).as_posix()}", path))

    pipe = _Pipe()
    with zipfile.ZipFile(pipe, "w") as archive:  # type: ignore[arg-type]
        archive.writestr(_entry(BACKUP_JSON), json.dumps(backup, ensure_ascii=False, indent=1))
        yield pipe.take()
        for name, path in files:
            try:
                source = path.open("rb")
            except OSError:
                continue  # removed since the backup started
            with source, archive.open(_entry(name), "w", force_zip64=True) as target:
                while chunk := source.read(CHUNK):
                    target.write(chunk)
                    if len(pipe.buffer) >= CHUNK:
                        yield pipe.take()
            yield pipe.take()
    yield pipe.take()


def restore_full(db: Database, data_dir: Path, upload: IO[bytes]) -> dict[str, int]:
    """Put back a full backup: houses, settings, media and listing copies. Replaces what is
    there now. Raises ValueError when the file is not a full backup."""
    try:
        archive = zipfile.ZipFile(upload)
    except zipfile.BadZipFile as exc:
        raise ValueError("dit is geen ZIP-bestand") from exc
    with archive:
        try:
            backup = json.loads(archive.read(BACKUP_JSON))
        except (KeyError, ValueError) as exc:
            raise ValueError(f"{BACKUP_JSON} ontbreekt of is kapot") from exc
        if not isinstance(backup, dict) or backup.get("format") != "huizenjacht-backup":
            raise ValueError("dit is geen Huizenjacht-back-up")
        files = backup.get("files")
        if not isinstance(files, dict):
            raise ValueError("de lijst met bestanden ontbreekt")
        media_ids = {r.get("id") for r in files.get("media", []) if isinstance(r, dict)}

        # New files go next to the old ones first; only once the database took the backup
        # do they replace them, so a backup that fails halfway changes nothing.
        staging = data_dir / ".restore"
        shutil.rmtree(staging, ignore_errors=True)
        (staging / "media").mkdir(parents=True)
        (staging / "listings").mkdir()
        try:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                if (m := _MEDIA_NAME.fullmatch(info.filename)) and m.group(1) in media_ids:
                    target = staging / "media" / info.filename.removeprefix("media/")
                elif m := _LISTING_NAME.fullmatch(info.filename):
                    target = staging / "listings" / m.group(1) / m.group(2)
                    target.parent.mkdir(exist_ok=True)
                else:
                    continue  # documents, and anything unexpected
                with archive.open(info) as source, target.open("wb") as out:
                    shutil.copyfileobj(source, out, CHUNK)
            houses = db.restore(backup, files)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    for name in ("media", "listings"):
        old = data_dir / f".restore-old-{name}"
        shutil.rmtree(old, ignore_errors=True)
        if (data_dir / name).exists():
            (data_dir / name).rename(old)
        (staging / name).rename(data_dir / name)
        shutil.rmtree(old, ignore_errors=True)
    shutil.rmtree(staging, ignore_errors=True)
    return {"houses": houses, "media": len(media_ids)}


# Nightly backups: <backup dir>/huizenjacht-<date>.zip, one per day.


def nightly_backups(backup_dir: Path) -> list[dict[str, Any]]:
    """The nightly backups, newest first."""
    if not backup_dir.is_dir():
        return []
    found = []
    for path in backup_dir.iterdir():
        if NIGHTLY.fullmatch(path.name) and path.is_file():
            stat = path.stat()
            found.append(
                {
                    "name": path.name,
                    "size": stat.st_size,
                    "createdAt": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(
                        timespec="seconds"
                    ),
                }
            )
    return sorted(found, key=lambda f: f["name"], reverse=True)


def write_nightly(
    db: Database,
    data_dir: Path,
    reports_dir: Path | None,
    backup_dir: Path,
    day: date,
    keep_days: int,
) -> Path:
    """Write the full backup of `day`, then remove those older than `keep_days` days."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"huizenjacht-{day.isoformat()}.zip"
    partial = target.with_name(f".{target.name}.part")
    try:
        with partial.open("wb") as out:
            for chunk in full_backup(db, data_dir, reports_dir):
                out.write(chunk)
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    prune_nightly(backup_dir, day, keep_days)
    return target


def prune_nightly(backup_dir: Path, today: date, keep_days: int) -> None:
    """Keep the backups of the last `keep_days` days (today included). The newest one always
    stays, also when the server was off for a while."""
    oldest = today - timedelta(days=keep_days - 1)
    for found in nightly_backups(backup_dir)[1:]:
        if date.fromisoformat(NIGHTLY.fullmatch(found["name"]).group(1)) < oldest:
            (backup_dir / found["name"]).unlink(missing_ok=True)


def next_run(now: datetime, at: str) -> datetime:
    """The next moment at `at` (HH:MM) in now's time zone, after now."""
    hour, minute = (int(part) for part in at.split(":"))
    run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return run if run > now else run + timedelta(days=1)
