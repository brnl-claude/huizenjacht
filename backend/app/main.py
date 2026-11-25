"""The API and the built PWA."""

import asyncio
import contextlib
import contextvars
import json
import logging
import re
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx2
from fastapi import Body, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from starlette.datastructures import UploadFile as StarletteUpload

from . import auth
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
from .reports import REPORT_SUFFIXES, digest, find_reports, parse_report, slugify

MAX_UPLOAD = 5 * 1024 * 1024
MAX_LISTING_PAGE = 8 * 1024 * 1024
# One photo, video or voice memo. A phone video of a few minutes fits.
MAX_MEDIA = 2 * 1024 * 1024 * 1024
MAX_THUMB = 2 * 1024 * 1024
# Files shared to the app wait this long for someone to pick their house.
SHARE_DAYS = 7
MEDIA_KINDS = {"image": "foto", "video": "video", "audio": "audio"}
BOOKMARKLET_TOKEN = "bookmarkletToken"
# The bookmarklet posts from the listing site; it carries a token and no cookies.
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


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
) -> FastAPI:
    settings = settings or load_settings()
    setup_logging()
    state = ImportState()
    listing_lock = asyncio.Lock()

    def listing_folder(house_id: str) -> Path:
        return settings.data_dir / "listings" / slugify(house_id)

    def fetch_one(house_id: str, url: str, html: str | None = None) -> None:
        """Fetch a house's listing page and photos, or keep `html` that the browser sent;
        record how it went."""
        with httpx2.Client(transport=listing_transport) as client:
            try:
                if html is None:
                    result = fetch_listing(url, listing_folder(house_id), client)
                else:
                    result = save_page(html, url, listing_folder(house_id), client)
            except Blocked as exc:
                log.warning("Listing of %s blocked: %s", house_id, exc)
                db().save_listing(house_id, url, "blocked", str(exc))
                return
            except NotAListing as exc:
                log.warning("Listing of %s: %s", house_id, exc)
                db().save_listing(house_id, url, "error", str(exc))
                return
            except Exception as exc:
                log.exception("Listing of %s failed", house_id)
                db().save_listing(
                    house_id, url, "error", f"Ophalen mislukt: {type(exc).__name__}: {exc}"
                )
                return
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
        return await call_next(request)

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
        upload: UploadFile, thumb: UploadFile | None = None, **fields: Any
    ) -> dict[str, Any]:
        kind, mime = media_kind(upload)
        media_id = secrets.token_urlsafe(12)
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
    ) -> dict[str, Any]:
        house_or_404(house_id)
        return store_media(
            file, thumb, house_id=house_id, item=item, duration=duration, person=person(request)
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
            headers={"Cache-Control": "private, max-age=31536000, immutable"},
        )

    @app.get("/api/media/{media_id}/thumb")
    def media_thumb(media_id: str) -> FileResponse:
        path = media_path(media_id, True)
        if not path.exists():
            raise HTTPException(404, "Geen voorbeeld.")
        return FileResponse(
            path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
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
        body = await request.body()
        if len(body) > MAX_LISTING_PAGE:
            raise HTTPException(413, "Deze pagina is te groot.")
        try:
            data = json.loads(body)
            url, html = str(data["url"]), str(data["html"])
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(400, "Stuur url en html mee.") from exc
        if not url.startswith(("http://", "https://")):
            raise HTTPException(400, "Dit is geen webadres.")
        if not db().get_house(house_id):
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        async with listing_lock:
            await asyncio.to_thread(fetch_one, house_id, url, html)
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

        body = await request.body()
        if len(body) > MAX_LISTING_PAGE:
            return answer(413, "Deze pagina is te groot.")
        try:
            data = json.loads(body)
            token, url, html = str(data["token"]), str(data["url"]), str(data["html"])
        except (ValueError, KeyError, TypeError):
            return answer(400, "Stuur token, url en html mee.")
        expected = db().get_setting(BOOKMARKLET_TOKEN)
        if not isinstance(expected, str) or not secrets.compare_digest(token, expected):
            return answer(
                403, "Deze bladwijzer is verlopen. Zet hem opnieuw neer vanuit Huizenjacht."
            )
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
            await asyncio.to_thread(fetch_one, house["id"], url, html)
        saved = house_or_404(house["id"])
        listing = saved.get("listing") or {}
        name = saved["mine"].get("adres") or saved["report"].get("adres") or saved["id"]
        if listing.get("status") != "ok":
            return answer(422, listing.get("message") or "De pagina kon niet worden opgeslagen.")
        photos = listing.get("photos", 0)
        return answer(
            200,
            f"Opgeslagen: {name}, {photos} foto's.",
            house=saved["id"],
            link=f"{settings.public_url or ''}/#/huis/{saved['id']}",
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
        if not valid or key in {PEOPLE, BOOKMARKLET_TOKEN}:
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

    @app.get("/api/backup")
    def backup() -> JSONResponse:
        stamp = now()[:10]
        return JSONResponse(
            db().export(),
            headers={"Content-Disposition": f'attachment; filename="huizenjacht-{stamp}.json"'},
        )

    @app.post("/api/backup/restore")
    def restore(backup: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if backup.get("format") != "huizenjacht-backup":
            raise HTTPException(400, "Dit is geen Huizenjacht-back-up.")
        count = db().restore(backup)
        claim_old_answers(db())
        return {"houses": count}

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
