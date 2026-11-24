"""The listing behind a house's link (usually Funda): its photos and a copy of the page.

The app fetches the page itself, keeps a cleaned copy (no scripts) to show in the app, and
downloads the photos into its data folder, so cards and the gallery never depend on the site
being reachable later. Funda answers some addresses (such as cloud data centres) with a
captcha page instead; that is recorded as "blocked" and tried again later.
"""

import re
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
MAX_PHOTOS = 40
MAX_PHOTO_BYTES = 8 * 1024 * 1024
BLOCK_MARKERS = ("Je bent bijna op de pagina die je zoekt", "captcha-container", "/captcha")

_PHOTO = re.compile(
    r"https://cloud\.funda\.nl/valentina_media/[0-9/]+?(?:_(\d+)x?(\d*))?\.(?:jpe?g|webp|png)",
    re.I,
)
_SIZE_SUFFIX = re.compile(r"_\d+x?\d*(?=\.\w+$)")


class Blocked(Exception):
    """The site answered with a captcha or refused us."""


def photo_urls(html: str, page_url: str) -> list[str]:
    """Photo addresses in the order they appear, one per photo, the largest size seen."""
    best: dict[str, tuple[int, str]] = {}
    order: list[str] = []
    soup = BeautifulSoup(html, "html.parser")
    og = soup.find("meta", attrs={"property": "og:image"})
    candidates = [og["content"]] if og and og.get("content") else []
    candidates += [m.group(0) for m in _PHOTO.finditer(html)]
    for url in candidates:
        url = urljoin(page_url, url.replace("\\/", "/"))
        key = _SIZE_SUFFIX.sub("", url.split("?")[0])
        size = _PHOTO.match(url)
        width = int(size.group(1)) if size and size.group(1) else 0
        if key not in best:
            order.append(key)
            best[key] = (width, url)
        elif width > best[key][0]:
            best[key] = (width, url)
    return [best[k][1] for k in order][:MAX_PHOTOS]


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


def fetch_listing(url: str, folder: Path, client: httpx2.Client) -> dict[str, Any]:
    """Fetch the page and its photos into `folder`. Raises Blocked or httpx2.HTTPError."""
    response = client.get(url, headers=HEADERS, follow_redirects=True, timeout=30)
    if response.status_code in (401, 403, 429):
        raise Blocked(f"De site weigerde de pagina (HTTP {response.status_code}).")
    response.raise_for_status()
    html = response.text
    if any(marker in html for marker in BLOCK_MARKERS) and len(html) < 60_000:
        raise Blocked("Funda vroeg om een captcha in plaats van de pagina te tonen.")

    folder.mkdir(parents=True, exist_ok=True)
    urls = photo_urls(html, str(response.url))
    saved = 0
    for old in folder.glob("photo-*"):
        old.unlink()
    for url in urls:
        try:
            photo = client.get(
                url,
                headers={**HEADERS, "Accept": "image/*", "Referer": str(response.url)},
                timeout=30,
                follow_redirects=True,
            )
        except httpx2.HTTPError:
            continue
        kind = photo.headers.get("content-type", "")
        if photo.status_code != 200 or not kind.startswith("image/"):
            continue
        if len(photo.content) > MAX_PHOTO_BYTES:
            continue
        suffix = {"image/webp": ".webp", "image/png": ".png"}.get(kind.split(";")[0], ".jpg")
        (folder / f"photo-{saved:02d}{suffix}").write_bytes(photo.content)
        saved += 1
    (folder / "page.html").write_text(clean_page(html, str(response.url)), encoding="utf-8")
    return {"photos": saved, **page_summary(html)}


def photo_files(folder: Path) -> list[Path]:
    return sorted(folder.glob("photo-*")) if folder.is_dir() else []
