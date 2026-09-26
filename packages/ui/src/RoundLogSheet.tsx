import { useEffect, useId, useRef, type RefObject } from "react"
import type { MatchState } from "@mutation/engine/types"
import { X } from "lucide-react"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"
import { EventLog } from "./EventLog"
import { MineLegend } from "./HUD"

const sheetClass = css({
  position: "absolute",
  inset: 0,
  zIndex: 6,
  display: "flex",
  flexDirection: "column",
  gap: "3",
  paddingTop: "max(16px, env(safe-area-inset-top))",
  paddingRight: "gutterR",
  paddingBottom: "max(16px, env(safe-area-inset-bottom))",
  paddingLeft: "gutterL",
  background: "rgba(8, 11, 16, 0.92)",
})

const closeClass = cx(button({ variant: "ghost", size: "sm" }), css({ width: "tap", paddingInline: "0" }))

/**
 * The full round, over the match screen. Modal in the full sense: focus moves
 * in when it opens and back to whatever opened it when it closes, Escape
 * closes it, and the caller makes everything behind it inert — except the log
 * preview, which has nothing to focus and is the live region (ADR 0020 rule 2
 * never lets that leave the tree, and an inert subtree drops out of it).
 */
export const RoundLogSheet = ({
  state,
  onClose,
  restoreFocusTo,
}: {
  readonly state: MatchState
  readonly onClose: () => void
  readonly restoreFocusTo?: RefObject<HTMLElement | null>
}) => {
  const headingId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current()
    }
    // On the window rather than the sheet: a tap on the log preview (outside
    // the sheet, and not focusable) leaves focus on <body>, and Escape still
    // has to work from there.
    window.addEventListener("keydown", onKey)
    const opener = restoreFocusTo
    return () => {
      window.removeEventListener("keydown", onKey)
      opener?.current?.focus()
    }
  }, [restoreFocusTo])

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={headingId} className={sheetClass}>
      <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
        <h2 id={headingId} className={css({ margin: 0, fontSize: "lg", fontWeight: 600 })}>
          Round log
        </h2>
        <button ref={closeRef} type="button" aria-label="Close round log" className={closeClass} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={css({ overflowY: "auto", flex: "1 1 auto" })}>
        <EventLog state={state} mode="full" />
      </div>
      {/* Where the board's legend retires to once a tile is revealed (spec:
       * "retires to the round-log sheet") — the key stays one tap away. */}
      {state.config.modules.includes("minesweeper") && <MineLegend />}
    </div>
  )
}
