import { css } from "styled-system/css"

/**
 * Every route but the match screen scrolls normally, padded out to the safe
 * area on all four sides and capped to a readable line length.
 */
export const screenClass = css({
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: "4",
  paddingTop: "max(16px, env(safe-area-inset-top))",
  paddingRight: "gutterR",
  paddingBottom: "max(16px, env(safe-area-inset-bottom))",
  paddingLeft: "gutterL",
  maxWidth: "640px",
  marginInline: "auto",
})

/** The match screen: the board owns it, so it fills the viewport exactly and
 *  only the notch pads it — each band carries its own gutters.
 *
 *  Its own complete rule rather than `cx(screenClass, css({ padding: 0 }))`:
 *  `cx` only concatenates atomic class names, and which of two conflicting
 *  utilities wins is decided by stylesheet order, not argument order. That
 *  composition left `p_0` losing to the gutters and `gap_0` to `gap_4`.
 *
 *  It scrolls only if the fixed bands cannot fit at all (a phone shorter than
 *  the budget in bands.ts), so the control bar is reachable rather than
 *  clipped — the board is never the thing that gives way. */
export const matchScreenClass = css({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  // On the screen, not the header: the banner band sits above the header, so
  // an inset carried by the header left the desync banner under the notch.
  paddingTop: "env(safe-area-inset-top)",
  position: "relative",
  overflowX: "hidden",
  overflowY: "auto",
})

/** A band of the match screen that lines its content up with the gutters. */
export const gutterBandClass = css({ paddingLeft: "gutterL", paddingRight: "gutterR" })

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
