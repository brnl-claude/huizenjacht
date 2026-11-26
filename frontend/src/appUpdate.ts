import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

let ready = false
let update: ((reload?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined
const listeners = new Set<() => void>()

// A new version found this soon after opening the app (or coming back to it) loads right away:
// nobody is in the middle of something yet. Later it waits for the banner, so nothing typed
// gets lost.
const LOAD_AT_ONCE_MS = 15_000
let openedAt = Date.now()

function busyTyping(): boolean {
  const el = document.activeElement
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  update = registerSW({
    onNeedRefresh() {
      ready = true
      if (Date.now() - openedAt < LOAD_AT_ONCE_MS && !busyTyping()) {
        applyUpdate()
        return
      }
      listeners.forEach((l) => l())
    },
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })
  // Back to the app after a while (also after updating the Android app, which keeps the
  // page): look for a new version and treat it as just opened.
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
    } else if (Date.now() - hiddenAt > 60_000) {
      openedAt = Date.now()
      if (ready && !busyTyping()) applyUpdate()
      else void checkForUpdate().catch(() => undefined)
    }
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
