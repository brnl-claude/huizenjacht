"""Public links: a read-only page of one house for someone without an account.

Each house has at most one link, /gedeeld/<token>, with a long random token. The page is
rendered here on the server (not by the app), so it never loads the app, its data or its
login. It shows what the tabs Overzicht and Rapport of the app show, read-only, with the
photos of the listing. Never shown: the tabs Checklist and Mijn beoordeling (notes, grades,
the bid, the viewing), own photos, videos and memos, documents, and who the owners are.
"""

import html
import json
import secrets
from typing import Any
from urllib.parse import quote

from markdown_it import MarkdownIt

# The setting that holds the links: {token: {"house": id, "created": iso}}. Not writable
# through /api/settings.
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
    ("servicekosten", "Servicekosten p/m", "€"),
    ("erfpacht", "Eigendom", ""),
    ("makelaar", "Makelaar", ""),
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


def _markdown(text: str) -> str:
    """The report as HTML. Raw HTML in it stays text; links like javascript: are refused."""
    md = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])
    return md.render(text)


def page(house: dict[str, Any], token: str, photos: int, base: str = "") -> str:
    """The tabs Overzicht and Rapport of the app, read-only. Switching tabs works without
    scripts (radio buttons), since the page allows none. `base` (https://host) makes the
    link preview in WhatsApp and the like absolute."""
    f = fields(house)
    e = html.escape
    address = str(f.get("adres") or f.get("titel") or "Een huis")
    place = " ".join(str(f[k]) for k in ("postcode", "plaats") if f.get(k))
    image = f"{base}/gedeeld/{token}/foto/0" if photos else ""
    if not image and str(f.get("foto") or "").startswith("https://"):
        image = str(f["foto"])
    preview = _preview(
        address, _summary(f, place), image, f"{base}/gedeeld/{token}" if base else ""
    )
    parts = [f"<header><div class='title'><h1>{e(address)}</h1>"]
    where = ", ".join(x for x in (place, str(f.get("wijk") or "")) if x)
    if where:
        parts.append(f"<p class='muted'>{e(where)}</p>")
    parts.append("</div>")
    links = []
    url = str(f.get("url") or "")
    if url.startswith("https://"):
        links.append((url, ICON_LINK, "Advertentie"))
    if f.get("adres"):
        # Like mapsUrl() in frontend/src/house.ts.
        where = ", ".join(x for x in (str(f["adres"]), place) if x)
        maps = f"https://www.google.com/maps/search/?api=1&query={quote(where, safe='')}"
        links.append((maps, ICON_PIN, "Kaart"))
    if links:
        # The same buttons as at the top of a house in the app (.hero-actions).
        parts.append(
            "<div class='actions'>"
            + "".join(
                f"<a href='{e(u, quote=True)}' rel='noreferrer noopener' target='_blank'>"
                f"{_icon(i)}<span>{t}</span></a>"
                for u, i, t in links
            )
            + "</div>"
        )
    parts.append("</header>")
    if photos:
        imgs = "".join(
            f"<img src='/gedeeld/{e(token)}/foto/{n}' alt='Foto {n + 1}' loading='lazy'>"
            for n in range(min(photos, MAX_PHOTOS))
        )
        parts.append(f"<div class='photos'>{imgs}</div>")
    body = str(house.get("reportBody") or "").strip()
    parts.append(
        "<input type='radio' name='tab' id='t1' checked><input type='radio' name='tab' id='t2'>"
        "<nav><label for='t1'>Overzicht</label><label for='t2'>Rapport</label></nav>"
        f"<div class='pane p1'>{_overview(f)}</div>"
        "<div class='pane p2'>"
        + (
            f"<article class='report'>{_markdown(body)}</article>"
            if body
            else "<section><p class='muted'>Bij dit huis hoort geen rapport.</p></section>"
        )
        + "</div>"
    )
    parts.append("<footer class='muted'>Gedeeld via Huizenjacht · alleen lezen</footer>")
    return _document(address, "".join(parts), preview)


# Lucide icons, as in the app: external-link and map-pin.
ICON_LINK = (
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/>'
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
)
ICON_PIN = (
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993'
    ' 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
)


def _icon(paths: str) -> str:
    return (
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        f"{paths}</svg>"
    )


def _summary(f: dict[str, Any], place: str) -> str:
    """One line for the link preview: price, size, rooms and place."""
    bits = []
    if f.get("vraagprijs") not in (None, ""):
        bits.append(_fact(f["vraagprijs"], "€"))
    if f.get("woonoppervlakte") not in (None, ""):
        bits.append(_fact(f["woonoppervlakte"], "m²"))
    if f.get("kamers") not in (None, ""):
        bits.append(f"{f['kamers']} kamers")
    if place:
        bits.append(place)
    return " · ".join(bits)


def _preview(title: str, description: str, image: str, url: str) -> str:
    """Open Graph tags: the title, a line and the photo that chat apps show with the link."""
    e = html.escape
    tags = [("og:type", "website"), ("og:title", title), ("og:site_name", "Huizenjacht")]
    if description:
        tags.append(("og:description", description))
    if url:
        tags.append(("og:url", url))
    if image:
        tags.append(("og:image", image))
    out = "".join(f'<meta property="{k}" content="{e(v, quote=True)}">' for k, v in tags)
    if description:
        out += f'<meta name="description" content="{e(description, quote=True)}">'
    if image:
        out += '<meta name="twitter:card" content="summary_large_image">'
    return out


def _overview(f: dict[str, Any]) -> str:
    e = html.escape
    parts = []
    score, advice = f.get("score"), str(f.get("advies") or "")
    summary = str(f.get("samenvatting") or "").strip()
    if summary or advice or isinstance(score, (int, float)):
        parts.append("<section><div class='verdict-head'><h2>Uit het rapport</h2>")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            parts.append(f"<span class='score'>Score {e(str(score))}</span>")
        parts.append("</div>")
        if advice:
            parts.append(f"<p>Advies: <b>{e(advice)}</b></p>")
        parts.append("".join(f"<p>{e(p)}</p>" for p in summary.split("\n\n") if p.strip()))
        parts.append("</section>")
    plus, minus = _strings(f.get("pluspunten")), _strings(f.get("minpunten"))
    if plus or minus:
        parts.append("<div class='proscons'>")
        for title, items, cls in (("Pluspunten", plus, "plus"), ("Minpunten", minus, "min")):
            if items:
                lis = "".join(f"<li>{e(i)}</li>" for i in items)
                parts.append(f"<section><h2>{title}</h2><ul class='{cls}'>{lis}</ul></section>")
        parts.append("</div>")
    facts = [
        (label, _fact(f[key], unit))
        for key, label, unit in FACTS
        if f.get(key) not in (None, "", [])
    ]
    price, area = f.get("vraagprijs"), f.get("woonoppervlakte")
    if isinstance(price, (int, float)) and isinstance(area, (int, float)) and area:
        facts.insert(1, ("Prijs per m²", _fact(price / area, "€")))
    if facts:
        items = "".join(f"<div><dt>{k}</dt><dd>{e(v)}</dd></div>" for k, v in facts)
        parts.append(f"<section><h2>Kenmerken</h2><dl>{items}</dl></section>")
    extra = f.get("extra")
    if isinstance(extra, dict) and extra:
        items = "".join(
            f"<div><dt>{e(str(k))}</dt><dd>"
            f"{e(json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v))}"
            "</dd></div>"
            for k, v in extra.items()
        )
        parts.append(f"<section><h2>Overige gegevens</h2><dl>{items}</dl></section>")
    return "".join(parts)


def gone() -> str:
    return _document(
        "Link werkt niet",
        "<header><h1>Deze link werkt niet (meer)</h1></header>"
        "<p class='muted'>Vraag degene die hem stuurde om een nieuwe link.</p>",
    )


def _document(title: str, body: str, head: str = "") -> str:
    return f"""<!doctype html><html lang="nl"><head><meta charset="utf-8">{head}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark"><title>{html.escape(title)}</title>
<style>{STYLE}</style></head><body><main>{body}</main></body></html>"""


STYLE = """
:root{--bg:#f4f4f4;--card:#fff;--text:#2b2b2b;--muted:#666;--line:#e3e3e3;--accent:#f7a100;
--link:#0071b3;--link-soft:#e6f1f8;--plus:#2e8540;--min:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#16181b;--card:#202327;--text:#e8e8e8;
--muted:#a0a4a8;--line:#34383d;--link:#5fb4ea;--link-soft:#13283a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}
main{max-width:860px;margin:0 auto;padding:16px}
header,section{background:var(--card);border-radius:12px;padding:16px 20px;margin-bottom:16px;
box-shadow:0 2px 8px rgb(0 0 0/6%)}h1{margin:0;font-size:1.6rem}h2{margin:0 0 8px;font-size:1.15rem}
h3{font-size:1rem;margin:14px 0 4px}.muted{color:var(--muted);margin:4px 0 0}
.photos{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin-bottom:16px;
border-radius:12px}.photos img{flex:0 0 100%;width:100%;aspect-ratio:3/2;object-fit:cover;
scroll-snap-align:start;border-radius:12px;background:var(--line)}
@media (min-width:700px){.photos img{flex-basis:70%;max-height:60vh}}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px 20px;margin:0}
dt{color:var(--muted);font-size:.85rem}dd{margin:0;font-weight:600}
ul{margin:0;padding-left:1.2rem}ul.plus li::marker{content:"+  ";color:var(--plus)}
ul.min li::marker{content:"−  ";color:var(--min)}
input[name=tab]{position:absolute;opacity:0;pointer-events:none}
nav{display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid var(--line)}
nav label{padding:10px 16px;cursor:pointer;font-weight:600;color:var(--muted);
border-bottom:3px solid transparent;margin-bottom:-2px}
#t1:checked~nav label[for=t1],#t2:checked~nav label[for=t2]{color:var(--text);
border-bottom-color:var(--accent)}#t1:focus-visible~nav label[for=t1],
#t2:focus-visible~nav label[for=t2]{outline:2px solid var(--link)}
.pane{display:none}#t1:checked~.p1,#t2:checked~.p2{display:block}
.verdict-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.score{background:var(--accent);color:#fff;border-radius:999px;padding:2px 12px;font-weight:700}
.proscons{display:grid;gap:0 16px}@media (min-width:700px){.proscons{grid-template-columns:1fr 1fr}}
.report{background:var(--card);border-radius:12px;padding:8px 20px;margin-bottom:16px;
box-shadow:0 2px 8px rgb(0 0 0/6%);overflow-wrap:anywhere}.report img{max-width:100%}
.report table{border-collapse:collapse;display:block;overflow-x:auto}
.report th,.report td{border:1px solid var(--line);padding:4px 8px;text-align:left}
a{color:var(--link)}
.actions{display:flex;margin:12px -8px 0;padding-top:8px;border-top:1px solid var(--line)}
.actions a{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;
padding:8px 2px;border-radius:8px;color:var(--link);font-size:.75rem;font-weight:600;
text-decoration:none}.actions a:hover{background:var(--link-soft)}
@media (min-width:700px){header{display:flex;align-items:center;justify-content:space-between;
gap:16px}.actions{margin:0;padding:0;border:0;gap:4px}.actions a{flex:0 0 auto;padding:8px 14px}}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:10px 18px;border-radius:8px;
text-decoration:none;font-weight:650}footer{text-align:center;font-size:.85rem;margin:24px 0}
"""
