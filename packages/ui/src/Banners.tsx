/**
 * The two banner views, as pure functions of what they render.
 *
 * They take their text rather than subscribing, because `ui` sits below
 * `app-shell` and the store lives up there — reaching up for the atoms is the
 * cycle the layer tags exist to prevent. `app-shell` owns the subscription and
 * keeps it in a leaf of its own, which is what preserves the property below.
 *
 * Kept apart from the board and the HUD so a notice popping up (routine — an
 * illegal card play, a mistimed roll) never re-renders the 3D scene, and a
 * desync (rare, and never something to paper over) is never missed for the
 * same reason.
 */
import { css, cx } from "styled-system/css"

const banner = css({ margin: 0, padding: "0.6rem 0.85rem", borderRadius: "10px", fontSize: "0.9rem" })

/** Exported so `match.tsx` can give the armed-defuse tip the same notice
 *  look without a second banner subscribing to the store just to render it. */
export const noticeBanner = cx(
  banner,
  css({ background: "rgba(242, 163, 60, 0.15)", border: "1px solid", borderColor: "flag", color: "flag" }),
)

export const NoticeBannerView = ({ notice }: { notice: string | null }) => {
  if (!notice) return null
  return (
    <p className={noticeBanner} role="status">
      {notice}
    </p>
  )
}

export const DesyncBannerView = ({ desync }: { desync: string | null }) => {
  if (!desync) return null
  return (
    <p
      className={cx(banner, css({ background: "rgba(217, 69, 95, 0.18)", border: "1px solid", borderColor: "mine", color: "mine" }))}
      role="alert"
    >
      Out of sync with the host: {desync}
    </p>
  )
}
