import type { HouseRecord, Mine } from './house'

export class ApiError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers:
        init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json', ...init.headers }
          : init.headers,
    })
  } catch {
    throw new ApiError('Geen verbinding met de server. Probeer het zo nog eens.')
  }
  if (!response.ok) {
    let detail = `Er ging iets mis (${response.status}).`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // keep the generic message
    }
    throw new ApiError(detail)
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

export const api = {
  health: () => request<Health>('/api/health'),
  houses: () => request<HouseRecord[]>('/api/houses'),
  createHouse: (mine: Mine) =>
    request<HouseRecord>('/api/houses', { method: 'POST', body: JSON.stringify(mine) }),
  updateHouse: (id: string, changes: Partial<Record<keyof Mine, unknown>>) =>
    request<HouseRecord>(`/api/houses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
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
  restore: (backup: unknown) =>
    request<{ houses: number }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(backup),
    }),
}
