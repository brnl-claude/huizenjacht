/**
 * Pictures for the PDF, drawn in the browser: the house's main photo and a small map of where it
 * is. Both come back as JPEG data URLs in the exact shape the PDF needs (rounded corners on
 * white), or null when they cannot be had: offline, no photo, an address the map does not know,
 * or the map turned off on the server (HJ_MAP=false). The PDF is then made without them.
 */

import { photoUrls, type House } from './house'

/** Pixels per PDF point: sharp enough to print, small enough to share. */
const SCALE = 2.5
const TILE = 256

export type Picture = { data: string; width: number; height: number }

export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom
  const sin = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  }
}

/** The tiles that cover `width` × `height` map pixels around a point, and where each goes. */
export function tilesAround(lat: number, lon: number, zoom: number, width: number, height: number) {
  const centre = worldPixel(lat, lon, zoom)
  const left = centre.x - width / 2
  const top = centre.y - height / 2
  const tiles: { x: number; y: number; dx: number; dy: number }[] = []
  const count = 2 ** zoom
  for (let ty = Math.floor(top / TILE); ty * TILE < top + height; ty++) {
    for (let tx = Math.floor(left / TILE); tx * TILE < left + width; tx++) {
      if (ty < 0 || ty >= count) continue
      tiles.push({ x: ((tx % count) + count) % count, y: ty, dx: tx * TILE - left, dy: ty * TILE - top })
    }
  }
  return tiles
}

function canvasFor(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * SCALE)
  canvas.height = Math.round(height * SCALE)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(SCALE, SCALE)
  return [canvas, ctx]
}

function roundedClip(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.roundRect(0, 0, width, height, radius)
  ctx.clip()
}

async function bitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(String(response.status))
  return createImageBitmap(await response.blob())
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return work(controller.signal)
    .catch(() => null)
    .finally(() => clearTimeout(timer))
}

/** The first photo, cropped to fill `width` × `height` points. */
export function housePhoto(house: House, width: number, height: number, radius = 8): Promise<Picture | null> {
  const url = photoUrls(house)[0]
  if (!url) return Promise.resolve(null)
  return withTimeout(async (signal) => {
    const image = await bitmap(url, signal)
    const [canvas, ctx] = canvasFor(width, height)
    roundedClip(ctx, width, height, radius)
    const fit = Math.max(width / image.width, height / image.height)
    const w = image.width * fit
    const h = image.height * fit
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
    image.close()
    return { data: canvas.toDataURL('image/jpeg', 0.86), width, height }
  }, 15_000)
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // A Lucide-style map pin, 22 points tall, its point on the house.
  ctx.save()
  ctx.translate(x - 11, y - 23)
  ctx.scale(22 / 24, 22 / 24)
  ctx.shadowColor = 'rgb(0 0 0 / 35%)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1.5
  const body = new Path2D('M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0')
  ctx.fillStyle = '#f7a100'
  ctx.fill(body)
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 1.6
  ctx.strokeStyle = '#ffffff'
  ctx.stroke(body)
  ctx.beginPath()
  ctx.arc(12, 10, 3.2, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
}

/**
 * A map of `width` × `height` points around the house, with a pin on it. The server looks the
 * address up and hands out OpenStreetMap tiles from its own cache (see backend/app/kaart.py).
 */
export function houseMap(
  house: House,
  width: number,
  height: number,
  { zoom = 15, radius = 8 }: { zoom?: number; radius?: number } = {},
): Promise<Picture | null> {
  if (!house.adres) return Promise.resolve(null)
  return withTimeout(async (signal) => {
    const response = await fetch(`/api/houses/${encodeURIComponent(house.id)}/ligging`, { signal })
    if (!response.ok) return null
    const { lat, lon } = (await response.json()) as { lat: number; lon: number }
    // Map pixels a little smaller than points: street names as large as the text around them.
    const zoomIn = 0.85
    const tiles = tilesAround(lat, lon, zoom, width / zoomIn, height / zoomIn)
    const images = await Promise.all(
      tiles.map((t) => bitmap(`/api/kaart/${zoom}/${t.x}/${t.y}.png`, signal).catch(() => null)),
    )
    if (!images.some(Boolean)) return null
    const [canvas, ctx] = canvasFor(width, height)
    roundedClip(ctx, width, height, radius)
    ctx.fillStyle = '#eceae4'
    ctx.fillRect(0, 0, width, height)
    tiles.forEach((t, i) => {
      const image = images[i]
      if (image) ctx.drawImage(image, t.dx * zoomIn, t.dy * zoomIn, TILE * zoomIn, TILE * zoomIn)
      image?.close()
    })
    pin(ctx, width / 2, height / 2)
    // The licence asks for the credit on the map itself.
    const credit = '© OpenStreetMap'
    ctx.font = '5.5px Roboto, Arial, sans-serif'
    const w = ctx.measureText(credit).width + 6
    ctx.fillStyle = 'rgb(255 255 255 / 85%)'
    ctx.fillRect(width - w, height - 9, w, 9)
    ctx.fillStyle = '#555555'
    ctx.fillText(credit, width - w + 3, height - 2.6)
    return { data: canvas.toDataURL('image/jpeg', 0.88), width, height }
  }, 20_000)
}
