import { useEffect, useRef, useState } from "react"

/** Swaps in a waiting service worker and reloads to run under it. */
export type ApplyUpdate = () => Promise<void>

/**
 * What this component needs from whoever owns service-worker registration.
 *
 * Declared here rather than imported from `app-shell` because `ui` sits below
 * it: the component states the shape it depends on and the layer above
 * supplies something matching, which is what keeps the dependency pointing
 * downward. `app-shell`'s `registerServiceWorker` is the implementation, and
 * tsc checks the two against each other at the call site.
 */
export interface RegisterServiceWorker {
  (handlers: {
    readonly onUpdateAvailable?: () => void
    readonly onOfflineReady?: () => void
  }): ApplyUpdate
}

/**
 * Registers the service worker and surfaces its two moments to the player.
 *
 * The update is offered rather than applied. A new bundle can carry a changed
 * engine, and swapping it under a running match would have one device folding
 * the log by different rules than the rest — the precise desync the whole
 * design exists to prevent. So the player chooses when to take it, and the
 * natural moment is between matches.
 */
export const PwaPrompt = ({ register }: { register: RegisterServiceWorker }) => {
  const [updateReady, setUpdateReady] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const applyRef = useRef<ApplyUpdate | null>(null)

  useEffect(() => {
    applyRef.current = register({
      onUpdateAvailable: () => setUpdateReady(true),
      onOfflineReady: () => setOfflineReady(true),
    })
  }, [register])

  // "Ready offline" is reassurance, not a decision — it retires on its own.
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(() => setOfflineReady(false), 4000)
    return () => clearTimeout(timer)
  }, [offlineReady])

  if (updateReady) {
    return (
      <div className="pwa-toast" role="status">
        <span>A new version is ready.</span>
        <button type="button" onClick={() => void applyRef.current?.()}>
          Update
        </button>
        <button type="button" className="ghost" onClick={() => setUpdateReady(false)}>
          Later
        </button>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className="pwa-toast" role="status">
        <span>Ready to play offline.</span>
      </div>
    )
  }

  return null
}
