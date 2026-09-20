/**
 * Panda's colour tokens are generated from palette.ts rather than written
 * beside it, because the DOM overlay and the WebGL board drifting apart is a
 * bug nobody sees until two devices look different. ADR 0021.
 */
import { palette, seatColours } from "../packages/render/src/palette.ts"

const value = (v) => ({ value: v })

/**
 * Surface levels are the stylesheet's names for board colours, not colours of
 * their own — aliased rather than restated so a palette edit still reaches
 * them. They are the three `styles.css` defined as `var(--board-*)`.
 */
const surfaces = {
  surface: palette.boardDark,
  surfaceRaised: palette.boardLight,
  border: palette.boardEdge,
}

export const colourTokens = {
  ...Object.fromEntries(
    Object.entries({ ...palette, ...surfaces }).map(([k, v]) => [k, value(v)]),
  ),
  seat: Object.fromEntries(seatColours.map((hex, i) => [String(i), value(hex)])),
}
