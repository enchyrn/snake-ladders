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

// Floating, and it has to be. Placed in flow after the routed screen, every
// screen being at least a viewport tall put it below the fold, where the only
// control that applies an update was never seen. It floated before too, and
// sat over the lobby's lower controls — which is why it stays off the match
// screen entirely (the prompt's own `suppressed`), why the update toast can be
// put away, and why the text-only one lets taps through.
const toast = css({
  position: "fixed",
  // Clear of the home indicator and the rounded corners: the viewport is
  // viewport-fit=cover, so an inset of zero here sits under both.
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
  left: "max(env(safe-area-inset-left, 0px), 0.75rem)",
  right: "max(env(safe-area-inset-right, 0px), 0.75rem)",
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  gap: "3",
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
export const PwaPrompt = ({
  register,
  suppressed = false,
}: {
  readonly register: RegisterServiceWorker
  /** Hold both toasts back without unmounting, so registration runs once and
   *  a waiting update is still offered when the player leaves the match. */
  readonly suppressed?: boolean
}) => {
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

  if (suppressed) return null

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
      <div className={cx(toast, css({ pointerEvents: "none" }))} role="status">
        <span className={css({ flex: 1 })}>Ready to play offline.</span>
      </div>
    )
  }

  return null
}
