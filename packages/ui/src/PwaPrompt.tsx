import { useEffect, useRef, useState } from "react"
import { registerServiceWorker, type ApplyUpdate } from "@mutation/app-shell/pwa/register"

/**
 * Registers the service worker and surfaces its two moments to the player.
 *
 * The update is offered rather than applied. A new bundle can carry a changed
 * engine, and swapping it under a running match would have one device folding
 * the log by different rules than the rest — the precise desync the whole
 * design exists to prevent. So the player chooses when to take it, and the
 * natural moment is between matches.
 */
export const PwaPrompt = () => {
  const [updateReady, setUpdateReady] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const applyRef = useRef<ApplyUpdate | null>(null)

  useEffect(() => {
    applyRef.current = registerServiceWorker({
      onUpdateAvailable: () => setUpdateReady(true),
      onOfflineReady: () => setOfflineReady(true),
    })
  }, [])

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
