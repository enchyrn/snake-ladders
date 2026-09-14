import { defineConfig } from "vitest/config"
import { fileURLToPath, URL } from "node:url"

export default defineConfig({
  resolve: {
    alias: {
      "@mutation/engine": fileURLToPath(new URL("./packages/engine/src", import.meta.url)),
      "@mutation/net": fileURLToPath(new URL("./packages/net/src", import.meta.url)),
      "@mutation/render": fileURLToPath(new URL("./packages/render/src", import.meta.url)),
      "@mutation/ui": fileURLToPath(new URL("./packages/ui/src", import.meta.url)),
      "@mutation/app-shell": fileURLToPath(new URL("./packages/app-shell/src", import.meta.url)),
      // Tests run against the real relay and the real dist server rather than
      // fakes; an alias keeps that a declared project edge the boundary rule
      // can check, instead of a `../../../..` that reaches past it unseen.
      "@mutation/relay": fileURLToPath(new URL("./apps/relay/lan-relay.mjs", import.meta.url)),
      "@mutation/tooling": fileURLToPath(new URL("./scripts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["apps/**/*.test.ts", "packages/**/*.test.ts"] },
})
