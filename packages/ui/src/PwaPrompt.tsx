import { useEffect, useRef, useState } from "react"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"

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

// Was `position: fixed`, which is exactly what sat on top of the lobby's
// module list and the join screen's room list — an element that floats can
// always end up over a control. Static, at the end of whatever screen raised
// it, means it only ever pushes content rather than covering it.
const toast = css({
  display: "flex",
  alignItems: "center",
  gap: "3",
  marginTop: "4",
  paddingBlock: "3",
  paddingInline: "4",
  borderRadius: "12px",
  background: "surfaceRaised",
  border: "1px solid",
  borderColor: "revealedEdge",
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.45)",
  fontSize: "0.9rem",
})

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
      <div className={toast} role="status">
        <span className={css({ flex: 1 })}>A new version is ready.</span>
        <button
          type="button"
          className={cx(button({ size: "sm" }), css({ whiteSpace: "nowrap" }))}
          onClick={() => void applyRef.current?.()}
        >
          Update
        </button>
        <button
          type="button"
          className={cx(button({ variant: "ghost", size: "sm" }), css({ whiteSpace: "nowrap" }))}
          onClick={() => setUpdateReady(false)}
        >
          Later
        </button>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className={toast} role="status">
        <span className={css({ flex: 1 })}>Ready to play offline.</span>
      </div>
    )
  }

  return null
}
