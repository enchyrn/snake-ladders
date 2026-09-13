import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { fileURLToPath, URL } from "node:url"

const host = process.env.TAURI_DEV_HOST

// GitHub Pages serves a project site below /<repository>/, while Tauri's
// webview, `vite preview` and the dist server all serve from the origin
// root. Every URL the shell emits — the module script, the manifest, the
// precache list — has to agree with wherever it actually lands, so the base
// is a build input rather than a constant. It stays "/" unless a deployment
// asks for otherwise, which keeps native packaging untouched.
const base = withTrailingSlash(process.env.PUBLIC_BASE_PATH ?? "/")

/** Vite's `base` and a manifest's `scope` both require the trailing slash;
 *  `${base}pwa-192.png` silently becomes a sibling path without it. */
function withTrailingSlash(value: string): string {
  const prefixed = value.startsWith("/") ? value : `/${value}`
  return prefixed.endsWith("/") ? prefixed : `${prefixed}/`
}

// Tauri mobile serves the dev server to a physical device, so the dev server
// must bind to the LAN address Tauri hands us rather than localhost.
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate": autoUpdate swaps the waiting service
      // worker in as soon as it installs, which can replace the engine
      // bundle underneath a match that's already in progress — the app is a
      // deterministic simulation shared pass-and-play/LAN, so mutating it
      // mid-match is worse than asking the player to finish up first.
      // register.ts surfaces the prompt; we don't reload for them here.
      registerType: "prompt",
      // Registration happens explicitly from src/pwa/register.ts once the
      // app is ready to handle the update/offline-ready callbacks, not via
      // the plugin's own injected bootstrap script.
      injectRegister: null,
      // The game makes no network requests beyond its own origin (no APIs,
      // no CDN fonts, no analytics) — the service worker only needs to
      // precache the built app shell so it works fully offline.
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // The three.js scene plus the engine/effect bundle land well past
        // workbox's 2 MiB default precache ceiling on their own; since this
        // app has to work with zero network at all (not just cache-first
        // for a subset of assets), the whole shell has to be precachable
        // rather than silently dropped for being large.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: "Snakes & Ladders: Mutation",
        short_name: "Mutation",
        description:
          "A local-multiplayer Snakes & Ladders board game with mutating rules, playable fully offline.",
        theme_color: "#0b0f14",
        background_color: "#0b0f14",
        display: "standalone",
        orientation: "portrait",
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}pwa-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `${base}pwa-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: `${base}pwa-maskable-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: `${base}apple-touch-icon.png`,
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      // The Tauri dev server is the primary dev loop; a dev-mode service
      // worker would sit in front of it and risk serving stale assets to
      // the webview while iterating.
      devOptions: { enabled: false },
    }),
  ],
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
    // Vite 8 bundles with rolldown and ships oxc; esbuild is only an optional
    // peer here and is not in the lockfile, so asking for it by name breaks a
    // clean `npm ci` install. oxc is the native minifier for this pipeline.
    minify: !process.env.TAURI_ENV_DEBUG ? "oxc" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
