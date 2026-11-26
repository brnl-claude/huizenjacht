"""SQLite storage. A household uses the app, so one small file is plenty.

A house keeps what its report says (report) apart from what the people add or change in the
app (mine). A newer report replaces `report` and never touches `mine`. Status, favourite,
viewing and offer in `mine` are shared; each person's own grade, ratings, notes and
checklist answers sit under mine["personen"][<person key>].
"""

import hashlib
import json
import re
import sqlite3
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS houses (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,            -- report-dir, upload or manual
    source_path TEXT,                -- file name within the reports folder or upload
    source_hash TEXT,
    report TEXT NOT NULL DEFAULT '{}',
    report_body TEXT NOT NULL DEFAULT '',
    mine TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
    house_id TEXT PRIMARY KEY,       -- the page behind the house's link (Funda)
    url TEXT NOT NULL,
    status TEXT NOT NULL,            -- ok, blocked or error
    message TEXT,
    photos INTEGER NOT NULL DEFAULT 0,
    has_page INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    description TEXT,
    fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    name TEXT,
    email TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
-- Photos, videos and voice memos. A file shared to the app waits in a share (house_id NULL)
-- until someone picks its house. The file itself is in <data dir>/media/<id>.
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    house_id TEXT,
    share_id TEXT,
    item TEXT,                       -- checklist item id, or NULL for the house in general
    kind TEXT NOT NULL,              -- foto, video or audio
    mime TEXT NOT NULL,
    name TEXT,
    size INTEGER NOT NULL,
    duration REAL,
    thumb INTEGER NOT NULL DEFAULT 0,
    person TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_house ON media (house_id);
CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    title TEXT,
    text TEXT,
    url TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# What a full backup keeps of the rows behind the files (media/, listings/).
MEDIA_COLUMNS = (
    "id",
    "house_id",
    "share_id",
    "item",
    "kind",
    "mime",
    "name",
    "size",
    "duration",
    "thumb",
    "person",
    "note",
    "created_at",
)
LISTING_COLUMNS = (
    "house_id",
    "url",
    "status",
    "message",
    "photos",
    "has_page",
    "title",
    "description",
    "fetched_at",
)


_SELECT = (
    "SELECT h.*, l.url AS l_url, l.status AS l_status, l.message AS l_message,"
    " l.photos AS l_photos, l.has_page AS l_has_page, l.fetched_at AS l_fetched_at"
    " FROM houses h LEFT JOIN listings l ON l.house_id = h.id"
)


# Fields in `mine` that belong to one person.
PERSONAL = ("cijfer", "aspecten", "notities", "checklist")
# The person without a login (HJ_AUTH_MODE=none), and answers from before 0.6.0 whose owner
# is not known yet.
LOCAL = "lokaal"
EARLIER = "eerder"
# Setting with everyone who has logged in: key -> {naam, kleur}.
PEOPLE = "personen"


def person_key(subject: str) -> str:
    """A short, stable key for a login, without its issuer and subject in every answer."""
    return hashlib.sha256(subject.encode()).hexdigest()[:12]


def first_name(user: dict[str, Any]) -> str | None:
    name = (user.get("name") or "").strip() or (user.get("email") or "").split("@")[0]
    return name.split()[0] if name else None


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        # Called after every change to a house: (house id or None for all, removed).
        self.on_change: Callable[[str | None, bool], None] | None = None
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(SCHEMA)
            # Added in 0.21.0: which device a login is on, and how it logged in.
            columns = {r["name"] for r in self._conn.execute("PRAGMA table_info(sessions)")}
            # groups: the provider's groups at login (JSON list), for who may manage backups.
            for column in ("device", "via", "groups"):
                if column not in columns:
                    self._conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} TEXT")
            self._conn.commit()
            # A failed fetch used to replace the status of a good copy; the copy is what counts.
            self._conn.execute(
                "UPDATE listings SET status = 'ok', message = NULL"
                " WHERE status != 'ok' AND has_page = 1"
            )
            self._conn.commit()

    def _changed(self, house_id: str | None, removed: bool = False) -> None:
        if self.on_change:
            self.on_change(house_id, removed)

    def close(self) -> None:
        self._conn.close()

    # Houses

    @staticmethod
    def _house(row: sqlite3.Row, media: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "id": row["id"],
            "source": row["source"],
            "sourcePath": row["source_path"],
            "report": json.loads(row["report"]),
            "reportBody": row["report_body"],
            "mine": json.loads(row["mine"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "listing": None
            if row["l_status"] is None
            else {
                "url": row["l_url"],
                "status": row["l_status"],
                "message": row["l_message"],
                "photos": row["l_photos"],
                "hasPage": bool(row["l_has_page"]),
                "fetchedAt": row["l_fetched_at"],
            },
            "media": media or [],
        }

    def list_houses(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(_SELECT + " ORDER BY h.created_at").fetchall()
            media: dict[str, list[dict[str, Any]]] = {}
            for m in self._conn.execute(
                "SELECT * FROM media WHERE house_id IS NOT NULL ORDER BY created_at, rowid"
            ):
                media.setdefault(m["house_id"], []).append(self._media(m))
        return [self._house(r, media.get(r["id"])) for r in rows]

    def get_house(self, house_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(_SELECT + " WHERE h.id = ?", (house_id,)).fetchone()
            media = [
                self._media(m)
                for m in self._conn.execute(
                    "SELECT * FROM media WHERE house_id = ? ORDER BY created_at, rowid", (house_id,)
                )
            ]
        return self._house(row, media) if row else None

    def source_hash(self, house_id: str) -> str | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT source_hash FROM houses WHERE id = ?", (house_id,)
            ).fetchone()
        return row["source_hash"] if row else None

    def upsert_report(
        self,
        house_id: str,
        *,
        source: str,
        source_path: str,
        source_hash: str,
        report: dict[str, Any],
        body: str,
    ) -> str:
        """Store a report. Returns created, updated or unchanged."""
        stamp = now()
        with self._lock:
            row = self._conn.execute(
                "SELECT source_hash FROM houses WHERE id = ?", (house_id,)
            ).fetchone()
            if row and row["source_hash"] == source_hash:
                return "unchanged"
            if row:
                self._conn.execute(
                    "UPDATE houses SET source = ?, source_path = ?, source_hash = ?, report = ?,"
                    " report_body = ?, updated_at = ? WHERE id = ?",
                    (source, source_path, source_hash, json.dumps(report), body, stamp, house_id),
                )
            else:
                self._conn.execute(
                    "INSERT INTO houses (id, source, source_path, source_hash, report,"
                    " report_body, mine, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)",
                    (
                        house_id,
                        source,
                        source_path,
                        source_hash,
                        json.dumps(report),
                        body,
                        stamp,
                        stamp,
                    ),
                )
            self._conn.commit()
        self._changed(house_id)
        return "updated" if row else "created"

    def create_manual(self, house_id: str, mine: dict[str, Any]) -> dict[str, Any]:
        stamp = now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO houses (id, source, mine, created_at, updated_at)"
                " VALUES (?, 'manual', ?, ?, ?)",
                (house_id, json.dumps(mine), stamp, stamp),
            )
            self._conn.commit()
        self._changed(house_id)
        house = self.get_house(house_id)
        assert house
        return house

    def update_mine(
        self, house_id: str, changes: dict[str, Any], person: str = LOCAL
    ) -> dict[str, Any] | None:
        """Merge changes into the app's data. A null value removes that field.

        Personal fields go to this person's own part; the rest is shared.
        """
        with self._lock:
            row = self._conn.execute("SELECT mine FROM houses WHERE id = ?", (house_id,)).fetchone()
            if not row:
                return None
            mine = json.loads(row["mine"])
            people = mine.setdefault("personen", {})
            own = people.setdefault(person, {})
            for key, value in changes.items():
                if key == "personen":
                    continue
                target = own if key in PERSONAL else mine
                if value is None:
                    target.pop(key, None)
                else:
                    target[key] = value
            if not own:
                people.pop(person, None)
            if not people:
                mine.pop("personen")
            self._conn.execute(
                "UPDATE houses SET mine = ?, updated_at = ? WHERE id = ?",
                (json.dumps(mine), now(), house_id),
            )
            self._conn.commit()
        self._changed(house_id)
        return self.get_house(house_id)

    # People

    def people(self) -> dict[str, dict[str, Any]]:
        return self.get_setting(PEOPLE, {})

    def register_person(self, key: str, name: str | None) -> None:
        people = self.people()
        entry = people.get(key)
        if entry and (not name or entry.get("naam") == name):
            return
        if entry:
            entry["naam"] = name
        else:
            used = {p.get("kleur") for p in people.values()}
            color = next(i for i in range(len(people) + 1) if i not in used)
            people[key] = {"naam": name or "Iemand", "kleur": -1 if key == EARLIER else color}
        self.set_setting(PEOPLE, people)

    def login_subjects(self) -> set[str]:
        with self._lock:
            return {r["subject"] for r in self._conn.execute("SELECT subject FROM sessions")}

    def legacy_answers(self) -> bool:
        """Whether a house still has personal fields from before 0.6.0 outside any person."""
        with self._lock:
            rows = self._conn.execute("SELECT mine FROM houses").fetchall()
        return any(set(PERSONAL) & json.loads(r["mine"]).keys() for r in rows)

    def move_answers(self, to: str, *, legacy: bool = False, source: str | None = None) -> int:
        """Give answers to a person: the old ones outside any person, or another person's.

        Answers the person already has win. Returns the number of houses changed.
        """
        changed = 0
        with self._lock:
            rows = self._conn.execute("SELECT id, mine FROM houses").fetchall()
            for row in rows:
                mine = json.loads(row["mine"])
                people = mine.setdefault("personen", {})
                if legacy:
                    found = {k: mine.pop(k) for k in PERSONAL if k in mine}
                else:
                    found = people.pop(source, None) or {}
                if not found:
                    continue
                people[to] = {**found, **people.get(to, {})}
                self._conn.execute(
                    "UPDATE houses SET mine = ? WHERE id = ?", (json.dumps(mine), row["id"])
                )
                changed += 1
            self._conn.commit()
        if changed:
            self._changed(None)
        return changed

    def delete_house(self, house_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM houses WHERE id = ?", (house_id,))
            self._conn.execute("DELETE FROM listings WHERE house_id = ?", (house_id,))
            self._conn.execute("DELETE FROM media WHERE house_id = ?", (house_id,))
            self._conn.commit()
        if cur.rowcount:
            self._changed(house_id, True)
        return cur.rowcount > 0

    # Media

    @staticmethod
    def _media(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "item": row["item"],
            "kind": row["kind"],
            "mime": row["mime"],
            "name": row["name"],
            "size": row["size"],
            "duration": row["duration"],
            "thumb": bool(row["thumb"]),
            "person": row["person"],
            "note": row["note"],
            "createdAt": row["created_at"],
        }

    def add_media(
        self,
        media_id: str,
        *,
        house_id: str | None = None,
        share_id: str | None = None,
        item: str | None = None,
        kind: str,
        mime: str,
        name: str | None,
        size: int,
        duration: float | None = None,
        thumb: bool = False,
        person: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self._conn.execute(
                "INSERT INTO media (id, house_id, share_id, item, kind, mime, name, size,"
                " duration, thumb, person, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    media_id,
                    house_id,
                    share_id,
                    item or None,
                    kind,
                    mime,
                    name,
                    size,
                    duration,
                    int(thumb),
                    person,
                    now(),
                ),
            )
            self._conn.commit()
        if house_id:
            self._changed(house_id)
        return self.get_media(media_id) or {}

    def get_media(self, media_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
        if not row:
            return None
        return {**self._media(row), "house": row["house_id"], "share": row["share_id"]}

    def update_media(self, media_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        found = self.get_media(media_id)
        if not found:
            return None
        fields = {k: changes[k] for k in ("item", "note") if k in changes}
        if "thumb" in changes:
            fields["thumb"] = int(bool(changes["thumb"]))
        if "item" in fields:
            fields["item"] = fields["item"] or None
        if "note" in fields:
            fields["note"] = str(fields["note"] or "")
        if fields:
            with self._lock:
                self._conn.execute(
                    f"UPDATE media SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                    (*fields.values(), media_id),
                )
                self._conn.commit()
            if found["house"]:
                self._changed(found["house"])
        return self.get_media(media_id)

    def delete_media(self, media_id: str) -> dict[str, Any] | None:
        found = self.get_media(media_id)
        if found:
            with self._lock:
                self._conn.execute("DELETE FROM media WHERE id = ?", (media_id,))
                self._conn.commit()
            if found["house"]:
                self._changed(found["house"])
        return found

    def house_media_ids(self, house_id: str) -> list[str]:
        with self._lock:
            rows = self._conn.execute("SELECT id FROM media WHERE house_id = ?", (house_id,))
            return [r["id"] for r in rows]

    def add_share(self, share_id: str, title: str, text: str, url: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO shares (id, title, text, url, created_at) VALUES (?, ?, ?, ?, ?)",
                (share_id, title or None, text or None, url or None, now()),
            )
            self._conn.commit()

    def get_share(self, share_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
            files = self._conn.execute(
                "SELECT * FROM media WHERE share_id = ? AND house_id IS NULL ORDER BY rowid",
                (share_id,),
            ).fetchall()
        if not row:
            return None
        return {
            "id": row["id"],
            "title": row["title"],
            "text": row["text"],
            "url": row["url"],
            "createdAt": row["created_at"],
            "files": [self._media(f) for f in files],
        }

    def file_share(self, share_id: str, house_id: str, item: str | None, person: str) -> int:
        """Moves a share's files to a house; returns how many."""
        with self._lock:
            cur = self._conn.execute(
                "UPDATE media SET house_id = ?, item = ?, person = ?"
                " WHERE share_id = ? AND house_id IS NULL",
                (house_id, item or None, person, share_id),
            )
            self._conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
            self._conn.commit()
        if cur.rowcount:
            self._changed(house_id)
        return cur.rowcount

    def drop_shares(
        self, older_than: timedelta | None = None, share_id: str | None = None
    ) -> list[str]:
        """Removes shares nobody filed; returns the ids of their files, to delete them."""
        with self._lock:
            if share_id:
                shares = [share_id]
            else:
                limit = (datetime.now(UTC) - (older_than or timedelta(0))).isoformat(
                    timespec="seconds"
                )
                shares = [
                    r["id"]
                    for r in self._conn.execute(
                        "SELECT id FROM shares WHERE created_at < ?", (limit,)
                    )
                ]
            files: list[str] = []
            for sid in shares:
                files += [
                    r["id"]
                    for r in self._conn.execute(
                        "SELECT id FROM media WHERE share_id = ? AND house_id IS NULL", (sid,)
                    )
                ]
                self._conn.execute(
                    "DELETE FROM media WHERE share_id = ? AND house_id IS NULL", (sid,)
                )
                self._conn.execute("DELETE FROM shares WHERE id = ?", (sid,))
            self._conn.commit()
        return files

    def ids(self) -> set[str]:
        with self._lock:
            return {r["id"] for r in self._conn.execute("SELECT id FROM houses")}

    # Settings

    def get_setting(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
            self._conn.commit()

    # Listings (photos and a copy of the page behind the house's link)

    def listing_due(self) -> list[tuple[str, str]]:
        """(house id, url) of houses whose listing is missing, outdated or worth retrying."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT h.id, h.report, h.mine, l.url AS l_url, l.status AS l_status,"
                " l.fetched_at AS l_fetched FROM houses h"
                " LEFT JOIN listings l ON l.house_id = h.id"
            ).fetchall()
        due = []
        stamp = datetime.now(UTC)
        for row in rows:
            url = json.loads(row["mine"]).get("url") or json.loads(row["report"]).get("url")
            if not url or not str(url).startswith(("http://", "https://")):
                continue
            if row["l_status"] is None or row["l_url"] != url:
                due.append((row["id"], url))
                continue
            if row["l_status"] == "ok":
                # A good copy stays until Bram sends a new one or asks for a refresh.
                continue
            age = stamp - datetime.fromisoformat(row["l_fetched"])
            # Funda answers servers with a captcha, so do not keep knocking.
            retry = timedelta(days=3) if row["l_status"] == "blocked" else timedelta(hours=6)
            if age >= retry:
                due.append((row["id"], url))
        return due

    def house_url(self, house_id: str) -> str | None:
        house = self.get_house(house_id)
        if not house:
            return None
        return house["mine"].get("url") or house["report"].get("url")

    def save_listing(
        self,
        house_id: str,
        url: str,
        status: str,
        message: str | None = None,
        photos: int = 0,
        has_page: bool = False,
        title: str | None = None,
        description: str | None = None,
    ) -> None:
        with self._lock:
            old = self._conn.execute(
                "SELECT status, photos, has_page FROM listings WHERE house_id = ?", (house_id,)
            ).fetchone()
            # A failed try never replaces a good copy: that copy, and its status, stay.
            if status != "ok" and old and old["status"] == "ok" and old["has_page"]:
                return
            if status != "ok" and old and old["photos"]:
                photos, has_page = old["photos"], bool(old["has_page"])
            self._conn.execute(
                "INSERT INTO listings (house_id, url, status, message, photos, has_page, title,"
                " description, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(house_id) DO UPDATE SET url = excluded.url,"
                " status = excluded.status, message = excluded.message,"
                " photos = excluded.photos, has_page = excluded.has_page,"
                " title = excluded.title, description = excluded.description,"
                " fetched_at = excluded.fetched_at",
                (house_id, url, status, message, photos, int(has_page), title, description, now()),
            )
            self._conn.commit()
        self._changed(house_id)

    # Login sessions (only with HJ_AUTH_MODE=oidc)

    def create_session(
        self,
        token_hash: str,
        user: dict[str, Any],
        days: int,
        device: str | None = None,
        via: str = "oidc",
    ) -> None:
        stamp = datetime.now(UTC)
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
            self._conn.execute(
                "INSERT INTO sessions (token_hash, subject, name, email, created_at, expires_at,"
                " device, via, groups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    token_hash,
                    user["subject"],
                    user.get("name"),
                    user.get("email"),
                    now(),
                    (stamp + timedelta(days=days)).isoformat(timespec="seconds"),
                    device,
                    via,
                    json.dumps([str(g) for g in user.get("groups") or []]),
                ),
            )
            self._conn.commit()
        self.register_person(person_key(user["subject"]), first_name(user))

    def find_session(self, token_hash: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT subject, name, email, expires_at, groups FROM sessions"
                " WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
        if not row or row["expires_at"] <= now():
            return None
        return {
            "subject": row["subject"],
            "name": row["name"],
            "email": row["email"],
            "groups": json.loads(row["groups"] or "[]"),
        }

    def list_sessions(self, subject: str) -> list[dict[str, Any]]:
        """Someone's logins that have not ended, newest first. `id` is a short part of the
        token's hash: enough to end one, never the token itself."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT token_hash, device, via, created_at, expires_at FROM sessions"
                " WHERE subject = ? AND expires_at > ? ORDER BY created_at DESC",
                (subject, now()),
            ).fetchall()
        return [
            {
                "id": r["token_hash"][:16],
                "device": r["device"],
                "via": r["via"] or "oidc",
                "createdAt": r["created_at"],
                "expiresAt": r["expires_at"],
            }
            for r in rows
        ]

    def end_session_of(self, subject: str, session_id: str) -> bool:
        """End one of this person's own logins, by the id from list_sessions."""
        if len(session_id) != 16 or not all(c in "0123456789abcdef" for c in session_id):
            return False
        with self._lock:
            cursor = self._conn.execute(
                "DELETE FROM sessions WHERE subject = ? AND substr(token_hash, 1, 16) = ?",
                (subject, session_id),
            )
            self._conn.commit()
        return cursor.rowcount > 0

    def end_session(self, token_hash: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            self._conn.commit()

    # Backup

    def export(self) -> dict[str, Any]:
        with self._lock:
            houses = [dict(r) for r in self._conn.execute("SELECT * FROM houses")]
            settings = {
                r["key"]: json.loads(r["value"])
                for r in self._conn.execute("SELECT * FROM settings")
            }
        for h in houses:
            h["report"] = json.loads(h["report"])
            h["mine"] = json.loads(h["mine"])
        return {
            "format": "huizenjacht-backup",
            "version": 1,
            "exportedAt": now(),
            "houses": houses,
            "settings": settings,
        }

    def file_rows(self) -> dict[str, list[dict[str, Any]]]:
        """The media and listing rows for a full backup: what the files in it belong to.
        Media still waiting in a share (no house yet) stay out; they go away after a week."""
        with self._lock:
            media = [
                dict(r)
                for r in self._conn.execute("SELECT * FROM media WHERE house_id IS NOT NULL")
            ]
            listings = [dict(r) for r in self._conn.execute("SELECT * FROM listings")]
        return {"media": media, "listings": listings}

    def house_count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM houses").fetchone()[0]

    def media_sizes(self) -> list[tuple[str, str]]:
        """(id, kind) of every media file, for the disk usage."""
        with self._lock:
            return [(r["id"], r["kind"]) for r in self._conn.execute("SELECT id, kind FROM media")]

    def _replace_rows(self, table: str, columns: tuple[str, ...], rows: list[Any]) -> None:
        self._conn.execute(f"DELETE FROM {table}")
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError(f"ongeldige regel in {table}")
            try:
                self._conn.execute(
                    f"INSERT INTO {table} ({', '.join(columns)})"
                    f" VALUES ({', '.join('?' for _ in columns)})",
                    tuple(row.get(c) for c in columns),
                )
            except sqlite3.Error as exc:
                raise ValueError(f"ongeldige regel in {table}") from exc

    def restore(
        self, backup: dict[str, Any], files: dict[str, list[dict[str, Any]]] | None = None
    ) -> int:
        """Replace all houses and settings, all or nothing. Raises ValueError for a bad backup.
        With `files` (from a full backup) the media and listing rows are replaced too."""
        houses = backup.get("houses", [])
        settings = backup.get("settings", {})
        if not isinstance(houses, list) or not isinstance(settings, dict):
            raise ValueError("houses en settings ontbreken")
        for h in houses:
            if not isinstance(h, dict) or not all(
                isinstance(h.get(k), str) for k in ("id", "source", "created_at", "updated_at")
            ):
                raise ValueError("een huis mist id, source of datum")
            # An id becomes part of folder names (documents, listings).
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", h["id"]):
                raise ValueError(f"ongeldig huis-id {h['id']!r}")
        with self._lock, self._conn:
            # `with self._conn`: commit at the end, roll back on any error, so a backup that
            # fails halfway never leaves the houses deleted.
            self._conn.execute("DELETE FROM houses")
            self._conn.execute("DELETE FROM settings")
            for h in houses:
                self._conn.execute(
                    "INSERT INTO houses (id, source, source_path, source_hash, report,"
                    " report_body, mine, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        h["id"],
                        h["source"],
                        h.get("source_path"),
                        h.get("source_hash"),
                        json.dumps(h.get("report", {})),
                        h.get("report_body", ""),
                        json.dumps(h.get("mine", {})),
                        h["created_at"],
                        h["updated_at"],
                    ),
                )
            for key, value in settings.items():
                self._conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?)", (str(key), json.dumps(value))
                )
            if files is not None:
                self._conn.execute("DELETE FROM shares")
                self._replace_rows("media", MEDIA_COLUMNS, files.get("media", []))
                self._replace_rows("listings", LISTING_COLUMNS, files.get("listings", []))
        self._changed(None)
        return len(houses)
