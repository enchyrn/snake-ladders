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
      recipes: {
        button: {
          className: "btn",
          base: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            gap: "2", borderRadius: "10px", fontFamily: "inherit", fontWeight: 600,
            cursor: "pointer", border: "1px solid transparent",
            _disabled: { opacity: 0.45, cursor: "default" },
          },
          variants: {
            variant: {
              primary: { bg: "finish", color: "void", fontWeight: 700 },
              secondary: { bg: "surfaceRaised", color: "text", borderColor: "border" },
              ghost: { bg: "transparent", color: "textDim" },
              card: { bg: "surfaceRaised", color: "text", borderColor: "border", flexDirection: "column", gap: "1" },
              toggle: { bg: "surfaceRaised", color: "text", borderColor: "border" },
            },
            size: {
              sm: { minHeight: "tap", px: "3", fontSize: "xs" },
              md: { minHeight: "tap", px: "4", fontSize: "md" },
              lg: { minHeight: "tap", px: "5", fontSize: "lg", height: "64px" },
            },
          },
          defaultVariants: { variant: "secondary", size: "md" },
        },
      },
      // Panda's breakpoints are min-width, so the 320-380 band where the
      // progress rows and card rail are tightest is the UNPREFIXED base.
      // Author for 320 and widen at `sm`, never the other way round.
      breakpoints: { sm: "380px" },
    },
  },
})
