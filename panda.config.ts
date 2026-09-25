import { defineConfig } from "@pandacss/dev"

export default defineConfig({
  preflight: false, // apps/game-web/styles.css already owns the resets
  include: ["./packages/**/src/**/*.{ts,tsx}", "./apps/game-web/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  jsxFramework: undefined, // no styled() factory: this codebase writes plain JSX
})
