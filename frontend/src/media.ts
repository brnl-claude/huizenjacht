/**
 * Photos, videos and voice memos of a house. A new file waits in an outbox in this browser
 * (IndexedDB) until the server has it, so recording during a viewing without signal works:
 * it uploads by itself once there is a connection again.
 */

import { useSyncExternalStore } from 'react'
import { CLIENT_ID } from './api'

export type MediaKind = 'foto' | 'video' | 'audio'

export type Media = {
  id: string
  /** Checklist item id, or null for the house in general. */
  item: string | null
  kind: MediaKind
  mime: string
  name: string | null
  size: number
  duration: number | null
  thumb: boolean
  person: string | null
  note: string
  createdAt: string
}

export type Pending = {
  id: string
  houseId: string
  item: string | null
  kind: MediaKind
  file: Blob
  name: string
  thumb?: Blob
  duration?: number
  createdAt: string
  state: 'wacht' | 'bezig' | 'fout'
  progress?: number
  error?: string
}

export const mediaUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`
export const thumbUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/thumb`

export function kindOf(type: string): MediaKind | null {
  const top = type.split('/')[0]
  return top === 'image' ? 'foto' : top === 'video' ? 'video' : top === 'audio' ? 'audio' : null
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Outbox in IndexedDB; in memory only when the browser has none (private window).

const DB_NAME = 'huizenjacht'
const STORE = 'outbox'
let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

type Stored = Omit<Pending, 'state' | 'progress' | 'error'>

function stored(p: Pending): Stored {
  const { state: _s, progress: _p, error: _e, ...rest } = p
  return rest
}

let pending: Pending[] = []
const listeners = new Set<() => void>()
let onUploaded: (houseId: string) => void = () => undefined

function emit() {
  pending = [...pending]
  for (const l of listeners) l()
}

function patch(id: string, changes: Partial<Pending>) {
  pending = pending.map((p) => (p.id === id ? { ...p, ...changes } : p))
  emit()
}

export function usePending(houseId: string): Pending[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pending,
  )
  return all.filter((p) => p.houseId === houseId)
}

/** Starts the outbox: loads what waited from an earlier visit and retries now and then. */
export function startOutbox(uploaded: (houseId: string) => void) {
  onUploaded = uploaded
  void idb<Stored[]>('readonly', (s) => s.getAll() as IDBRequest<Stored[]>).then((rows) => {
    const known = new Set(pending.map((p) => p.id))
    const loaded = (rows ?? []).filter((r) => !known.has(r.id)).map((r) => ({ ...r, state: 'wacht' as const }))
    if (loaded.length) {
      pending = [...loaded, ...pending]
      emit()
    }
    void flush()
  })
  window.addEventListener('online', () => void flush())
  setInterval(() => pending.some((p) => p.state === 'wacht') && void flush(), 30_000)
}

/** Adds files to a house (and checklist item). Returns the names that are no photo, video or sound. */
export async function addFiles(houseId: string, item: string | null, files: File[]): Promise<string[]> {
  const refused: string[] = []
  for (const file of files) {
    const kind = kindOf(file.type)
    if (!kind) {
      refused.push(file.name)
      continue
    }
    await add(houseId, item, file, file.name, kind)
  }
  return refused
}

export async function addRecording(houseId: string, item: string | null, blob: Blob, duration: number) {
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  await add(houseId, item, blob, `memo-${stamp}.${ext}`, 'audio', duration)
}

async function add(houseId: string, item: string | null, file: Blob, name: string, kind: MediaKind, duration?: number) {
  const made = kind === 'audio' ? {} : await preview(file, kind)
  const entry: Pending = {
    id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
    houseId,
    item,
    kind,
    file,
    name,
    thumb: made.thumb,
    duration: duration ?? made.duration,
    createdAt: new Date().toISOString(),
    state: 'wacht',
  }
  pending = [...pending, entry]
  emit()
  await idb('readwrite', (s) => s.put(stored(entry)))
  // Ask the browser to keep the outbox when storage runs low.
  void navigator.storage?.persist?.().catch(() => undefined)
  void flush()
}

export async function discard(id: string) {
  pending = pending.filter((p) => p.id !== id)
  emit()
  await idb('readwrite', (s) => s.delete(id))
}

export function retry(id: string) {
  patch(id, { state: 'wacht', error: undefined })
  void flush()
}

let flushing = false

/** One tab at a time uploads (Web Locks), so two open tabs never send the same file. */
async function flush() {
  if (flushing) return
  flushing = true
  try {
    if (navigator.locks) {
      await navigator.locks.request('huizenjacht-outbox', { ifAvailable: true }, (lock) => (lock ? send() : undefined))
    } else {
      await send()
    }
  } finally {
    flushing = false
  }
}

async function send() {
  for (;;) {
    const next = pending.find((p) => p.state === 'wacht')
    if (!next) break
    // Another tab may have sent it meanwhile.
    if (dbPromise && (await openDb()) && !(await idb('readonly', (s) => s.getKey(next.id)))) {
      pending = pending.filter((p) => p.id !== next.id)
      emit()
      onUploaded(next.houseId)
      continue
    }
    patch(next.id, { state: 'bezig', progress: 0 })
    const result = await upload(next)
    if (result === 'ok') {
      pending = pending.filter((p) => p.id !== next.id)
      emit()
      await idb('readwrite', (s) => s.delete(next.id))
      onUploaded(next.houseId)
    } else if (result === 'later') {
      patch(next.id, { state: 'wacht', progress: undefined })
      break
    } else {
      patch(next.id, { state: 'fout', progress: undefined, error: result.error })
    }
  }
}

/** XMLHttpRequest instead of fetch, for the upload progress of a large video. */
function upload(p: Pending): Promise<'ok' | 'later' | { error: string }> {
  return new Promise((resolve) => {
    const form = new FormData()
    form.append('file', p.file, p.name)
    if (p.thumb) form.append('thumb', p.thumb, 'thumb.jpg')
    if (p.item) form.append('item', p.item)
    // The same key again when an answer got lost: the server keeps the file once.
    form.append('key', p.id)
    if (p.duration != null && Number.isFinite(p.duration)) form.append('duration', String(p.duration))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/houses/${encodeURIComponent(p.houseId)}/media`)
    xhr.setRequestHeader('X-Client', CLIENT_ID)
    xhr.upload.onprogress = (e) => e.lengthComputable && patch(p.id, { progress: e.loaded / e.total })
    xhr.onerror = () => resolve('later')
    xhr.ontimeout = () => resolve('later')
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve('ok')
      // Not logged in, server busy or restarting: try again later.
      if (xhr.status === 401 || xhr.status === 408 || xhr.status === 429 || xhr.status >= 500) return resolve('later')
      let error = `Uploaden mislukt (${xhr.status}).`
      try {
        const body = JSON.parse(xhr.responseText)
        if (typeof body.detail === 'string') error = body.detail
      } catch {
        // keep the generic message
      }
      if (xhr.status === 413 && !error.includes('groot')) error = 'Dit bestand is te groot voor de server.'
      resolve({ error })
    }
    xhr.send(form)
  })
}

// Previews: a small JPEG, made in the browser, so lists do not load full photos and videos.

const THUMB_SIZE = 480

export async function preview(file: Blob, kind: MediaKind): Promise<{ thumb?: Blob; duration?: number }> {
  try {
    if (kind === 'foto') {
      const bitmap = await createImageBitmap(file)
      const thumb = await draw(bitmap, bitmap.width, bitmap.height)
      bitmap.close()
      return { thumb }
    }
    if (kind === 'video') return await videoPreview(file)
  } catch {
    // no preview; the list shows an icon
  }
  return {}
}

function draw(source: CanvasImageSource, width: number, height: number): Promise<Blob | undefined> {
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.8))
}

function videoPreview(file: Blob): Promise<{ thumb?: Blob; duration?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let duration: number | undefined
    const done = (thumb?: Blob) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve({ thumb, duration })
    }
    const timer = setTimeout(() => done(), 8000)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadedmetadata = () => {
      duration = Number.isFinite(video.duration) ? video.duration : undefined
      video.currentTime = Math.min(0.5, (duration ?? 1) / 2)
    }
    video.onseeked = () => void draw(video, video.videoWidth, video.videoHeight).then(done, () => done())
    video.onerror = () => done()
    video.src = url
  })
}

/** Makes and stores a preview for a file that arrived without one (shared to the app). */
export async function ensureThumb(media: Media): Promise<boolean> {
  if (media.thumb || media.kind === 'audio') return false
  try {
    const blob = await (await fetch(mediaUrl(media.id))).blob()
    const made = await preview(blob, media.kind)
    if (!made.thumb) return false
    const form = new FormData()
    form.append('thumb', made.thumb, 'thumb.jpg')
    const res = await fetch(`${mediaUrl(media.id)}/thumb`, { method: 'PUT', body: form, headers: { 'X-Client': CLIENT_ID } })
    return res.ok
  } catch {
    return false
  }
}

// Voice memos

export function recorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
}

export function canRecord(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && recorderType() !== undefined
}
