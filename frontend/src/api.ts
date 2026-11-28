import type { Document, HouseRecord, Mine, Person } from './house'
import type { Media } from './media'

export class ApiError extends Error {
  /** The HTTP status, or 0 when the server could not be reached. */
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

// Several requests can answer 401 at once; start the login only once, so the attempts do not
// overwrite each other's login cookie.
let loggingIn = false

/** This browser tab, so live updates can skip the changes it made itself. */
export const CLIENT_ID = Math.random().toString(36).slice(2)

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'X-Client': CLIENT_ID,
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('Geen verbinding met de server. Probeer het zo nog eens.')
  }
  if (response.status === 401) {
    // Not logged in (OIDC): go through the login and come back to the same page.
    const body = await response.json().catch(() => ({}))
    if (typeof body.login === 'string') {
      if (!loggingIn) {
        loggingIn = true
        location.assign(`${body.login}?next=${encodeURIComponent(`/${location.hash}`)}`)
      }
      throw new ApiError('Je wordt doorgestuurd naar de login…', 401)
    }
  }
  if (!response.ok) {
    let detail = `Er ging iets mis (${response.status}).`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // keep the generic message
    }
    throw new ApiError(detail, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export type Health = {
  status: string
  version: string
  commitUrl: string
  environment: { label: string; color: string }
}

export type ImportResult = {
  created: number
  updated: number
  unchanged: number
  errors: { file: string; error: string }[]
  ids?: string[]
  skipped?: boolean
}

export type ImportStatus = {
  folderConfigured: boolean
  folderAvailable: boolean
  fileCount: number
  scanInterval: number
  lastScan: string | null
  lastResult: ImportResult | null
}

export type Share = {
  id: string
  title: string | null
  text: string | null
  url: string | null
  createdAt: string
  files: Media[]
}

export type LoginSession = {
  id: string
  device: string | null
  via: 'oidc' | 'telefoon'
  createdAt: string
  expiresAt: string
}

export type StorageCategory =
  | 'fotos'
  | 'videos'
  | 'memos'
  | 'documenten'
  | 'advertenties'
  | 'gegevens'
  | 'backups'

export type StorageUsage = {
  categories: Record<StorageCategory, { bytes: number; count: number }>
  total: number
  disk: { total: number; free: number } | null
}

export type NightlyBackups = {
  enabled: boolean
  time: string
  keepDays: number
  backups: { name: string; size: number; createdAt: string }[]
}

export type Me = {
  mode: 'none' | 'oidc'
  // May make, download and restore backups (OIDC group HJ_ADMIN_GROUPS; everyone without login).
  admin: boolean
  user: { subject: string; name: string | null; email: string | null } | null
}

/** A public read-only link to one house (/gedeeld/<token>), for someone without an account. */
export type PublicLink = { token: string; path: string; created: string }

export const api = {
  me: () => request<Me>('/api/auth/me'),
  logout: () => request<unknown>('/api/auth/logout', { method: 'POST' }),
  sessions: () => request<{ current: string; sessions: LoginSession[] }>('/api/auth/sessions'),
  endSession: (id: string) => request<void>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  pairing: (id: string) => request<{ code: string; device: string }>(`/api/auth/pair/${encodeURIComponent(id)}`),
  approvePairing: (id: string) =>
    request<unknown>(`/api/auth/pair/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  denyPairing: (id: string) => request<unknown>(`/api/auth/pair/${encodeURIComponent(id)}/deny`, { method: 'POST' }),
  health: () => request<Health>('/api/health'),
  houses: () => request<HouseRecord[]>('/api/houses'),
  house: (id: string) => request<HouseRecord>(`/api/houses/${encodeURIComponent(id)}`),
  documents: (id: string) => request<Document[]>(`/api/houses/${encodeURIComponent(id)}/documenten`),
  people: () => request<{ me: string; people: Person[] }>('/api/people'),
  claimAnswers: () => request<{ houses: number }>('/api/people/claim', { method: 'POST' }),
  createHouse: (mine: Mine) =>
    request<HouseRecord>('/api/houses', { method: 'POST', body: JSON.stringify(mine) }),
  updateHouse: (id: string, changes: Partial<Record<keyof Mine, unknown>>) =>
    request<HouseRecord>(`/api/houses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  importListing: (id: string, url: string, html: string, photos?: string) =>
    request<HouseRecord>(`/api/houses/${encodeURIComponent(id)}/listing/import`, {
      method: 'POST',
      body: JSON.stringify({ url, html, photos }),
    }),
  publicLink: (id: string) => request<PublicLink | null>(`/api/houses/${encodeURIComponent(id)}/publiek`),
  /** Make the link, or with `nieuw` replace it so the old one stops working. */
  savePublicLink: (id: string, nieuw = false) =>
    request<PublicLink>(`/api/houses/${encodeURIComponent(id)}/publiek`, {
      method: 'PUT',
      body: JSON.stringify({ nieuw }),
    }),
  stopPublicLink: (id: string) =>
    request<void>(`/api/houses/${encodeURIComponent(id)}/publiek`, { method: 'DELETE' }),
  bookmarklet: () => request<{ token: string }>('/api/bookmarklet'),
  bookmarkletRotate: () => request<{ token: string }>('/api/bookmarklet/rotate', { method: 'POST' }),
  deleteHouse: (id: string) =>
    request<void>(`/api/houses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  importStatus: () => request<ImportStatus>('/api/import'),
  importScan: () => request<ImportResult>('/api/import/scan', { method: 'POST' }),
  importUpload: (files: File[]) => {
    const form = new FormData()
    for (const file of files) form.append('files', file)
    return request<ImportResult>('/api/import/upload', { method: 'POST', body: form })
  },
  getSetting: <T>(key: string) => request<{ value: T | null }>(`/api/settings/${key}`),
  putSetting: <T>(key: string, value: T) =>
    request<{ value: T }>(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  updateMedia: (id: string, changes: { item?: string | null; note?: string }) =>
    request<Media>(`/api/media/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  deleteMedia: (id: string) => request<void>(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  share: (id: string) => request<Share>(`/api/share/${encodeURIComponent(id)}`),
  fileShare: (id: string, house: string, item: string | null) =>
    request<{ house: string; files: number }>(`/api/share/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ house, item }),
    }),
  dropShare: (id: string) => request<void>(`/api/share/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  storage: () => request<StorageUsage>('/api/opslag'),
  nightly: () => request<NightlyBackups>('/api/backups'),
  restoreNightly: (name: string) =>
    request<{ houses: number; media: number }>(`/api/backups/${encodeURIComponent(name)}/restore`, {
      method: 'POST',
    }),
  restoreFull: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ houses: number; media: number }>('/api/backup/restore/volledig', { method: 'POST', body })
  },
  restore: (backup: unknown) =>
    request<{ houses: number }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(backup),
    }),
}
