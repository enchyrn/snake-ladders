/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from "virtual:pwa-register"

export interface ServiceWorkerHandlers {
  /** A new version finished precaching and is waiting to take over. The UI
   *  decides when (or whether) to prompt the player — never mid-match, since
   *  the new bundle can change deterministic engine behaviour. */
  readonly onUpdateAvailable?: () => void
  /** First install finished precaching; the app can now run with no network
   *  at all. Useful for a one-time "ready to play offline" toast. */
  readonly onOfflineReady?: () => void
}

/** Swaps in a waiting service worker and reloads to run under it. */
export type ApplyUpdate = () => Promise<void>

/**
 * Registers the service worker built by vite-plugin-pwa and reports back
 * through `handlers` instead of using `confirm()` or touching the DOM
 * itself, so the caller can render whatever update/offline UI it wants.
 *
 * A no-op everywhere service workers don't apply: Tauri's webview, a
 * non-secure context, or a browser without support. This is imported
 * unconditionally from app startup, so it must never throw here rather than
 * make every caller guard for those environments itself.
 */
export function registerServiceWorker(handlers: ServiceWorkerHandlers = {}): ApplyUpdate {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return async () => {}
  }
  // Service workers require a secure context (https, or localhost); Tauri's
  // custom-scheme webview and any plain-http dev access fail this check.
  if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) {
    return async () => {}
  }

  try {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => handlers.onUpdateAvailable?.(),
      onOfflineReady: () => handlers.onOfflineReady?.(),
    })
    return async () => {
      await updateSW(true)
    }
  } catch {
    // registerSW touches the network/registration APIs; if the runtime
    // claims support but registration itself throws, degrade to a no-op
    // rather than take the app down over an enhancement.
    return async () => {}
  }
}
