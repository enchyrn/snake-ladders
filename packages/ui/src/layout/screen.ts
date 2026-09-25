import { css, cx } from "styled-system/css"

/** The safe-area gutters every screen pads out to, left and right. Kept as
 *  named constants rather than repeated `max()` expressions because the
 *  match screen's board overlay and control bar need the exact same values.
 *
 *  Import these directly (not through the `@mutation/ui/...` alias) if you
 *  need them inside a `css()` call: Panda's static extraction can follow a
 *  same-package relative import (as `BoardCanvas.tsx` does) but not a
 *  package-alias one, so `packages/app-shell/src/routes/match.tsx` — which
 *  can only reach this file through the alias — mirrors the two literals by
 *  hand instead. A silently-missing rule is the failure mode: the classname
 *  still gets generated, it just matches nothing in the built CSS. */
export const GUTTER_LEFT = "max(16px, env(safe-area-inset-left))"
export const GUTTER_RIGHT = "max(16px, env(safe-area-inset-right))"

/**
 * Every route but the match screen scrolls normally, padded out to the safe
 * area on all four sides and capped to a readable line length.
 */
export const screenClass = css({
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: "4",
  padding: `max(16px, env(safe-area-inset-top)) ${GUTTER_RIGHT} max(16px, env(safe-area-inset-bottom)) ${GUTTER_LEFT}`,
  maxWidth: "640px",
  marginInline: "auto",
})

/** The match screen: the board owns it, so it fills the viewport exactly
 *  instead of scrolling, and nothing pads it — the five bands place
 *  themselves. */
export const matchScreenClass = cx(
  screenClass,
  css({ height: "100dvh", maxWidth: "none", padding: 0, gap: 0, position: "relative", overflow: "hidden" }),
)

export const barClass = css({ display: "flex", alignItems: "center", gap: "3", "& h2": { margin: 0 } })

/** `h1`/`h2`/`h3` have no shared component to hang this on — every screen
 *  titles a section with a raw heading tag, so the reset moves here instead
 *  of staying an untargeted global rule. */
export const headingClass = css({ margin: "0 0 0.5em", fontWeight: 600 })

/** Likewise for `p`: the box model (margin, line-height) that used to apply
 *  to every paragraph regardless of what else styled it. */
export const paragraphClass = css({ margin: "0 0 0.75em", lineHeight: 1.4 })

export const hintClass = css({ color: "textDim", fontSize: "0.9rem" })

export const errorClass = css({ color: "mine" })

/** The one text-input look in the app — Panda has no input recipe, since
 *  there is exactly one kind of text field and it never varies. */
export const textInputClass = css({
  minHeight: "tap",
  padding: "0 0.75em",
  border: "1px solid",
  borderColor: "border",
  borderRadius: "10px",
  background: "void",
  color: "text",
  fontFamily: "inherit",
})

export const codeClass = css({ background: "void", borderRadius: "4px", padding: "0.1em 0.35em" })
