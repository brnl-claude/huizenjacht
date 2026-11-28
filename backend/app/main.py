"""The API and the built PWA."""

import asyncio
import base64
import contextlib
import contextvars
import hashlib
import json
import logging
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx2
from fastapi import Body, Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from starlette.datastructures import UploadFile as StarletteUpload

from . import auth, publiek
from .backup import (
    NIGHTLY,
    disk_usage,
    full_backup,
    next_run,
    nightly_backups,
    restore_full,
    write_nightly,
)
from .config import Settings, load_settings
from .db import EARLIER, LOCAL, PEOPLE, PERSONAL, Database, first_name, now, person_key
from .funda import (
    Blocked,
    NotAListing,
    fetch_listing,
    photo_files,
    remote_photos,
    save_page,
)
from .funda import (
    listing_page as listing_address,
)
from .kaart import MapService
from .reports import (
    REPORT_SUFFIXES,
    digest,
    documents_folder,
    find_documents,
    find_reports,
    parse_report,
    slugify,
)

MAX_UPLOAD = 5 * 1024 * 1024
# A nightly backup the server missed is made this long after it starts.
BACKUP_CATCH_UP_SECONDS = 600
MAX_LISTING_PAGE = 8 * 1024 * 1024
# One photo, video or voice memo. A phone video of a few minutes fits.
MAX_MEDIA = 2 * 1024 * 1024 * 1024
MAX_THUMB = 2 * 1024 * 1024
# Files shared to the app wait this long for someone to pick their house.
SHARE_DAYS = 7
EXPORT_SECONDS = 10 * 60
EXPORT_LIMIT = 30 * 1024 * 1024
# All PDFs waiting for their download together; the pod has 512 Mi.
EXPORTS_TOTAL = 100 * 1024 * 1024
# Media served from this origin never run as a page (an SVG "photo" could hold a script).
MEDIA_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
}
# Documents that a browser shows without running anything of theirs; the rest only downloads.
INLINE_DOCUMENTS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt"}
# Sent with every answer: no framing by other sites, no guessing of types, no full referrer.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "SAMEORIGIN",
}
MEDIA_KINDS = {"image": "foto", "video": "video", "audio": "audio"}
BOOKMARKLET_TOKEN = "bookmarkletToken"
# Raise together with BOOKMARKLET_VERSION in frontend/src/Bookmarklet.tsx whenever the
# bookmarklet code changes, so an old bookmarklet in someone's browser is refused.
BOOKMARKLET_VERSION = 3
BOOKMARKLET_OUTDATED = (
    "Deze bladwijzer is verouderd. "
    "Zet hem opnieuw neer via Instellingen → Bladwijzer in Huizenjacht."
)
# The bookmarklet posts from the listing site; it carries a token and no cookies.
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


class TooLarge(Exception):
    """A request body over its limit."""


async def read_body(request: Request, limit: int) -> bytes:
    """The request body, but never more than `limit` bytes in memory: raises TooLarge."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > limit:
        raise TooLarge
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise TooLarge
        chunks.append(chunk)
    return b"".join(chunks)


def listing_key(url: str) -> str:
    """The Funda number in a listing address, or the address without query and slash."""
    match = re.search(r"/(\d{6,10})(?:/|$|\?)", url)
    if match:
        return match.group(1)
    return url.split("?")[0].rstrip("/").lower().replace("://www.", "://")


FUNDA_LISTING_PATH = re.compile(r"^(?:/en)?/(?:detail/)?(?:koop|huur)/[^/]+/[^/]+", re.I)


def is_funda_listing(url: str) -> bool:
    """A house page on funda.nl, such as /detail/koop/lathum/huis-x/80985930/."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return (
        parts.scheme in ("http", "https")
        and (host == "funda.nl" or host.endswith(".funda.nl"))
        and bool(FUNDA_LISTING_PATH.match(parts.path))
    )


# The browser tab that made a change, so it can skip its own live update.
client_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("client_id", default=None)
# Live updates: a stream ends after this long, the browser opens a new one at once.
EVENT_STREAM_SECONDS = 300
EVENT_PING_SECONDS = 20


class Events:
    """Sends every change to the browsers that have /api/events open."""

    def __init__(self) -> None:
        self.queues: set[asyncio.Queue[dict[str, Any]]] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def publish(self, event: dict[str, Any]) -> None:
        if not self.loop or self.loop.is_closed():
            return
        for queue in list(self.queues):
            self.loop.call_soon_threadsafe(self._put, queue, event)

    @staticmethod
    def _put(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(event)


# How often the app looks for listings that are new, changed or due for a retry.
LISTING_CHECK_SECONDS = 300

log = logging.getLogger("huizenjacht.listings")
backup_log = logging.getLogger("huizenjacht.backup")


def setup_logging() -> None:
    """Uvicorn only sets up its own loggers; without this, the app's messages are lost."""
    root = logging.getLogger("huizenjacht")
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        root.addHandler(handler)
        root.setLevel(logging.INFO)
        root.propagate = False


class ImportState:
    def __init__(self) -> None:
        self.last_scan: str | None = None
        self.last_result: dict[str, Any] | None = None
        self.lock = asyncio.Lock()


def import_folder(db: Database, folder: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"created": 0, "updated": 0, "unchanged": 0, "errors": []}
    for path in find_reports(folder):
        rel = str(path.relative_to(folder))
        try:
            content = path.read_bytes()
            house_id, fields, body = parse_report(rel, content)
            outcome = db.upsert_report(
                house_id,
                source="report-dir",
                source_path=rel,
                source_hash=digest(content),
                report=fields,
                body=body,
            )
            result[outcome] += 1
        except Exception as exc:  # one bad report must not stop the rest
            result["errors"].append({"file": rel, "error": str(exc)})
    return result


def create_app(
    settings: Settings | None = None,
    oidc_transport: Any = None,
    listing_transport: Any = None,
    map_transport: Any = None,
) -> FastAPI:
    settings = settings or load_settings()
    setup_logging()
    state = ImportState()
    listing_lock = asyncio.Lock()

    def listing_folder(house_id: str) -> Path:
        return settings.data_dir / "listings" / slugify(house_id)

    def fetch_one(
        house_id: str, url: str, html: str | None = None, photos_html: str | None = None
    ) -> str | None:
        """Fetch a house's listing page and photos, or keep `html` that the browser sent;
        record how it went. Returns what went wrong, or None. A failure never replaces a good
        copy (see Database.save_listing), so the caller says it to whoever sent the page."""
        with httpx2.Client(transport=listing_transport) as client:
            try:
                if html is None:
                    result = fetch_listing(url, listing_folder(house_id), client)
                else:
                    result = save_page(
                        html, url, listing_folder(house_id), client, photos_html=photos_html
                    )
            except Blocked as exc:
                log.warning("Listing of %s blocked: %s", house_id, exc)
                db().save_listing(house_id, url, "blocked", str(exc))
                return str(exc)
            except NotAListing as exc:
                log.warning("Listing of %s: %s", house_id, exc)
                db().save_listing(house_id, url, "error", str(exc))
                return str(exc)
            except Exception as exc:
                log.exception("Listing of %s failed", house_id)
                message = f"Ophalen mislukt: {type(exc).__name__}: {exc}"
                db().save_listing(house_id, url, "error", message)
                return message
        db().save_listing(
            house_id,
            url,
            "ok",
            message=result["message"],
            photos=result["photos"],
            has_page=True,
            title=result.get("title"),
            description=result.get("description"),
        )
        return None

    async def fetch_listings_forever() -> None:
        # Give the first import of reports a moment, so new houses are found right away.
        await asyncio.sleep(10)
        log.info("Fetching listings is on; checking every %s s", LISTING_CHECK_SECONDS)
        while True:
            try:
                due = db().listing_due()
                if due:
                    log.info("Fetching %s listing(s)", len(due))
                for house_id, url in due:
                    async with listing_lock:
                        await asyncio.to_thread(fetch_one, house_id, url)
                    # Be gentle with the site.
                    await asyncio.sleep(3)
            except Exception:
                log.exception("Fetching listings failed")
            await asyncio.sleep(LISTING_CHECK_SECONDS)

    async def scan() -> dict[str, Any]:
        folder = settings.reports_dir
        if not folder or not folder.is_dir():
            return {"created": 0, "updated": 0, "unchanged": 0, "errors": [], "skipped": True}
        async with state.lock:
            result = await asyncio.to_thread(import_folder, app.state.db, folder)
            state.last_scan, state.last_result = now(), result
            return result

    async def scan_forever() -> None:
        while True:
            with contextlib.suppress(Exception):
                await scan()
            if settings.reports_scan_interval <= 0:
                return
            await asyncio.sleep(settings.reports_scan_interval)

    def backup_zone() -> ZoneInfo | timezone:
        try:
            return ZoneInfo(settings.backup_timezone)
        except (ZoneInfoNotFoundError, ValueError):
            return UTC

    def nightly_on() -> bool:
        return settings.backup_dir is not None and settings.backup_keep_days > 0

    def make_nightly() -> None:
        assert settings.backup_dir is not None
        day = datetime.now(backup_zone()).date()
        try:
            path = write_nightly(
                db(),
                settings.data_dir,
                settings.reports_dir,
                settings.backup_dir,
                day,
                settings.backup_keep_days,
            )
            backup_log.info("Nachtelijke back-up gemaakt: %s", path.name)
        except Exception:
            backup_log.exception("Nachtelijke back-up mislukt")

    async def backup_forever() -> None:
        assert settings.backup_dir is not None
        # Missed one (the server was off at night, or this is the first start): make it soon.
        newest = nightly_backups(settings.backup_dir)
        today = datetime.now(backup_zone()).date().isoformat()
        yesterday = (datetime.now(backup_zone()) - timedelta(days=1)).date().isoformat()
        if not newest or newest[0]["name"] < f"huizenjacht-{yesterday}.zip":
            await asyncio.sleep(BACKUP_CATCH_UP_SECONDS)
            if not any(today in b["name"] for b in nightly_backups(settings.backup_dir)):
                await asyncio.to_thread(make_nightly)
        while True:
            now_there = datetime.now(backup_zone())
            wait = (next_run(now_there, settings.backup_time) - now_there).total_seconds()
            await asyncio.sleep(wait)
            await asyncio.to_thread(make_nightly)

    events = Events()

    def on_change(house_id: str | None, removed: bool) -> None:
        if house_id is None:
            events.publish({"type": "houses", "from": client_id.get()})
        else:
            kind = "removed" if removed else "house"
            events.publish({"type": kind, "id": house_id, "from": client_id.get()})

    def claim_old_answers(database: Database) -> None:
        """Give the answers from before 0.6.0 to their owner, when that is clear."""
        if settings.auth_mode != "oidc":
            if LOCAL not in database.people():
                database.register_person(LOCAL, "Ik")
            database.move_answers(LOCAL, legacy=True)
            return
        if not database.legacy_answers():
            return
        subjects = database.login_subjects()
        if len(subjects) == 1:
            # Only one person has logged in so far: they filled them in.
            database.move_answers(person_key(subjects.pop()), legacy=True)
        else:
            database.register_person(EARLIER, "Eerder ingevuld")
            database.move_answers(EARLIER, legacy=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db = Database(settings.data_dir / "huizenjacht.sqlite")
        events.loop = asyncio.get_running_loop()
        claim_old_answers(app.state.db)
        app.state.db.on_change = on_change
        tasks = [asyncio.create_task(scan_forever())]
        if settings.fetch_listings:
            tasks.append(asyncio.create_task(fetch_listings_forever()))
        if nightly_on():
            tasks.append(asyncio.create_task(backup_forever()))
        yield
        for task in tasks:
            task.cancel()
        app.state.db.close()

    app = FastAPI(title="Huizenjacht", lifespan=lifespan, docs_url=None, redoc_url=None)

    def db() -> Database:
        return app.state.db

    auth.install(app, settings, db, oidc_transport)
    app.state.events = events

    @app.middleware("http")
    async def remember_client(request: Request, call_next):
        client_id.set(request.headers.get("x-client"))
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response

    def person(request: Request) -> str:
        user = auth.user_of(request)
        return person_key(user["subject"]) if user else LOCAL

    def house_or_404(house_id: str) -> dict[str, Any]:
        house = db().get_house(house_id)
        if not house:
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        return house

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "version": settings.version,
            "commitUrl": settings.commit_url,
            "environment": {"label": settings.env_label, "color": settings.env_color},
        }

    @app.get("/api/houses")
    def list_houses() -> list[dict[str, Any]]:
        return db().list_houses()

    @app.get("/api/houses/{house_id}")
    def get_house(house_id: str) -> dict[str, Any]:
        return house_or_404(house_id)

    @app.post("/api/houses", status_code=201)
    def create_house(request: Request, mine: dict[str, Any] = Body(...)) -> dict[str, Any]:
        base = slugify(str(mine.get("adres") or "huis"))
        house_id, taken = base, db().ids()
        while house_id in taken:
            house_id = f"{base}-{secrets.token_hex(2)}"
        own = {k: mine.pop(k) for k in PERSONAL if k in mine}
        mine.pop("personen", None)
        house = db().create_manual(house_id, mine)
        return db().update_mine(house_id, own, person(request)) if own else house

    @app.patch("/api/houses/{house_id}")
    def update_house(
        request: Request, house_id: str, changes: dict[str, Any] = Body(...)
    ) -> dict[str, Any]:
        house = db().update_mine(house_id, changes, person(request))
        if not house:
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        return house

    @app.delete("/api/houses/{house_id}", status_code=204)
    def delete_house(house_id: str) -> Response:
        files = db().house_media_ids(house_id)
        if not db().delete_house(house_id):
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        remove_media_files(files)
        drop_public_link(house_id)
        return Response(status_code=204)

    # Photos, videos and voice memos

    def media_folder() -> Path:
        folder = settings.data_dir / "media"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def media_path(media_id: str, thumb: bool = False) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", media_id):
            raise HTTPException(404, "Dit bestand is er niet.")
        return media_folder() / (f"{media_id}.thumb.jpg" if thumb else media_id)

    def remove_media_files(ids: list[str]) -> None:
        for media_id in ids:
            for thumb in (False, True):
                media_path(media_id, thumb).unlink(missing_ok=True)

    def media_kind(upload: StarletteUpload) -> tuple[str, str]:
        mime = (upload.content_type or "").split(";")[0].strip().lower()
        kind = MEDIA_KINDS.get(mime.split("/")[0])
        if not kind:
            raise HTTPException(
                415, f"{upload.filename or 'Dit bestand'} is geen foto, video of geluid."
            )
        return kind, mime

    def save_upload(upload: StarletteUpload, path: Path, limit: int) -> int:
        size = 0
        with path.open("wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    out.close()
                    path.unlink(missing_ok=True)
                    raise HTTPException(413, f"{upload.filename or 'Dit bestand'} is te groot.")
                out.write(chunk)
        return size

    def store_media(
        upload: UploadFile,
        thumb: UploadFile | None = None,
        media_id: str | None = None,
        **fields: Any,
    ) -> dict[str, Any]:
        kind, mime = media_kind(upload)
        media_id = media_id or secrets.token_urlsafe(12)
        size = save_upload(upload, media_path(media_id), MAX_MEDIA)
        has_thumb = False
        if thumb is not None and (thumb.content_type or "").startswith("image/"):
            save_upload(thumb, media_path(media_id, True), MAX_THUMB)
            has_thumb = True
        return db().add_media(
            media_id,
            kind=kind,
            mime=mime,
            name=upload.filename,
            size=size,
            thumb=has_thumb,
            **fields,
        )

    @app.post("/api/houses/{house_id}/media", status_code=201)
    def add_media(
        request: Request,
        house_id: str,
        file: UploadFile,
        thumb: UploadFile | None = None,
        item: str = Form(""),
        duration: float | None = Form(None),
        key: str = Form(""),
    ) -> dict[str, Any]:
        house_or_404(house_id)
        media_id = None
        if key:
            # The outbox sends the same key again when an answer got lost: same file, once.
            seed = f"{house_id}|{key}".encode()
            media_id = base64.urlsafe_b64encode(hashlib.sha256(seed).digest())[:22].decode()
            existing = db().get_media(media_id)
            if existing:
                return existing
        return store_media(
            file,
            thumb,
            media_id,
            house_id=house_id,
            item=item,
            duration=duration,
            person=person(request),
        )

    def media_or_404(media_id: str) -> dict[str, Any]:
        found = db().get_media(media_id) if re.fullmatch(r"[A-Za-z0-9_-]{8,40}", media_id) else None
        if not found:
            raise HTTPException(404, "Dit bestand is er niet (meer).")
        return found

    @app.get("/api/media/{media_id}")
    def media_file(media_id: str) -> FileResponse:
        found = media_or_404(media_id)
        return FileResponse(
            media_path(media_id),
            media_type=found["mime"],
            headers={"Cache-Control": "private, max-age=31536000, immutable", **MEDIA_HEADERS},
        )

    @app.get("/api/media/{media_id}/thumb")
    def media_thumb(media_id: str) -> FileResponse:
        path = media_path(media_id, True)
        if not path.exists():
            raise HTTPException(404, "Geen voorbeeld.")
        return FileResponse(
            path,
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=86400", **MEDIA_HEADERS},
        )

    @app.put("/api/media/{media_id}/thumb")
    def put_media_thumb(media_id: str, thumb: UploadFile) -> dict[str, Any]:
        media_or_404(media_id)
        if not (thumb.content_type or "").startswith("image/"):
            raise HTTPException(415, "Een voorbeeld is een afbeelding.")
        save_upload(thumb, media_path(media_id, True), MAX_THUMB)
        return db().update_media(media_id, {"thumb": True}) or {}

    @app.patch("/api/media/{media_id}")
    def update_media(media_id: str, changes: dict[str, Any] = Body(...)) -> dict[str, Any]:
        media_or_404(media_id)
        return db().update_media(media_id, changes) or {}

    @app.delete("/api/media/{media_id}", status_code=204)
    def delete_media(media_id: str) -> Response:
        media_or_404(media_id)
        db().delete_media(media_id)
        remove_media_files([media_id])
        return Response(status_code=204)

    # Sharing to the app (Web Share Target, and the Android app)

    @app.post("/api/share", response_model=None)
    async def share(request: Request) -> Response:
        remove_media_files(db().drop_shares(timedelta(days=SHARE_DAYS)))
        form = await request.form(max_files=100)
        share_id = secrets.token_urlsafe(9)
        files = [f for f in form.getlist("files") if isinstance(f, StarletteUpload) and f.filename]

        def keep() -> None:
            db().add_share(
                share_id,
                str(form.get("title") or ""),
                str(form.get("text") or ""),
                str(form.get("url") or ""),
            )
            for upload in files:
                try:
                    store_media(upload, share_id=share_id, person=person(request))
                except HTTPException as exc:
                    log.warning("Gedeeld bestand overgeslagen: %s", exc.detail)

        await asyncio.to_thread(keep)
        url = f"/#/delen/{share_id}"
        if "application/json" in request.headers.get("accept", ""):
            return JSONResponse({"id": share_id, "url": url}, status_code=201)
        return RedirectResponse(url, status_code=303)

    def share_or_404(share_id: str) -> dict[str, Any]:
        found = db().get_share(share_id)
        if not found:
            raise HTTPException(404, "Deze gedeelde bestanden zijn er niet (meer).")
        return found

    @app.get("/api/share/{share_id}")
    def get_share(share_id: str) -> dict[str, Any]:
        return share_or_404(share_id)

    @app.post("/api/share/{share_id}")
    def file_share(
        request: Request, share_id: str, target: dict[str, Any] = Body(...)
    ) -> dict[str, Any]:
        share_or_404(share_id)
        house_id = str(target.get("house") or "")
        house_or_404(house_id)
        count = db().file_share(share_id, house_id, target.get("item") or None, person(request))
        return {"house": house_id, "files": count}

    @app.delete("/api/share/{share_id}", status_code=204)
    def drop_share(share_id: str) -> Response:
        share_or_404(share_id)
        remove_media_files(db().drop_shares(share_id=share_id))
        return Response(status_code=204)

    # A PDF made in the browser, handed back as a real download for Android's WebView, which
    # cannot save a blob: kept in memory for a few minutes only.
    exports: dict[str, tuple[float, str, bytes]] = {}

    @app.post("/api/export")
    async def put_export(request: Request, naam: str = "export.pdf") -> dict[str, str]:
        try:
            data = await read_body(request, EXPORT_LIMIT)
        except TooLarge:
            raise HTTPException(413, "Deze PDF is te groot.") from None
        if not data.startswith(b"%PDF-"):
            raise HTTPException(400, "Dit is geen PDF.")
        moment = time.monotonic()
        for key in [k for k, (at, _, _) in exports.items() if moment - at > EXPORT_SECONDS]:
            exports.pop(key, None)

        def waiting() -> int:
            return sum(len(d) for _, _, d in exports.values())

        while exports and (len(exports) >= 20 or waiting() + len(data) > EXPORTS_TOTAL):
            exports.pop(next(iter(exports)))
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "", naam).strip() or "export.pdf"
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
        token = secrets.token_urlsafe(16)
        exports[token] = (moment, name, data)
        return {"url": f"/api/export/{token}/{quote(name)}"}

    @app.get("/api/export/{token}/{name}")
    def get_export(token: str, name: str) -> Response:
        found = exports.get(token)
        if not found or time.monotonic() - found[0] > EXPORT_SECONDS:
            raise HTTPException(404, "Deze PDF is er niet meer. Maak hem opnieuw.")
        _, filename, data = found
        return Response(
            data,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )

    @app.post("/api/houses/{house_id}/listing/refresh")
    async def refresh_listing(house_id: str) -> dict[str, Any]:
        url = db().house_url(house_id)
        if not url:
            raise HTTPException(404, "Dit huis heeft geen link naar een advertentie.")
        async with listing_lock:
            await asyncio.to_thread(fetch_one, house_id, url)
        return house_or_404(house_id)

    @app.post("/api/houses/{house_id}/listing/import")
    async def import_listing(house_id: str, request: Request) -> dict[str, Any]:
        """A listing page as Bram's browser shows it, sent by the bookmarklet."""
        try:
            body = await read_body(request, MAX_LISTING_PAGE)
        except TooLarge:
            raise HTTPException(413, "Deze pagina is te groot.") from None
        try:
            data = json.loads(body)
            url, html = listing_address(str(data["url"])), str(data["html"])
            photos_html = data.get("photos")
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise HTTPException(400, "Stuur url en html mee.") from exc
        if not url.startswith(("http://", "https://")):
            raise HTTPException(400, "Dit is geen webadres.")
        if not db().get_house(house_id):
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        async with listing_lock:
            failed = await asyncio.to_thread(
                fetch_one,
                house_id,
                url,
                html,
                photos_html if isinstance(photos_html, str) else None,
            )
        if failed:
            raise HTTPException(422, failed)
        return house_or_404(house_id)

    def bookmarklet_token(rotate: bool = False) -> str:
        token = db().get_setting(BOOKMARKLET_TOKEN)
        if rotate or not isinstance(token, str) or len(token) < 20:
            token = secrets.token_urlsafe(24)
            db().set_setting(BOOKMARKLET_TOKEN, token)
        return token

    @app.get("/api/bookmarklet")
    def bookmarklet() -> dict[str, str]:
        """The token in Bram's bookmarklet; only shown to someone who is logged in."""
        return {"token": bookmarklet_token()}

    @app.post("/api/bookmarklet/rotate")
    def bookmarklet_rotate() -> dict[str, str]:
        return {"token": bookmarklet_token(rotate=True)}

    @app.options("/api/bookmarklet/page")
    def bookmarklet_preflight() -> Response:
        return Response(status_code=204, headers=CORS)

    @app.post("/api/bookmarklet/page")
    async def bookmarklet_page(request: Request) -> JSONResponse:
        """A listing page sent from the site itself by the bookmarklet, in the background.

        It comes from another site, so there is no session cookie: the token in the bookmarklet
        is the proof. Sent as text/plain, so the browser needs no preflight."""

        def answer(status: int, message: str, **extra: Any) -> JSONResponse:
            return JSONResponse({"message": message, **extra}, status_code=status, headers=CORS)

        # Open to anyone (no login): never read more than a page into memory.
        try:
            body = await read_body(request, MAX_LISTING_PAGE)
        except TooLarge:
            return answer(413, "Deze pagina is te groot.")
        try:
            data = json.loads(body)
            token, url, html = (
                str(data["token"]),
                listing_address(str(data["url"])),
                str(data["html"]),
            )
            photos_html = data.get("photos")
        except (ValueError, KeyError, TypeError, AttributeError):
            return answer(400, "Stuur token, url en html mee.")
        expected = db().get_setting(BOOKMARKLET_TOKEN)
        if not isinstance(expected, str) or not secrets.compare_digest(token, expected):
            return answer(
                403, "Deze bladwijzer is verlopen. Zet hem opnieuw neer vanuit Huizenjacht."
            )
        if data.get("v") != BOOKMARKLET_VERSION:
            return answer(426, BOOKMARKLET_OUTDATED, outdated=True)
        if not is_funda_listing(url):
            return answer(
                400,
                "De bladwijzer werkt alleen op een huis op funda.nl. Open eerst een advertentie.",
            )
        key = listing_key(url)
        house = next(
            (
                h
                for h in db().list_houses()
                if listing_key(str(h["mine"].get("url") or h["report"].get("url") or "")) == key
            ),
            None,
        )
        if house is None:
            # Houses come in through the reports; the bookmarklet only adds the listing to one.
            return answer(
                404,
                "Dit huis staat nog niet in Huizenjacht. Huizen komen erin via de rapporten; "
                "daarna kun je de advertentie hier opslaan.",
            )
        async with listing_lock:
            failed = await asyncio.to_thread(
                fetch_one,
                house["id"],
                url,
                html,
                photos_html if isinstance(photos_html, str) else None,
            )
        if failed:
            return answer(422, failed)
        saved = house_or_404(house["id"])
        listing = saved.get("listing") or {}
        name = saved["mine"].get("adres") or saved["report"].get("adres") or saved["id"]
        photos = listing.get("photos", 0)
        return answer(
            200,
            f"Opgeslagen: {name}, {photos} foto's.",
            house=saved["id"],
            link=f"{settings.public_url or ''}/#/huis/{saved['id']}",
        )

    maps = MapService(settings.data_dir, settings.version, map_transport)

    @app.get("/api/houses/{house_id}/ligging")
    async def location(house_id: str) -> dict[str, float]:
        """Where the house is, for the map in the PDF (see kaart.py)."""
        house = house_or_404(house_id)
        if not settings.map_enabled:
            raise HTTPException(404, "De kaart staat uit (HJ_MAP).")
        fields = {**house["report"], **{k: v for k, v in house["mine"].items() if v}}
        place = await asyncio.to_thread(maps.locate, fields)
        if not place:
            raise HTTPException(404, "Dit adres staat niet op de kaart.")
        return place

    @app.get("/api/kaart/{z}/{x}/{y}.png", response_model=None)
    async def map_tile(z: int, x: int, y: int) -> FileResponse:
        if not settings.map_enabled:
            raise HTTPException(404, "De kaart staat uit (HJ_MAP).")
        path = await asyncio.to_thread(maps.tile, z, x, y)
        if not path:
            raise HTTPException(404, "Deze kaarttegel is er niet.")
        return FileResponse(
            path, media_type="image/png", headers={"Cache-Control": "private, max-age=604800"}
        )

    @app.get("/api/houses/{house_id}/photos/{number}", response_model=None)
    def photo(house_id: str, number: int) -> FileResponse | RedirectResponse:
        folder = listing_folder(house_id)
        files = photo_files(folder)
        if 0 <= number < len(files):
            return FileResponse(files[number], headers={"Cache-Control": "private, max-age=86400"})
        remote = remote_photos(folder)
        if not files and 0 <= number < len(remote):
            # The photo server refused the app; the browser fetches it itself.
            return RedirectResponse(remote[number], status_code=302)
        raise HTTPException(404, "Deze foto is er niet.")

    def house_documents(house_id: str) -> tuple[Path | None, list[dict[str, Any]]]:
        """The report's list of documents, joined with the files in documenten/<id>/."""
        house = house_or_404(house_id)
        listed = [dict(d) for d in house["report"].get("documenten") or [] if isinstance(d, dict)]
        folder = documents_folder(settings.reports_dir, house_id) if settings.reports_dir else None
        files = find_documents(folder) if folder else []
        by_name = {str(p.relative_to(folder)): p for p in files} if folder else {}
        lower = {name.lower(): name for name in by_name}
        seen = set()
        docs = []
        for doc in listed:
            name = lower.get(str(doc.get("bestand", "")).strip().lstrip("/").lower())
            if name:
                seen.add(name)
                doc["bestand"] = name
                doc["grootte"] = by_name[name].stat().st_size
                doc["url"] = f"/api/houses/{house_id}/documenten/{quote(name)}"
            docs.append(doc)
        # Files that the report does not name still show, under their own name.
        for name, path in by_name.items():
            if name not in seen:
                docs.append(
                    {
                        "naam": Path(name).name,
                        "bestand": name,
                        "grootte": path.stat().st_size,
                        "url": f"/api/houses/{house_id}/documenten/{quote(name)}",
                        "zonderTitel": True,
                    }
                )
        return folder, docs

    @app.get("/api/houses/{house_id}/documenten")
    def documents(house_id: str) -> list[dict[str, Any]]:
        return house_documents(house_id)[1]

    @app.get("/api/houses/{house_id}/documenten/{name:path}")
    def document_file(house_id: str, name: str, download: bool = False) -> FileResponse:
        folder, docs = house_documents(house_id)
        if not folder or not any(d.get("bestand") == name and d.get("url") for d in docs):
            raise HTTPException(404, "Dit document is er niet (meer).")
        path = (folder / name).resolve()
        if not path.is_relative_to(folder.resolve()) or not path.is_file():
            raise HTTPException(404, "Dit document is er niet (meer).")
        # A web page or SVG would run on the app's own origin: only known-safe types show in
        # the browser, everything else downloads.
        inline = path.suffix.lower() in INLINE_DOCUMENTS
        return FileResponse(
            path,
            filename=Path(name).name,
            content_disposition_type="inline" if inline and not download else "attachment",
            headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
        )

    @app.get("/api/houses/{house_id}/listing/raw")
    def listing_raw(house_id: str) -> Response:
        """What the site sent last time, as a download, to look into a failed fetch."""
        raw = listing_folder(house_id) / "raw.html"
        if not raw.is_file():
            raise HTTPException(404, "De site is voor dit huis nog niet bezocht.")
        return Response(
            raw.read_bytes(),
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{slugify(house_id)}-pagina.html"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/houses/{house_id}/listing/page")
    def listing_page(house_id: str) -> Response:
        page = listing_folder(house_id) / "page.html"
        if not page.is_file():
            raise HTTPException(404, "Er is nog geen kopie van de advertentie.")
        # Shown in a frame: no scripts, no access to this app, links open in a new tab.
        return Response(
            page.read_text(encoding="utf-8"),
            media_type="text/html",
            headers={
                "Content-Security-Policy": (
                    "sandbox allow-popups allow-popups-to-escape-sandbox; script-src 'none';"
                    " frame-ancestors 'self'"
                ),
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/import")
    def import_status() -> dict[str, Any]:
        folder = settings.reports_dir
        available = bool(folder and folder.is_dir())
        return {
            "folderConfigured": folder is not None,
            "folderAvailable": available,
            "fileCount": len(find_reports(folder)) if available and folder else 0,
            "scanInterval": settings.reports_scan_interval,
            "lastScan": state.last_scan,
            "lastResult": state.last_result,
        }

    @app.post("/api/import/scan")
    async def import_scan() -> dict[str, Any]:
        return await scan()

    @app.post("/api/import/hook", status_code=202)
    async def import_hook(request: Request) -> dict[str, Any]:
        """Called by git-sync after each sync (from localhost) or by CI with a bearer token."""
        client = request.client.host if request.client else ""
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        local = client in {"127.0.0.1", "::1"} and "x-forwarded-for" not in request.headers
        allowed = local or (
            settings.import_token and secrets.compare_digest(token, settings.import_token)
        )
        if not allowed:
            raise HTTPException(401, "Geen geldig token.")
        asyncio.create_task(scan())
        return {"status": "scanning"}

    @app.post("/api/import/upload")
    async def import_upload(files: list[UploadFile]) -> dict[str, Any]:
        result: dict[str, Any] = {
            "created": 0,
            "updated": 0,
            "unchanged": 0,
            "errors": [],
            "ids": [],
        }
        for upload in files:
            name = upload.filename or "rapport.md"
            if Path(name).suffix.lower() not in REPORT_SUFFIXES:
                result["errors"].append({"file": name, "error": "Alleen .md en .json."})
                continue
            content = await upload.read(MAX_UPLOAD + 1)
            if len(content) > MAX_UPLOAD:
                result["errors"].append({"file": name, "error": "Groter dan 5 MB."})
                continue
            try:
                house_id, fields, body = parse_report(name, content)
            except Exception as exc:
                result["errors"].append({"file": name, "error": str(exc)})
                continue
            outcome = db().upsert_report(
                house_id,
                source="upload",
                source_path=name,
                source_hash=digest(content),
                report=fields,
                body=body,
            )
            result[outcome] += 1
            result["ids"].append(house_id)
        return result

    @app.get("/api/settings/{key}")
    def get_setting(key: str) -> JSONResponse:
        return JSONResponse({"value": db().get_setting(key)})

    @app.put("/api/settings/{key}")
    def put_setting(key: str, value: Any = Body(..., embed=True)) -> dict[str, Any]:
        valid = re.fullmatch(r"[a-z][a-zA-Z0-9-]{0,40}", key)
        if not valid or key in {PEOPLE, BOOKMARKLET_TOKEN, publiek.SETTING}:
            raise HTTPException(400, "Onbekende instelling.")
        db().set_setting(key, value)
        return {"value": value}

    @app.get("/api/people")
    def people(request: Request) -> dict[str, Any]:
        """Everyone who has answers, with a colour, and which of them is you."""
        me = person(request)
        user = auth.user_of(request)
        if user:
            db().register_person(me, first_name(user))
        return {
            "me": me,
            "people": [{"key": k, **v} for k, v in db().people().items()],
        }

    @app.post("/api/people/claim")
    def claim(request: Request) -> dict[str, Any]:
        """The answers from before 0.6.0 are yours."""
        changed = db().move_answers(person(request), source=EARLIER)
        everyone = db().people()
        if everyone.pop(EARLIER, None):
            db().set_setting(PEOPLE, everyone)
        return {"houses": changed}

    @app.get("/api/events")
    async def live(request: Request) -> StreamingResponse:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        events.queues.add(queue)

        async def stream():
            try:
                yield "retry: 3000\n\n"
                loop = asyncio.get_running_loop()
                end = loop.time() + EVENT_STREAM_SECONDS
                while loop.time() < end and not await request.is_disconnected():
                    try:
                        event = await asyncio.wait_for(queue.get(), EVENT_PING_SECONDS)
                    except TimeoutError:
                        yield ": ping\n\n"
                        continue
                    yield f"data: {json.dumps(event)}\n\n"
            finally:
                events.queues.discard(queue)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def require_admin(request: Request) -> None:
        """Backups hold everything: only admins (HJ_ADMIN_GROUPS) make, fetch or restore them."""
        current = app.state.current_user
        if current is not None and not auth.is_admin(current(request), settings):
            raise HTTPException(403, "Alleen beheerders mogen back-ups maken en terugzetten.")

    @app.get("/api/backup", dependencies=[Depends(require_admin)])
    def backup() -> JSONResponse:
        stamp = now()[:10]
        return JSONResponse(
            db().export(),
            headers={"Content-Disposition": f'attachment; filename="huizenjacht-{stamp}.json"'},
        )

    @app.get("/api/backup/volledig", dependencies=[Depends(require_admin)])
    def full_backup_zip() -> StreamingResponse:
        stamp = now()[:10]
        return StreamingResponse(
            full_backup(db(), settings.data_dir, settings.reports_dir),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="huizenjacht-{stamp}-volledig.zip"',
                "Cache-Control": "no-store",
            },
        )

    @app.post("/api/backup/restore/volledig", dependencies=[Depends(require_admin)])
    def restore_full_zip(file: UploadFile) -> dict[str, Any]:
        try:
            result = restore_full(db(), settings.data_dir, file.file)
        except ValueError as exc:
            raise HTTPException(400, f"Deze back-up kan niet worden teruggezet: {exc}") from exc
        claim_old_answers(db())
        return result

    @app.get("/api/opslag")
    def storage() -> dict[str, Any]:
        return disk_usage(
            db(),
            settings.data_dir,
            settings.reports_dir,
            settings.backup_dir if nightly_on() else None,
        )

    @app.get("/api/backups", dependencies=[Depends(require_admin)])
    def nightly_list() -> dict[str, Any]:
        on = nightly_on()
        return {
            "enabled": on,
            "time": settings.backup_time,
            "keepDays": settings.backup_keep_days,
            "backups": nightly_backups(settings.backup_dir) if on and settings.backup_dir else [],
        }

    def nightly_path(name: str) -> Path:
        if not settings.backup_dir or not NIGHTLY.fullmatch(name):
            raise HTTPException(404, "Deze back-up is er niet.")
        path = settings.backup_dir / name
        if not path.is_file():
            raise HTTPException(404, "Deze back-up is er niet (meer).")
        return path

    @app.get("/api/backups/{name}", dependencies=[Depends(require_admin)])
    def nightly_download(name: str) -> FileResponse:
        return FileResponse(
            nightly_path(name),
            media_type="application/zip",
            filename=name,
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/backups/{name}/restore", dependencies=[Depends(require_admin)])
    def nightly_restore(name: str) -> dict[str, Any]:
        with nightly_path(name).open("rb") as file:
            try:
                result = restore_full(db(), settings.data_dir, file)
            except ValueError as exc:
                raise HTTPException(400, f"Deze back-up kan niet worden teruggezet: {exc}") from exc
        claim_old_answers(db())
        return result

    @app.post("/api/backup/restore", dependencies=[Depends(require_admin)])
    def restore(backup: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if backup.get("format") != "huizenjacht-backup":
            raise HTTPException(400, "Dit is geen Huizenjacht-back-up.")
        try:
            count = db().restore(backup)
        except ValueError as exc:
            raise HTTPException(400, f"Deze back-up kan niet worden teruggezet: {exc}") from exc
        claim_old_answers(db())
        return {"houses": count}

    # Public links (app.publiek): a read-only page of one house, without logging in.

    def public_links() -> dict[str, dict[str, Any]]:
        links = db().get_setting(publiek.SETTING, {})
        return links if isinstance(links, dict) else {}

    def public_link_of(house_id: str) -> tuple[str, dict[str, Any]] | None:
        return next(((t, x) for t, x in public_links().items() if x.get("house") == house_id), None)

    def drop_public_link(house_id: str) -> None:
        links = {t: x for t, x in public_links().items() if x.get("house") != house_id}
        db().set_setting(publiek.SETTING, links)

    def public_view(token: str, link: dict[str, Any]) -> dict[str, Any]:
        return {"token": token, "path": f"/gedeeld/{token}", "created": link.get("created")}

    @app.get("/api/houses/{house_id}/publiek")
    def get_public_link(house_id: str) -> dict[str, Any] | None:
        house_or_404(house_id)
        found = public_link_of(house_id)
        return public_view(*found) if found else None

    @app.put("/api/houses/{house_id}/publiek")
    def put_public_link(house_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        house_or_404(house_id)
        links = public_links()
        found = public_link_of(house_id)
        if found and not body.get("nieuw"):
            token, link = found
        else:
            if found:
                links.pop(found[0])
            token, link = publiek.new_token(), {"house": house_id, "created": now()}
        links[token] = link
        db().set_setting(publiek.SETTING, links)
        return public_view(token, link)

    @app.delete("/api/houses/{house_id}/publiek", status_code=204)
    def delete_public_link(house_id: str) -> Response:
        drop_public_link(house_id)
        return Response(status_code=204)

    def shared_house(token: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
        link = public_links().get(token) if 20 <= len(token) <= 64 else None
        house = db().get_house(str(link.get("house"))) if link else None
        return (house, link) if house and link else None

    def shared_photo_count(house_id: str) -> int:
        folder = listing_folder(house_id)
        return len(photo_files(folder)) or len(remote_photos(folder))

    @app.get("/gedeeld/{token}", include_in_schema=False)
    def shared_page(token: str, request: Request) -> Response:
        found = shared_house(token)
        if not found:
            return Response(publiek.gone(), 404, publiek.PAGE_HEADERS, "text/html")
        house = found[0]
        # The link preview (WhatsApp) needs absolute addresses.
        base = settings.public_url or str(request.base_url).rstrip("/")
        text = publiek.page(house, token, shared_photo_count(house["id"]), base)
        return Response(text, 200, publiek.PAGE_HEADERS, "text/html")

    @app.get("/gedeeld/{token}/foto/{number}", include_in_schema=False, response_model=None)
    def shared_photo(token: str, number: int) -> FileResponse | RedirectResponse:
        found = shared_house(token)
        if not found or number >= publiek.MAX_PHOTOS:
            raise HTTPException(404, "Deze foto is er niet.")
        folder = listing_folder(found[0]["id"])
        files = photo_files(folder)
        if 0 <= number < len(files):
            return FileResponse(files[number], headers=publiek.HEADERS)
        remote = remote_photos(folder)
        if not files and 0 <= number < len(remote):
            return RedirectResponse(remote[number], status_code=302, headers=publiek.HEADERS)
        raise HTTPException(404, "Deze foto is er niet.")

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_not_found(rest: str) -> None:
        raise HTTPException(404, "Onbekend adres.")

    # The Android app (android/) may show this site full screen in Chrome: Chrome checks
    # that the site names the app and its signing key here.
    @app.get("/.well-known/assetlinks.json", include_in_schema=False)
    def assetlinks() -> JSONResponse:
        if not settings.android_cert_fingerprints:
            return JSONResponse([], headers={"Cache-Control": "no-cache"})
        statement = {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": settings.android_package,
                "sha256_cert_fingerprints": list(settings.android_cert_fingerprints),
            },
        }
        return JSONResponse([statement], headers={"Cache-Control": "no-cache"})

    # The PWA: files from the build, index.html for every other path.
    static = settings.static_dir

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str, request: Request) -> Response:
        if not static.is_dir():
            return Response("De app is niet gebouwd (static/ ontbreekt).", status_code=404)
        target = (static / path).resolve()
        if path and target.is_file() and target.is_relative_to(static.resolve()):
            headers = {}
            if path.startswith("assets/"):
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif path in {"sw.js", "index.html", "manifest.webmanifest"}:
                headers["Cache-Control"] = "no-cache"
            return FileResponse(target, headers=headers)
        return FileResponse(static / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
