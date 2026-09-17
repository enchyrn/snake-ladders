import { defineConfig } from "@pandacss/dev"

export default defineConfig({
  preflight: false, // apps/game-web/styles.css already owns the resets
  include: ["./packages/**/src/**/*.{ts,tsx}", "./apps/game-web/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  // No styled() factory: this codebase writes plain JSX.
  jsxFramework: undefined,
})
