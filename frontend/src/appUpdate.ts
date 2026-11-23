import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

let ready = false
let update: ((reload?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined
const listeners = new Set<() => void>()

export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  update = registerSW({
    onNeedRefresh() {
      ready = true
      listeners.forEach((l) => l())
    },
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => ready,
  )
}

export async function checkForUpdate(): Promise<void> {
  await registration?.update()
}

export function applyUpdate(): void {
  if (update) void update(true)
  else location.reload()
}
