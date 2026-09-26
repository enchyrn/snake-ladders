#!/usr/bin/env node
/**
 * Drive the built app in a real browser and screenshot what it renders.
 *
 * This exists because three separate bugs were invisible in the source and
 * obvious the moment someone looked at a picture: the board was clipping its
 * left and right columns, the event log rendered behind the control bar and
 * was never visible, and a disabled button was styled as the primary action.
 * Reading the stylesheet would not have found any of them.
 *
 *   nub run build
 *   node scripts/drive-app.mjs
 *   node scripts/drive-app.mjs --base-path /code/artifact/abc --out /tmp/shots
 *
 *   PUBLIC_BASE_PATH=/snake-ladders nub run build   # what Pages deploys
 *   nub run verify:ui:pages
 *   node scripts/drive-app.mjs --https --base-path /snake-ladders
 *
 * `--https` serves over TLS with a certificate minted for the run, because a
 * secure origin is not cosmetic: a service worker will not register without
 * one, and a page will not refuse an insecure socket without one either. Both
 * were invisible until the deployed site had them and this harness did not.
 * Needs openssl on PATH.
 *
 * `--base-path` serves the app from a subdirectory, which is how a static
 * host, an artifact or GitHub Pages serves it, and nothing outside that
 * prefix resolves. That is not a hypothetical: a path-history router matched
 * none of its routes there and rendered a not-found page instead of the game.
 * The prefix has to match the base the bundle was built with — built at "/"
 * and served under one, every asset 404s, which is the point.
 *
 * First run on a new machine needs the browser: nubx playwright install chromium
 */
import { chromium } from "playwright"
import { createServer } from "node:http"
import { createServer as createTlsServer } from "node:https"
import { execFileSync } from "node:child_process"
import { readFile, mkdir, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const DIST = resolve(arg("--dist", "dist"))
const OUT = resolve(arg("--out", "screenshots"))
// Trailing slash stripped so both spellings of the flag behave the same and
// both spellings of the request resolve: a host serving a project site
// answers /snake-ladders and /snake-ladders/ with the same page.
const BASE = arg("--base-path", "").replace(/\/+$/, "")
const [WIDTH, HEIGHT] = arg("--viewport", "390x844").split("x").map(Number)
const PORT = Number(arg("--port", 8910))
// A secure origin, so the run can reach behaviour that does not exist on
// http at all: a service worker registering, an install prompt, and a page
// refusing the insecure socket a LAN match needs.
const HTTPS = process.argv.includes("--https")

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
}

/**
 * A throwaway certificate for `localhost`, minted per run.
 *
 * Nothing trusts it and nothing should: the browser is told to accept it for
 * this one session. It exists only so the page has a secure origin, which is
 * not a detail — mixed-content refusal, service-worker registration and
 * installability do not exist on http, so a plain harness cannot reproduce
 * any of them however carefully it drives the page.
 */
const selfSigned = async () => {
  const dir = await mkdtemp(join(tmpdir(), "drive-app-cert-"))
  const key = join(dir, "key.pem")
  const cert = join(dir, "cert.pem")
  try {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", key, "-out", cert,
        "-days", "1", "-nodes", "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    )
  } catch (cause) {
    throw new Error(`--https needs openssl on PATH to mint a certificate: ${cause}`)
  }
  return { key: await readFile(key), cert: await readFile(cert) }
}

/**
 * Serve `dist` the way a static host does, optionally over TLS.
 *
 * Exported so a test can exercise the serving rules without launching a
 * browser; the CLI below is the only caller that also drives a page.
 */
export const serveDist = async ({ dist, base = "", port = 0, https = false }) => {
  // Both spellings of the prefix have to resolve: a host serving a project
  // site answers /snake-ladders and /snake-ladders/ with the same page.
  const prefix = base.replace(/\/+$/, "")
  const handler = async (req, res) => {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0])
    if (prefix) {
      // Outside the base nothing exists, exactly as on a host serving a
      // project site from a subdirectory. Falling back to dist/ instead
      // would serve a root-absolute URL — the manifest, an icon, the
      // service worker — happily here and 404 only once deployed, which
      // is the one failure this flag exists to catch.
      // The prefix has to end on a path boundary. /snake-laddersX is a
      // different site, and counting it as inside the base leaves a
      // *relative* remainder, where normalize keeps a leading ".." instead
      // of collapsing it and join walks back out of dist.
      const rest = path.startsWith(prefix) ? path.slice(prefix.length) : null
      if (rest === null || (rest !== "" && !rest.startsWith("/"))) {
        res.writeHead(404).end("not found")
        return
      }
      path = rest
    }
    path = normalize(path).replace(/^\/+/, "")
    // normalize("") is "." — reading that is a directory, not the page.
    const file = join(dist, path === "" || path === "." ? "index.html" : path)
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      })
      res.end(body)
    } catch {
      res.writeHead(404).end("not found")
    }
  }

  const server = https ? createTlsServer(await selfSigned(), handler) : createServer(handler)
  await new Promise((ready) => server.listen(port, ready))
  const bound = server.address().port
  return {
    server,
    port: bound,
    origin: `${https ? "https" : "http"}://localhost:${bound}`,
  }
}

/**
 * Launch Chromium, falling back to any build already present under
 * PLAYWRIGHT_BROWSERS_PATH. Playwright insists on a browser matching its own
 * version, but a container that ships one a version or two off is still
 * perfectly capable of rendering the page — and demanding a 150MB download
 * to take a screenshot is not a good trade.
 */
const launchChromium = async () => {
  // swiftshader: CI and containers have no GPU, and WebGL must still work.
  const args = ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
  // A context's ignoreHTTPSErrors does not cover the service worker: Chrome
  // fetches that script outside the context and refuses a certificate it
  // cannot verify, so registration fails with an SSL error while every other
  // request succeeds. Registration is most of why a secure origin is worth
  // having, so the browser has to be told as well.
  if (HTTPS) args.push("--ignore-certificate-errors")
  const explicit = arg("--browser", "")
  if (explicit) return chromium.launch({ args, executablePath: explicit })
  try {
    return await chromium.launch({ args })
  } catch (cause) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    if (!root) throw cause
    const found = (await readdir(root).catch(() => []))
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .at(-1)
    if (!found) throw cause
    const executablePath = join(root, found, "chrome-linux", "chrome")
    console.log(`Using the browser already installed at ${executablePath}`)
    return chromium.launch({ args, executablePath })
  }
}

const problems = []

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const served = await serveDist({ dist: DIST, base: BASE, port: PORT, https: HTTPS })
  let browser
  try {
    browser = await launchChromium()
    await drive(served, browser)
  } finally {
    // Without this a thrown error left the server listening, and an open
    // handle keeps node alive: the run hung instead of reporting the very
    // problem it had just found.
    await browser?.close()
    served.server.close()
  }
}

const drive = async (served, browser) => {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    // The certificate is minted for this run and trusted by nothing, which
    // is the point: the origin is secure, the issuer is irrelevant.
    ignoreHTTPSErrors: HTTPS,
  })

  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
  // A console error for a failed request says nothing about which request, so
  // report the response instead — an unactionable "404 (Not Found)" is worse
  // than no report at all.
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`)
  })
  page.on("console", (m) => {
    const text = m.text()
    if (m.type() !== "error") return
    if (/Failed to load resource/.test(text)) return // covered by the response handler
    problems.push(`console: ${text}`)
  })

  const shot = async (name) => {
    await page.screenshot({ path: join(OUT, `${name}.png`) })
    console.log(`  screenshot -> ${join(OUT, `${name}.png`)}`)
  }

  // Recorded where the toast lands at the instant it is inserted: it retires
  // itself after four seconds, so looking for it afterwards races its exit.
  // It once rendered in flow below a full-height screen, i.e. never on screen.
  if (HTTPS) {
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        const el = [...document.querySelectorAll('[role="status"]')].find((n) =>
          /ready to play offline/i.test(n.textContent ?? ""),
        )
        if (!el) return
        const r = el.getBoundingClientRect()
        window.__offlineToast = { top: r.top, bottom: r.bottom, viewport: innerHeight }
        observer.disconnect()
      }).observe(document, { childList: true, subtree: true })
    })
  }

  const entry = `${served.origin}${BASE || "/"}`
  console.log(`Serving ${DIST} at ${entry}`)
  await page.goto(entry, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)

  const root = await page.$("#root")
  if (!root) throw new Error("the app did not mount: no #root in the document")
  const mounted = (await root.innerHTML()).length
  if (mounted < 200) {
    problems.push(`#root has only ${mounted} chars — the app mounted but rendered nothing`)
  }
  console.log("home:", await page.$$eval("button", (b) => b.map((x) => x.textContent.trim())))
  await shot("1-home")

  // The whole reason for a secure origin: registration is a no-op on http,
  // so without this the offline shell is only ever inspected as files in
  // dist/ and never watched to install.
  if (HTTPS) {
    // Asked of the context, not evaluated in the page: a page being claimed by
    // a newly activated worker can lose its execution context mid-call, and
    // navigator.serviceWorker.ready never settles when nothing registers — it
    // does not reject — so the obvious version of this check hangs rather
    // than reporting the failure it exists to catch.
    const context = page.context()
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => null))
    console.log("service worker:", worker ? worker.url() : "none registered")
    if (!worker) problems.push("no service worker registered on a secure origin")
    const toast = await page
      .waitForFunction(() => window.__offlineToast, null, { timeout: 15_000 })
      .then((h) => h.jsonValue())
      .catch(() => null)
    console.log("offline toast:", toast)
    if (!toast) problems.push('the "ready to play offline" toast never appeared')
    else if (toast.top < 0 || toast.bottom > toast.viewport)
      problems.push(`the offline toast rendered off screen (top ${toast.top}, viewport ${toast.viewport})`)
  }

  await page.getByRole("button", { name: /pass and play/i }).click()
  await page.waitForTimeout(800)
  console.log("lobby route:", new URL(page.url()).hash || new URL(page.url()).pathname)
  await shot("2-lobby")

  // Refreshing off the home route is where a subdirectory deployment breaks:
  // the host has no file at that path, so a router reading anything but the
  // fragment asks for a page that was never built and renders not-found.
  // Landing back on home is a pass — lobby.tsx sends you there deliberately
  // when a reload leaves it with no match client — but not-found is not.
  const deepRoute = new URL(page.url()).hash
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(1000)
  const reloaded = await page.$("#root")
  const markup = reloaded ? await reloaded.innerHTML() : ""
  if (markup.length < 200) {
    problems.push(`refreshing at ${deepRoute} rendered ${markup.length} chars — the app did not come back`)
  }
  // Scoped to #root, not the whole document: the router's fallback is the
  // thing being tested, and page copy is free to use the words elsewhere.
  if (/not found/i.test(markup)) {
    problems.push(`refreshing at ${deepRoute} rendered the router's not-found page`)
  }
  console.log(`refresh at ${deepRoute} ->`, new URL(page.url()).hash || "/")
  await shot("3-refreshed")

  // Back through the lobby, since the refresh above dropped the match client.
  await page.getByRole("button", { name: /pass and play/i }).click()
  await page.waitForTimeout(800)

  const start = page.getByRole("button", { name: /^start/i })
  if (await start.count()) {
    await start.click()
    await page.waitForTimeout(2500)
  }
  await shot("4-match")

  const canvas = await page.evaluate(() => {
    const c = document.querySelector("canvas")
    if (!c) return null
    return { width: c.width, height: c.height, webgl: !!(c.getContext("webgl2") || c.getContext("webgl")) }
  })
  if (!canvas?.webgl) problems.push("no WebGL context on the board canvas")
  console.log("canvas:", canvas)

  const roll = page.getByRole("button", { name: /^roll$/i })
  if (await roll.count()) {
    await roll.click()
    // Wait for the narration rather than sleeping a guessed interval: a roll
    // resolves as fast as the engine folds it but the board animates for a
    // variable time afterwards, so a fixed delay reports an empty log on a
    // fast round and a slow machine alike.
    await page
      .waitForFunction(() => (document.querySelectorAll(".log li").length > 0), null, {
        timeout: 8000,
      })
      .catch(() => problems.push("nothing was narrated after rolling"))
    await page.waitForTimeout(1800) // let the token finish moving before the shot
    console.log("log:", await page.$$eval(".log li", (n) => n.map((x) => x.textContent)))
    await shot("5-rolled")
  }

  // A phone viewport must never scroll sideways.
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  )
  if (overflow > 0) problems.push(`page overflows horizontally by ${overflow}px`)

}

// Importing this module must not drive a browser: the serving rules above are
// exercised directly by src/__tests__/drive-app.test.ts.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())
if (!isMain) {
  // Nothing to do — the export is the point.
} else {
  await run()

  if (problems.length > 0) {
    console.error("\nProblems:")
    for (const p of problems) console.error("  - " + p)
    process.exit(1)
  }
  console.log("\nNo console errors, no page errors, no horizontal overflow.")
}
