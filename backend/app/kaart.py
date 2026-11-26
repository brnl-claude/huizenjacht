"""A small map of where a house is, for the PDF.

The server looks up the address once at PDOK's Locatieserver (the Dutch government's free
address register, no key) and fetches OpenStreetMap tiles; both are kept in <data>/kaart, so
each house and each tile is fetched only once and the browser never talks to anyone but the
app. HJ_MAP=false turns it off: then nothing leaves the server and the PDF has no map.
"""

import json
import logging
import re
import threading
from pathlib import Path
from typing import Any

import httpx2

log = logging.getLogger(__name__)

PDOK = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
MIN_ZOOM, MAX_ZOOM = 10, 18
POINT = re.compile(r"POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)")


def _plain(text: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


PLACE_NAMES = {"denhaag": "sgravenhage", "denbosch": "shertogenbosch"}


def matches(doc: dict[str, Any], fields: dict[str, Any]) -> bool:
    """PDOK answers every search with its best guess, even in another town: only take an
    answer on the right street, and in the right postcode or town."""
    street = _plain(doc.get("straatnaam"))
    if not street or street not in _plain(fields.get("adres")):
        return False
    postcode = _plain(fields.get("postcode"))
    if postcode:
        return postcode == _plain(doc.get("postcode"))
    town = _plain(fields.get("plaats"))
    town = PLACE_NAMES.get(town, town)
    names = {_plain(doc.get("woonplaatsnaam")), _plain(doc.get("gemeentenaam"))}
    return bool(town) and town in names


def address_query(fields: dict[str, Any]) -> str | None:
    """'Lindenlaan 14, 2611 AB Delft', or None without a street address."""
    adres = str(fields.get("adres") or "").strip()
    if not adres:
        return None
    rest = " ".join(str(fields.get(k) or "").strip() for k in ("postcode", "plaats")).strip()
    return f"{adres}, {rest}" if rest else adres


class MapService:
    def __init__(self, data_dir: Path, version: str, transport: Any = None) -> None:
        self.folder = data_dir / "kaart"
        self.transport = transport
        self.user_agent = f"Huizenjacht/{version} (+https://github.com/brnl-claude/huizenjacht)"
        self.lock = threading.Lock()

    def _client(self) -> httpx2.Client:
        return httpx2.Client(
            transport=self.transport,
            timeout=10,
            headers={"User-Agent": self.user_agent},
            follow_redirects=True,
        )

    def _places(self) -> dict[str, Any]:
        path = self.folder / "ligging.json"
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return {}

    def locate(self, fields: dict[str, Any]) -> dict[str, float] | None:
        """Latitude and longitude of a house's address, from the cache or PDOK. None when
        unknown; a failed lookup is not remembered, so it is tried again next time."""
        query = address_query(fields)
        if not query:
            return None
        key = query.lower()
        with self.lock:
            known = self._places().get(key)
        if known is not None:
            return known or None
        try:
            with self._client() as client:
                res = client.get(PDOK, params={"q": query, "rows": 5, "fq": "type:adres"})
                res.raise_for_status()
                docs = res.json().get("response", {}).get("docs", [])
        except (httpx2.HTTPError, ValueError) as exc:
            log.warning("Ligging opzoeken mislukt voor %s: %s", query, exc)
            return None
        found = next((d for d in docs if matches(d, fields)), None)
        match = POINT.match(found.get("centroide_ll", "")) if found else None
        place = {"lat": float(match[2]), "lon": float(match[1])} if match else {}
        with self.lock:
            places = self._places()
            places[key] = place
            self.folder.mkdir(parents=True, exist_ok=True)
            tmp = self.folder / "ligging.json.tmp"
            tmp.write_text(json.dumps(places, indent=1, sort_keys=True))
            tmp.replace(self.folder / "ligging.json")
        return place or None

    def tile(self, z: int, x: int, y: int) -> Path | None:
        """One OpenStreetMap tile, kept on disk after the first fetch."""
        if not (MIN_ZOOM <= z <= MAX_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z):
            return None
        path = self.folder / "tegels" / str(z) / str(x) / f"{y}.png"
        if path.is_file():
            return path
        try:
            with self._client() as client:
                res = client.get(TILES.format(z=z, x=x, y=y))
                res.raise_for_status()
        except httpx2.HTTPError as exc:
            log.warning("Kaarttegel %s/%s/%s ophalen mislukt: %s", z, x, y, exc)
            return None
        if not res.content.startswith(b"\x89PNG"):
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(res.content)
        tmp.replace(path)
        return path
