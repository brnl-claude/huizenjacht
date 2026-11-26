import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

let ready = false
let update: ((reload?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined
const listeners = new Set<() => void>()

// A new version found this soon after the page loaded (a fresh start of the app) loads right
// away: nobody is in the middle of something yet. Later, also when coming back to an app that
// was still open, it waits for the banner, so nothing typed or read gets interrupted.
const LOAD_AT_ONCE_MS = 15_000
const openedAt = Date.now()
// Once someone taps or types, the page no longer loads again by itself: a reload right under a
// tap feels like the tap did it. The banner offers the new version instead.
let touched = false

function busyTyping(): boolean {
  const el = document.activeElement
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  for (const type of ['pointerdown', 'keydown']) {
    document.addEventListener(type, () => (touched = true), { capture: true, passive: true })
  }
  update = registerSW({
    onNeedRefresh() {
      ready = true
      if (Date.now() - openedAt < LOAD_AT_ONCE_MS && !touched && !busyTyping()) {
        applyUpdate()
        return
      }
      listeners.forEach((l) => l())
    },
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })
  // Back to the app after a while: look for a new version, but only offer it in the banner.
  // The page stays as it was; the new version loads by itself on the next fresh start.
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
    } else if (Date.now() - hiddenAt > 60_000) {
      void checkForUpdate().catch(() => undefined)
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
