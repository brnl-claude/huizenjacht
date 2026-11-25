"""Reading house reports: Markdown with optional YAML front matter, or JSON.

The reports are written elsewhere (the "Huizen beoordelen" project) and are never stored in
this repository. The app reads them from a mounted folder (a git-sync checkout of a private
repository) or from uploads, and keeps them in its own database.

A report is tolerant: front matter is best, but lines such as `**Vraagprijs:** € 450.000`,
`- Woonoppervlakte: 120 m²` and two-column Markdown tables are recognised too.
"""

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import yaml

REPORT_SUFFIXES = {".md", ".markdown", ".json"}

# Canonical field -> the names a report may use for it (lowercase, without accents).
ALIASES: dict[str, list[str]] = {
    "adres": ["adres", "address", "straat"],
    "postcode": ["postcode", "zip"],
    "plaats": ["plaats", "woonplaats", "stad", "city", "gemeente"],
    "wijk": ["wijk", "buurt"],
    "vraagprijs": ["vraagprijs", "prijs", "koopprijs", "price"],
    "woonoppervlakte": ["woonoppervlakte", "woonoppervlak", "oppervlakte", "gbo", "m2", "wonen"],
    "perceel": ["perceel", "perceeloppervlakte", "kavel", "perceelgrootte"],
    "inhoud": ["inhoud"],
    "kamers": ["kamers", "aantal kamers"],
    "slaapkamers": ["slaapkamers", "aantal slaapkamers"],
    "badkamers": ["badkamers", "aantal badkamers"],
    "bouwjaar": ["bouwjaar", "built"],
    "energielabel": ["energielabel", "label", "energie label"],
    "woningtype": ["woningtype", "type", "soort woning", "soort"],
    "tuin": ["tuin", "tuinligging"],
    "parkeren": ["parkeren", "parkeergelegenheid"],
    "servicekosten": ["servicekosten", "vve", "vve bijdrage", "vve-bijdrage"],
    "erfpacht": ["erfpacht", "eigendomssituatie"],
    "url": ["url", "link", "funda", "funda url", "advertentie"],
    "foto": ["foto", "afbeelding", "image", "photo"],
    "makelaar": ["makelaar", "verkopend makelaar"],
    "score": ["score", "beoordeling", "cijfer", "totaalscore", "eindscore"],
    "advies": ["advies", "conclusie", "oordeel", "verdict"],
    "samenvatting": ["samenvatting", "summary"],
    "pluspunten": ["pluspunten", "voordelen", "pros", "sterke punten"],
    "minpunten": ["minpunten", "nadelen", "cons", "aandachtspunten", "zwakke punten"],
    "bezichtigingspunten": [
        "aandachtspunten_bezichtiging",
        "aandachtspunten bezichtiging",
        "bezichtigingspunten",
        "vragen bezichtiging",
        "checklist",
    ],
    "bezichtiging": ["bezichtiging", "bezichtigingsdatum", "viewing"],
    # Answers to checklist points from the documents of a viewing, and new points from them.
    "vooraf": ["vooraf_ingevuld", "vooraf ingevuld", "checklist_vooraf", "checklist vooraf"],
    "documenten": ["documenten", "stukken", "ontvangen documenten"],
}
NUMERIC = {
    "vraagprijs",
    "woonoppervlakte",
    "perceel",
    "inhoud",
    "kamers",
    "slaapkamers",
    "badkamers",
    "bouwjaar",
    "servicekosten",
    "score",
}
LISTS = {"pluspunten", "minpunten", "bezichtigingspunten"}

# Prefilled answers: canonical key -> the names an entry may use for it.
_ENTRY_KEYS = {
    "punt": ["punt", "vraag", "item", "tekst"],
    "groep": ["groep", "categorie", "onderdeel"],
    "oordeel": ["oordeel", "status", "beoordeling"],
    "antwoord": ["antwoord", "toelichting", "uitleg", "notitie"],
    "bron": ["bron", "document", "bronnen"],
}
_STATES = {
    "ok": "ok",
    "in orde": "ok",
    "goed": "ok",
    "akkoord": "ok",
    "voldoende": "ok",
    "twijfel": "twijfel",
    "onduidelijk": "twijfel",
    "navragen": "twijfel",
    "let op": "twijfel",
    "probleem": "probleem",
    "slecht": "probleem",
    "fout": "probleem",
    "risico": "probleem",
}

_LOOKUP = {alias: field for field, names in ALIASES.items() for alias in names}


def plain(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text.strip().lower().strip("*_:` "))


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", plain(text)).strip("-")
    return slug[:80] or "huis"


def parse_number(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return value
    text = str(value)
    # Score like "7,5/10" or "8 / 10": the first number.
    match = re.search(r"\d[\d.,]*", text)
    if not match:
        return None
    raw = match.group(0).rstrip(".,")
    # Dutch thousands: 450.000 or 1.250.000; decimals with a comma: 7,5.
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", raw):
        raw = raw.replace(".", "")
    elif re.fullmatch(r"\d{1,3}(,\d{3})+", raw):
        raw = raw.replace(",", "")
    else:
        raw = raw.replace(",", ".")
    try:
        number = float(raw)
    except ValueError:
        return None
    # "€ 450k" or "1,2 mln"
    rest = text[match.end() :].strip().lower()
    if number < 10_000 and re.match(r"(k|duizend)(?![.\w])", rest):
        number *= 1_000
    elif number < 10_000 and re.match(r"(mln|miljoen|m)(?![\w²³])", rest):
        number *= 1_000_000
    return int(number) if number.is_integer() else number


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [p.strip(" -•*") for p in re.split(r"[;\n]", str(value)) if p.strip(" -•*")]


def _text(value: Any) -> str:
    if isinstance(value, list):
        return "; ".join(str(v).strip() for v in value if str(v).strip())
    return str(value).strip() if value is not None else ""


def _prefilled(value: Any) -> list[dict[str, str]]:
    """Entries of `vooraf_ingevuld`: a checklist point with a verdict, answer and source."""
    entries = []
    for raw in value if isinstance(value, list) else [value]:
        if isinstance(raw, str):
            raw = {"punt": raw}
        if not isinstance(raw, dict):
            continue
        keys = {plain(str(k)): v for k, v in raw.items()}
        entry: dict[str, str] = {}
        for field, names in _ENTRY_KEYS.items():
            found = next((_text(keys[n]) for n in names if _text(keys.get(n))), "")
            if found:
                entry[field] = found
        if not entry.get("punt"):
            continue
        if "oordeel" in entry:
            state = _STATES.get(plain(entry["oordeel"]))
            if state:
                entry["oordeel"] = state
            else:
                # A verdict the app does not know stays readable in the answer.
                note = f"Oordeel: {entry.pop('oordeel')}"
                entry["antwoord"] = (
                    f"{note}. {entry['antwoord']}" if entry.get("antwoord") else note
                )
        entries.append(entry)
    return entries


def _documents(value: Any) -> list[dict[str, str]]:
    """Entries of `documenten`: a title, optionally the original file name, a date and a note."""
    docs = []
    for raw in value if isinstance(value, list) else _as_list(value):
        if isinstance(raw, dict):
            keys = {plain(str(k)): v for k, v in raw.items()}

            def pick(*names: str, keys: dict[str, Any] = keys) -> str:
                return next((_text(keys[n]) for n in names if _text(keys.get(n))), "")

            doc = {
                "naam": pick("titel", "naam", "title", "name", "document"),
                "bestand": pick("bestand", "bestandsnaam", "file", "origineel", "filename"),
                "datum": pick("datum", "date"),
                "omschrijving": pick("omschrijving", "toelichting", "beschrijving", "description"),
            }
            doc = {k: v for k, v in doc.items() if v}
            if doc.get("bestand") and not doc.get("naam"):
                doc["naam"] = Path(doc["bestand"]).stem
            if doc.get("naam"):
                docs.append(doc)
        elif _text(raw):
            docs.append({"naam": _text(raw)})
    return docs


DOCUMENTS_DIR = "documenten"


def documents_folder(reports_dir: Path, house_id: str) -> Path:
    """Where a house's documents sit in the reports repository: documenten/<id>/."""
    return reports_dir / DOCUMENTS_DIR / house_id


def find_documents(folder: Path) -> list[Path]:
    """The files in a house's documents folder and its subfolders, without hidden ones."""
    if not folder.is_dir():
        return []
    return [
        path
        for path in sorted(folder.rglob("*"))
        if path.is_file() and not any(p.startswith(".") for p in path.relative_to(folder).parts)
    ]


def normalise(raw: dict[str, Any]) -> dict[str, Any]:
    """Map a report's own field names onto the app's. Unknown fields go to `extra`."""
    fields: dict[str, Any] = {}
    extra: dict[str, Any] = {}
    for key, value in raw.items():
        if value is None or value == "":
            continue
        field = _LOOKUP.get(plain(str(key)))
        if not field:
            # The id names the house; it is not something to show.
            if plain(str(key)) not in {"id", "titel", "title"}:
                extra[str(key)] = value
            continue
        if field in fields:
            continue
        if field == "erfpacht" and isinstance(value, bool):
            fields[field] = "Erfpacht" if value else "Eigen grond"
            continue
        if field in NUMERIC:
            number = parse_number(value)
            if number is None:
                extra[str(key)] = value
                continue
            fields[field] = number
        elif field == "vooraf":
            fields[field] = _prefilled(value)
        elif field == "documenten":
            fields[field] = _documents(value)
        elif field in LISTS:
            fields[field] = _as_list(value)
        elif field == "energielabel":
            label = re.search(r"(?<![A-Z])(A\+{1,5}|[A-G])(?![A-Z])", str(value).upper())
            fields[field] = label.group(0) if label else str(value)
        else:
            fields[field] = value if isinstance(value, list | dict) else str(value).strip()
    if extra:
        fields["extra"] = extra
    return fields


_FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
_KV_LINE = re.compile(r"^\s*(?:[-*•]\s*)?\**([^:*|\n]{2,40}?)\**\s*:\s*\**\s*(.+?)\s*$")
_TABLE_ROW = re.compile(r"^\s*\|\s*\**([^|*]{2,40}?)\**\s*\|\s*(.+?)\s*\|\s*$")
_HEADING = re.compile(r"^#\s+(.+?)\s*#*\s*$", re.M)
_SECTION = re.compile(r"^#{2,3}\s+(.+?)\s*$")


def _sections(body: str) -> dict[str, list[str]]:
    """Bullet points under headings such as ## Pluspunten."""
    found: dict[str, list[str]] = {}
    current: str | None = None
    for line in body.splitlines():
        heading = _SECTION.match(line)
        if heading:
            current = _LOOKUP.get(plain(heading.group(1)))
            current = current if current in LISTS else None
            continue
        if current and re.match(r"^\s*[-*•]\s+", line):
            found.setdefault(current, []).append(re.sub(r"^\s*[-*•]\s+", "", line).strip())
    return found


def parse_markdown(text: str) -> tuple[dict[str, Any], str]:
    meta: dict[str, Any] = {}
    body = text
    match = _FRONT_MATTER.match(text)
    if match:
        loaded = yaml.safe_load(match.group(1))
        if isinstance(loaded, dict):
            meta = loaded
        body = text[match.end() :]

    # Key-value lines and table rows the front matter did not already give.
    found: dict[str, Any] = {}
    for line in body.splitlines():
        kv = _KV_LINE.match(line) or _TABLE_ROW.match(line)
        if not kv:
            continue
        key, value = kv.group(1).strip(), kv.group(2).strip().strip("*").strip()
        if _LOOKUP.get(plain(key)) and value and not set(value) <= set("-: "):
            found.setdefault(key, value)

    fields = normalise(found)
    fields.pop("extra", None)
    fields.update(normalise(meta))
    for name, items in _sections(body).items():
        fields.setdefault(name, items)
    if "titel" not in fields:
        heading = _HEADING.search(body)
        if heading:
            fields["titel"] = heading.group(1).strip()
    if isinstance(meta.get("titel") or meta.get("title"), str):
        fields["titel"] = meta.get("titel") or meta.get("title")
    if "adres" not in fields and fields.get("titel"):
        fields["adres"] = fields["titel"]
    return fields, body.strip()


def parse_report(name: str, content: bytes) -> tuple[str, dict[str, Any], str]:
    """Returns (house id, fields, Markdown body)."""
    text = content.decode("utf-8-sig", errors="replace")
    if name.lower().endswith(".json"):
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("Een JSON-rapport moet één object zijn.")
        body = str(data.pop("rapport", data.pop("report", data.pop("body", ""))))
        fields = normalise(data)
        explicit_id = data.get("id")
    else:
        fields, body = parse_markdown(text)
        explicit_id = None
        match = _FRONT_MATTER.match(text)
        if match:
            meta = yaml.safe_load(match.group(1))
            if isinstance(meta, dict):
                explicit_id = meta.get("id")
    stem = Path(name).stem
    if stem.lower() in {"readme", "rapport", "report", "index"} and Path(name).parent.name:
        stem = Path(name).parent.name
    house_id = slugify(str(explicit_id)) if explicit_id else slugify(stem)
    return house_id, fields, body


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def find_reports(folder: Path) -> list[Path]:
    """Report files in a folder and its subfolders, skipping hidden ones and READMEs at the top."""
    found = []
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(folder)
        if any(part.startswith((".", "_")) for part in rel.parts):
            continue
        # The documents of a house are no reports, even a Markdown file among them.
        if len(rel.parts) > 1 and rel.parts[0] == DOCUMENTS_DIR:
            continue
        if not path.is_file() or path.suffix.lower() not in REPORT_SUFFIXES:
            continue
        if len(rel.parts) == 1 and path.stem.lower() in {"readme", "template", "sjabloon"}:
            continue
        found.append(path)
    return found
