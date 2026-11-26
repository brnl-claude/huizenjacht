"""The listing behind a house's link (usually Funda): its photos and a copy of the page.

The app fetches the page itself, keeps a cleaned copy (no scripts) to show in the app, and
downloads the photos into its data folder, so cards and the gallery never depend on the site
being reachable later. Funda answers some addresses (such as cloud data centres) with a
captcha page instead; that is recorded as "blocked" and tried again later.
"""

import json
import logging
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx2
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.6",
}
MAX_PHOTOS = 100
# Funda's photo server scales a photo when asked; the bare address is the full original
# (often 2 MB+). 1440 pixels wide is sharp on any phone and keeps a house with 40 photos small.
PHOTO_WIDTH = 1440
REMOTE_PHOTOS = "remote-photos.json"
MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_DOWNLOADS = 6
# Always a block page, whatever its size.
BLOCK_TEXT = "Je bent bijna op de pagina die je zoekt"
# Also found on real pages (in scripts), so only a block page when the page is small.
BLOCK_MARKERS = ("captcha-container", "/captcha")

log = logging.getLogger("huizenjacht.listings")

_PHOTO = re.compile(
    r"https://cloud\.funda\.nl/valentina_media/[0-9/]+?(?:_(\d+)x?(\d*))?\.(?:jpe?g|webp|png)",
    re.I,
)
_SIZE_SUFFIX = re.compile(r"_\d+x?\d*(?=\.\w+$)")


class Blocked(Exception):
    """The site answered with a captcha or refused us."""


class NotAListing(Exception):
    """The site answered, but not with a listing (no photos, no title)."""


def _unescape(html: str) -> str:
    # Pages built with Nuxt or Next keep addresses in JSON as https:\/\/ or https:\u002F\u002F.
    return html.replace("\\u002F", "/").replace("\\u002f", "/").replace("\\/", "/")


def photo_urls(html: str, page_url: str, photos_html: str | None = None) -> list[str]:
    """Photo addresses in the order they appear, one per photo, the largest size seen.

    `photos_html` is the listing's photo page (/media/fotos/), which has every photo in
    Funda's order; the listing itself only shows the first few. Its photos come first."""
    best: dict[str, tuple[int, str]] = {}
    order: list[str] = []
    candidates = [m.group(0) for m in _PHOTO.finditer(_unescape(photos_html or ""))]
    soup = BeautifulSoup(html, "html.parser")
    og = soup.find("meta", attrs={"property": "og:image"})
    candidates += [og["content"]] if og and og.get("content") else []
    candidates += [m.group(0) for m in _PHOTO.finditer(_unescape(html))]
    for url in candidates:
        url = urljoin(page_url, url)
        key = _SIZE_SUFFIX.sub("", url.split("?")[0])
        size = _PHOTO.match(url)
        width = int(size.group(1)) if size and size.group(1) else 0
        if key not in best:
            order.append(key)
            best[key] = (width, url)
        elif width > best[key][0]:
            best[key] = (width, url)
    return [best[k][1] for k in order][:MAX_PHOTOS]


def listing_page(url: str) -> str:
    """The listing itself for an address on one of its media pages, such as
    /detail/koop/velp-ge/huis-x/44544340/media/fotos/ (the bookmarklet works on both)."""
    return re.sub(r"(/\d{6,10})/media(?:/[^?#]*)?(?=$|[?#])", r"\1/", url, count=1)


def clean_page(html: str, page_url: str) -> str:
    """The page without scripts, frames or event handlers, with lazy images made visible and
    links opening in a new tab. It is shown in a sandboxed frame, scripts off."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "iframe", "object", "embed", "form", "dialog"]):
        tag.decompose()
    for tag in soup("noscript"):
        tag.unwrap()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.lower().startswith("on"):
                del tag.attrs[attr]
        for lazy, real in (("data-src", "src"), ("data-srcset", "srcset"), ("data-lazy", "src")):
            if tag.get(lazy) and not tag.get(real):
                tag[real] = tag[lazy]
        if tag.name == "img":
            tag["loading"] = "lazy"
            tag["referrerpolicy"] = "no-referrer"
        if tag.name == "a" and tag.get("href", "").lower().startswith("javascript:"):
            del tag["href"]
    head = soup.head or soup.new_tag("head")
    if not soup.head and soup.html:
        soup.html.insert(0, head)
    origin = f"{urlparse(page_url).scheme}://{urlparse(page_url).netloc}/"
    for old in head.find_all("base"):
        old.decompose()
    head.insert(0, soup.new_tag("base", href=origin, target="_blank"))
    return str(soup)


def page_summary(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")

    def meta(prop: str) -> str | None:
        tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        return tag.get("content") if tag else None

    return {
        "title": meta("og:title") or (soup.title.string if soup.title else None),
        "description": meta("og:description"),
    }


def _page_title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    return " ".join(soup.title.get_text().split())[:80] if soup.title else "zonder titel"


def fetch_listing(url: str, folder: Path, client: httpx2.Client) -> dict[str, Any]:
    """Fetch the page and its photos into `folder`.

    Raises Blocked, NotAListing or httpx2.HTTPError. What the site sent is kept as raw.html,
    so a failure can be looked into later."""
    response = client.get(url, headers=HEADERS, follow_redirects=True, timeout=30)
    html = response.text
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "raw.html").write_text(html, encoding="utf-8")
    size = f"{len(response.content) // 1024} kB"
    log.info("GET %s -> HTTP %s, %s, %r", url, response.status_code, size, _page_title(html))
    if response.status_code in (401, 403, 429):
        raise Blocked(f"De site weigerde de pagina (HTTP {response.status_code}).")
    if response.status_code >= 400:
        raise NotAListing(f"De site gaf een fout terug (HTTP {response.status_code}).")
    return save_page(html, str(response.url), folder, client, label=f"HTTP {response.status_code}")


def check_page(html: str, label: str) -> None:
    """Raise Blocked or NotAListing when `html` is not a listing."""
    if BLOCK_TEXT in html or (
        any(marker in html for marker in BLOCK_MARKERS) and len(html) < 60_000
    ):
        raise Blocked("Funda vroeg om een captcha in plaats van de pagina te tonen.")
    has_og_title = 'property="og:title"' in html or "property='og:title'" in html
    if not photo_urls(html, "https://www.funda.nl/") and not has_og_title:
        raise NotAListing(
            f"De pagina bevat geen advertentie ({label}, {len(html) // 1024} kB, "
            f"titel: {_page_title(html)})."
        )


def download_address(url: str) -> str:
    """The address to download a photo from: a bare Funda photo at PHOTO_WIDTH."""
    if "?" in url or _SIZE_SUFFIX.search(url) or not _PHOTO.fullmatch(url):
        return url
    return f"{url}?options=width={PHOTO_WIDTH}"


def save_page(
    html: str,
    page_url: str,
    folder: Path,
    client: httpx2.Client,
    label: str = "browser",
    photos_html: str | None = None,
) -> dict[str, Any]:
    """Keep a listing page that is known to be good, and download its photos, also those on
    the listing's photo page when the bookmarklet sent it along (`photos_html`).

    Photos the app cannot download (the photo server may refuse it as well) are kept as
    addresses, so the browser can still show them."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "raw.html").write_text(html, encoding="utf-8")
    check_page(html, label)
    if photos_html:
        (folder / "raw-photos.html").write_text(photos_html, encoding="utf-8")
    urls = photo_urls(html, page_url, photos_html)
    summary = page_summary(html)

    saved = 0
    failures: Counter[str] = Counter()
    for old in [*folder.glob("photo-*"), folder / REMOTE_PHOTOS]:
        old.unlink(missing_ok=True)

    def get(photo_url: str) -> httpx2.Response | Exception | None:
        try:
            return _get_photo(client, download_address(photo_url), page_url)
        except httpx2.HTTPError as exc:
            return exc

    # A few at a time: forty photos one by one keep the bookmarklet waiting too long.
    with ThreadPoolExecutor(max_workers=PHOTO_DOWNLOADS) as pool:
        downloads = list(pool.map(get, urls))
    for photo in downloads:
        if isinstance(photo, Exception):
            failures[type(photo).__name__] += 1
            continue
        if photo is None:
            failures["niet van funda.nl"] += 1
            continue
        kind = photo.headers.get("content-type", "")
        if photo.status_code != 200:
            failures[f"HTTP {photo.status_code}"] += 1
            continue
        if not kind.startswith("image/"):
            failures[f"geen afbeelding ({kind or 'onbekend type'})"] += 1
            continue
        if len(photo.content) > MAX_PHOTO_BYTES:
            failures["te groot"] += 1
            continue
        suffix = {"image/webp": ".webp", "image/png": ".png"}.get(kind.split(";")[0], ".jpg")
        (folder / f"photo-{saved:02d}{suffix}").write_bytes(photo.content)
        saved += 1
    (folder / "page.html").write_text(clean_page(html, page_url), encoding="utf-8")

    photos = saved
    if not urls:
        message = "Geen foto's gevonden op de pagina."
    elif saved == 0:
        # Shown straight from the photo server by the browser instead.
        (folder / REMOTE_PHOTOS).write_text(json.dumps(urls), encoding="utf-8")
        photos = len(urls)
        message = None
    elif failures:
        reasons = ", ".join(f"{n}× {why}" for why, n in failures.most_common())
        message = f"{saved} van {len(urls)} foto's opgehaald; mislukt: {reasons}."
    else:
        message = None
    log.info("%s: %s of %s photos saved %s", page_url, saved, len(urls), dict(failures) or "")
    return {"photos": photos, "found": len(urls), "message": message, **summary}


def is_photo_host(url: str) -> bool:
    """Photos only come from Funda over https. The page's HTML comes from a browser, so the
    server must never fetch any address it names (such as one inside the cluster)."""
    parts = urlparse(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "funda.nl" or host.endswith(".funda.nl"))


def _get_photo(client: httpx2.Client, url: str, referer: str) -> httpx2.Response | None:
    """GET a photo, following at most a few redirects, each to a Funda host too."""
    for _ in range(4):
        if not is_photo_host(url):
            return None
        response = client.get(
            url,
            headers={**HEADERS, "Accept": "image/*", "Referer": referer},
            timeout=30,
            follow_redirects=False,
        )
        if response.status_code not in (301, 302, 303, 307, 308):
            return response
        url = urljoin(url, response.headers.get("location", ""))
    return None


def remote_photos(folder: Path) -> list[str]:
    path = folder / REMOTE_PHOTOS
    if not path.is_file():
        return []
    urls = json.loads(path.read_text(encoding="utf-8"))
    return [u for u in urls if isinstance(u, str) and _PHOTO.match(u)]


def photo_files(folder: Path) -> list[Path]:
    return sorted(folder.glob("photo-*")) if folder.is_dir() else []
