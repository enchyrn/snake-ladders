import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "node:url"

const host = process.env.TAURI_DEV_HOST

// Tauri mobile serves the dev server to a physical device, so the dev server
// must bind to the LAN address Tauri hands us rather than localhost.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Mobile webviews: Android 9+ / iOS 13+ safe baselines.
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
