"""SQLite storage. One person uses the app, so one small file is plenty.

A house keeps what its report says (report) apart from what the person adds or changes in
the app (mine). A newer report replaces `report` and never touches `mine`.
"""

import json
import sqlite3
import threading
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
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    name TEXT,
    email TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(SCHEMA)

    def close(self) -> None:
        self._conn.close()

    # Houses

    @staticmethod
    def _house(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "source": row["source"],
            "sourcePath": row["source_path"],
            "report": json.loads(row["report"]),
            "reportBody": row["report_body"],
            "mine": json.loads(row["mine"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def list_houses(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM houses ORDER BY created_at").fetchall()
        return [self._house(r) for r in rows]

    def get_house(self, house_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM houses WHERE id = ?", (house_id,)).fetchone()
        return self._house(row) if row else None

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
        house = self.get_house(house_id)
        assert house
        return house

    def update_mine(self, house_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        """Merge changes into the person's own data. A null value removes that field."""
        with self._lock:
            row = self._conn.execute("SELECT mine FROM houses WHERE id = ?", (house_id,)).fetchone()
            if not row:
                return None
            mine = json.loads(row["mine"])
            for key, value in changes.items():
                if value is None:
                    mine.pop(key, None)
                else:
                    mine[key] = value
            self._conn.execute(
                "UPDATE houses SET mine = ?, updated_at = ? WHERE id = ?",
                (json.dumps(mine), now(), house_id),
            )
            self._conn.commit()
        return self.get_house(house_id)

    def delete_house(self, house_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM houses WHERE id = ?", (house_id,))
            self._conn.commit()
        return cur.rowcount > 0

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

    # Login sessions (only with HJ_AUTH_MODE=oidc)

    def create_session(self, token_hash: str, user: dict[str, Any], days: int) -> None:
        stamp = datetime.now(UTC)
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
            self._conn.execute(
                "INSERT INTO sessions (token_hash, subject, name, email, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    token_hash,
                    user["subject"],
                    user.get("name"),
                    user.get("email"),
                    now(),
                    (stamp + timedelta(days=days)).isoformat(timespec="seconds"),
                ),
            )
            self._conn.commit()

    def find_session(self, token_hash: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT subject, name, email, expires_at FROM sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
        if not row or row["expires_at"] <= now():
            return None
        return {"subject": row["subject"], "name": row["name"], "email": row["email"]}

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

    def restore(self, backup: dict[str, Any]) -> int:
        houses = backup.get("houses", [])
        with self._lock:
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
            for key, value in backup.get("settings", {}).items():
                self._conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value))
                )
            self._conn.commit()
        return len(houses)
