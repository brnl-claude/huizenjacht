"""The API and the built PWA."""

import asyncio
import contextlib
import re
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from . import auth
from .config import Settings, load_settings
from .db import Database, now
from .reports import REPORT_SUFFIXES, digest, find_reports, parse_report, slugify

MAX_UPLOAD = 5 * 1024 * 1024


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


def create_app(settings: Settings | None = None, oidc_transport: Any = None) -> FastAPI:
    settings = settings or load_settings()
    state = ImportState()

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

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db = Database(settings.data_dir / "huizenjacht.sqlite")
        task = asyncio.create_task(scan_forever())
        yield
        task.cancel()
        app.state.db.close()

    app = FastAPI(title="Huizenjacht", lifespan=lifespan, docs_url=None, redoc_url=None)

    def db() -> Database:
        return app.state.db

    auth.install(app, settings, db, oidc_transport)

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
    def create_house(mine: dict[str, Any] = Body(...)) -> dict[str, Any]:
        base = slugify(str(mine.get("adres") or "huis"))
        house_id, taken = base, db().ids()
        while house_id in taken:
            house_id = f"{base}-{secrets.token_hex(2)}"
        return db().create_manual(house_id, mine)

    @app.patch("/api/houses/{house_id}")
    def update_house(house_id: str, changes: dict[str, Any] = Body(...)) -> dict[str, Any]:
        house = db().update_mine(house_id, changes)
        if not house:
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        return house

    @app.delete("/api/houses/{house_id}", status_code=204)
    def delete_house(house_id: str) -> Response:
        if not db().delete_house(house_id):
            raise HTTPException(404, "Dit huis bestaat niet (meer).")
        return Response(status_code=204)

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
        if not re.fullmatch(r"[a-z][a-zA-Z0-9-]{0,40}", key):
            raise HTTPException(400, "Onbekende instelling.")
        db().set_setting(key, value)
        return {"value": value}

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
        return {"houses": db().restore(backup)}

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_not_found(rest: str) -> None:
        raise HTTPException(404, "Onbekend adres.")

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
