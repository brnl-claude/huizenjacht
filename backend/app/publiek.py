"""Public links: a read-only page of one house for someone without an account.

Each house has at most one link, /gedeeld/<token>, with a long random token. The page is
rendered here on the server (not by the app), so it never loads the app, its data or its
login. It shows the basic facts and, when the owner allows it, the photos of the listing and
the summary of the report. Never shown: notes, checklist, grades, the bid, the viewing,
own photos, videos and memos, documents, and who the owners are.
"""

import html
import secrets
from typing import Any

# The setting that holds the links: {token: {"house": id, "fotos": bool, "rapport": bool,
# "created": iso}}. Not writable through /api/settings.
SETTING = "publiekeLinks"

# Fields of a house that a public page may show, with their label and unit.
FACTS: tuple[tuple[str, str, str], ...] = (
    ("vraagprijs", "Vraagprijs", "€"),
    ("woonoppervlakte", "Woonoppervlakte", "m²"),
    ("perceel", "Perceel", "m²"),
    ("inhoud", "Inhoud", "m³"),
    ("kamers", "Kamers", ""),
    ("slaapkamers", "Slaapkamers", ""),
    ("badkamers", "Badkamers", ""),
    ("bouwjaar", "Bouwjaar", ""),
    ("energielabel", "Energielabel", ""),
    ("woningtype", "Soort woning", ""),
    ("tuin", "Tuin", ""),
    ("parkeren", "Parkeren", ""),
    ("servicekosten", "Servicekosten", "€"),
    ("erfpacht", "Erfpacht", ""),
)
# What the owner may correct in the app (frontend/src/house.ts EDITABLE).
EDITABLE = (
    "adres",
    "postcode",
    "plaats",
    "wijk",
    "vraagprijs",
    "woonoppervlakte",
    "perceel",
    "kamers",
    "slaapkamers",
    "badkamers",
    "bouwjaar",
    "energielabel",
    "woningtype",
    "url",
)
MAX_PHOTOS = 40

HEADERS = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
}
PAGE_HEADERS = {
    **HEADERS,
    # Photos may come from the listing site when it refused the server (a redirect).
    "Content-Security-Policy": (
        "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline';"
        " frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    ),
}


def new_token() -> str:
    return secrets.token_urlsafe(24)


def options(link: dict[str, Any]) -> dict[str, Any]:
    return {"fotos": bool(link.get("fotos", True)), "rapport": bool(link.get("rapport"))}


def fields(house: dict[str, Any]) -> dict[str, Any]:
    """The report's values with the owner's corrections, as the app shows them."""
    merged = dict(house.get("report") or {})
    mine = house.get("mine") or {}
    for key in EDITABLE:
        if mine.get(key) not in (None, ""):
            merged[key] = mine[key]
    return merged


def _number(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return str(value)
    return f"{round(value):,}".replace(",", ".")


def _fact(value: Any, unit: str) -> str:
    # A year or a count without a thousands dot: 1932, not 1.932.
    text = _number(value) if unit else str(value)
    if unit == "€":
        return f"€ {text}"
    return f"{text} {unit}".strip()


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v) for v in value if isinstance(v, (str, int, float)) and str(v).strip()]


def page(house: dict[str, Any], link: dict[str, Any], token: str, photos: int) -> str:
    f = fields(house)
    e = html.escape
    address = str(f.get("adres") or f.get("titel") or "Een huis")
    place = " ".join(str(f[k]) for k in ("postcode", "plaats") if f.get(k))
    facts = "".join(
        f"<div><dt>{label}</dt><dd>{e(_fact(f[key], unit))}</dd></div>"
        for key, label, unit in FACTS
        if f.get(key) not in (None, "", [])
    )
    opts = options(link)
    parts = [f"<header><h1>{e(address)}</h1>"]
    where = ", ".join(x for x in (place, str(f.get("wijk") or "")) if x)
    if where:
        parts.append(f"<p class='muted'>{e(where)}</p>")
    parts.append("</header>")
    if opts["fotos"] and photos:
        imgs = "".join(
            f"<img src='/gedeeld/{e(token)}/foto/{n}' alt='Foto {n + 1}' loading='lazy'>"
            for n in range(min(photos, MAX_PHOTOS))
        )
        parts.append(f"<div class='photos'>{imgs}</div>")
    if facts:
        parts.append(f"<section><h2>Kenmerken</h2><dl>{facts}</dl></section>")
    if opts["rapport"]:
        summary = str(f.get("samenvatting") or "").strip()
        plus, minus = _strings(f.get("pluspunten")), _strings(f.get("minpunten"))
        if summary or plus or minus:
            parts.append("<section><h2>Samenvatting</h2>")
            if summary:
                parts.append("".join(f"<p>{e(p)}</p>" for p in summary.split("\n\n") if p.strip()))
            for title, items, cls in (("Pluspunten", plus, "plus"), ("Minpunten", minus, "min")):
                if items:
                    lis = "".join(f"<li>{e(i)}</li>" for i in items)
                    parts.append(f"<h3>{title}</h3><ul class='{cls}'>{lis}</ul>")
            parts.append("</section>")
    url = str(f.get("url") or "")
    if url.startswith("https://"):
        parts.append(
            f"<p><a class='btn' href='{e(url, quote=True)}' rel='noreferrer noopener'"
            " target='_blank'>Bekijk de advertentie</a></p>"
        )
    parts.append("<footer class='muted'>Gedeeld via Huizenjacht · alleen lezen</footer>")
    return _document(address, "".join(parts))


def gone() -> str:
    return _document(
        "Link werkt niet",
        "<header><h1>Deze link werkt niet (meer)</h1></header>"
        "<p class='muted'>Vraag degene die hem stuurde om een nieuwe link.</p>",
    )


def _document(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark"><title>{html.escape(title)}</title>
<style>{STYLE}</style></head><body><main>{body}</main></body></html>"""


STYLE = """
:root{--bg:#f4f4f4;--card:#fff;--text:#2b2b2b;--muted:#666;--line:#e3e3e3;--accent:#f7a100;
--link:#0071b3;--plus:#2e8540;--min:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#16181b;--card:#202327;--text:#e8e8e8;
--muted:#a0a4a8;--line:#34383d;--link:#5fb4ea}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}
main{max-width:860px;margin:0 auto;padding:16px}
header,section{background:var(--card);border-radius:12px;padding:16px 20px;margin-bottom:16px;
box-shadow:0 2px 8px rgb(0 0 0/6%)}h1{margin:0;font-size:1.6rem}h2{margin:0 0 8px;font-size:1.15rem}
h3{font-size:1rem;margin:14px 0 4px}.muted{color:var(--muted);margin:4px 0 0}
.photos{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin-bottom:16px;
border-radius:12px}.photos img{flex:0 0 100%;width:100%;aspect-ratio:3/2;object-fit:cover;
scroll-snap-align:start;border-radius:12px;background:var(--line)}
@media (min-width:700px){.photos img{flex-basis:70%}}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px 20px;margin:0}
dt{color:var(--muted);font-size:.85rem}dd{margin:0;font-weight:600}
ul{margin:0;padding-left:1.2rem}ul.plus li::marker{content:"+  ";color:var(--plus)}
ul.min li::marker{content:"−  ";color:var(--min)}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:10px 18px;border-radius:8px;
text-decoration:none;font-weight:650}footer{text-align:center;font-size:.85rem;margin:24px 0}
"""
