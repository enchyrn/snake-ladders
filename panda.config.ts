import { defineConfig } from "@pandacss/dev"
import { colourTokens } from "./scripts/palette-tokens.mjs"

export default defineConfig({
  preflight: false, // apps/game-web/styles.css already owns the resets
  include: ["./packages/**/src/**/*.{ts,tsx}", "./apps/game-web/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  // No styled() factory: this codebase writes plain JSX.
  jsxFramework: undefined,
  theme: {
    extend: {
      tokens: {
        colors: colourTokens,
        spacing: {
          "1": { value: "4px" }, "2": { value: "8px" }, "3": { value: "12px" },
          "4": { value: "16px" }, "5": { value: "24px" }, "6": { value: "32px" },
        },
        fontSizes: {
          xs: { value: "12px" }, sm: { value: "13px" }, md: { value: "15px" },
          lg: { value: "18px" }, xl: { value: "24px" }, display: { value: "32px" },
        },
        sizes: { tap: { value: "44px" }, board: { value: "366px" } },
      },
      // Panda's breakpoints are min-width, so the 320-380 band where the
      // progress rows and card rail are tightest is the UNPREFIXED base.
      // Author for 320 and widen at `sm`, never the other way round.
      breakpoints: { sm: "380px" },
    },
  },
})
