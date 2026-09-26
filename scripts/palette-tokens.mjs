/**
 * Panda's colour tokens are generated from palette.ts rather than written
 * beside it, because the DOM overlay and the WebGL board drifting apart is a
 * bug nobody sees until two devices look different. ADR 0021.
 */
import { palette, seatColours } from "../packages/render/src/palette.ts"

const value = (v) => ({ value: v })

// palette.ts has no `surface`/`surfaceRaised`/`border` entries of their own —
// apps/game-web/styles.css derives them from boardDark/boardLight/boardEdge
// (`--surface: var(--board-dark)` etc.), and the button recipe needs those
// same names as real tokens, so the aliasing that today lives in styles.css
// is reproduced here rather than invented fresh.
export const colourTokens = {
  ...Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, value(v)])),
  surface: value(palette.boardDark),
  surfaceRaised: value(palette.boardLight),
  border: value(palette.boardEdge),
  seat: Object.fromEntries(seatColours.map((hex, i) => [String(i), value(hex)])),
}
