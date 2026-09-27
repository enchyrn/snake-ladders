/**
 * A ref callback for a row pinned to the bottom of the viewport (the lobby's
 * Start row): the document scroller reserves the row's height as
 * `scroll-padding-bottom`, so keyboard focus and `scrollIntoView` stop above
 * the row instead of under it (WCAG 2.2 2.4.11). A `scroll-margin` on the
 * controls could not do this — Chromium's focus scroll skips any element
 * already inside the viewport, including one drawn behind the row.
 *
 * Measured rather than a constant because the row's height is not one: the
 * host's button and a peer's "Waiting for the host" line differ, and the
 * bottom padding grows with the safe area. `--pinned-bottom` is also how
 * anything floating (the update toast) stays above the row, so both are
 * removed on unmount — a screen with no pinned row must not inherit either.
 */
export const reservePinnedBottom = (row: HTMLElement | null) => {
  if (!row) return
  const root = document.documentElement
  const observer = new ResizeObserver(() => {
    root.style.setProperty("--pinned-bottom", `${Math.ceil(row.getBoundingClientRect().height)}px`)
    // The few extra pixels are for the focus ring, drawn outside a control's
    // box, and for the fraction of a pixel a whole-pixel scroll can leave.
    root.style.setProperty("scroll-padding-bottom", "calc(var(--pinned-bottom) + 4px)")
  })
  // The border box, not the default content box: a safe-area change moves
  // only the row's padding, which the content box never sees.
  observer.observe(row, { box: "border-box" })
  return () => {
    observer.disconnect()
    root.style.removeProperty("--pinned-bottom")
    root.style.removeProperty("scroll-padding-bottom")
  }
}
