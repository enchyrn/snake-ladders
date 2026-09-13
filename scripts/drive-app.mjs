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
 *   npm run build
 *   node scripts/drive-app.mjs
 *   node scripts/drive-app.mjs --base-path /code/artifact/abc --out /tmp/shots
 *
 * `--base-path` serves the app from a subdirectory, which is how a static
 * host or an artifact serves it. That is not a hypothetical: a path-history
 * router matched none of its routes there and rendered a not-found page
 * instead of the game.
 *
 * First run on a new machine needs the browser: npx playwright install chromium
 */
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, mkdir, readdir } from "node:fs/promises"
import { extname, join, normalize, resolve } from "node:path"

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const DIST = resolve(arg("--dist", "dist"))
const OUT = resolve(arg("--out", "screenshots"))
const BASE = arg("--base-path", "")
const [WIDTH, HEIGHT] = arg("--viewport", "390x844").split("x").map(Number)
const PORT = Number(arg("--port", 8910))

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
}

const serve = () =>
  new Promise((ready) => {
    const server = createServer(async (req, res) => {
      let path = decodeURIComponent((req.url ?? "/").split("?")[0])
      if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length)
      path = normalize(path).replace(/^\/+/, "")
      // normalize("") is "." — reading that is a directory, not the page.
      const file = join(DIST, path === "" || path === "." ? "index.html" : path)
      try {
        const body = await readFile(file)
        res.writeHead(200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        })
        res.end(body)
      } catch {
        res.writeHead(404).end("not found")
      }
    })
    server.listen(PORT, () => ready(server))
  })

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
  const server = await serve()
  const browser = await launchChromium()
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
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

  console.log(`Serving ${DIST} at http://localhost:${PORT}${BASE || "/"}`)
  await page.goto(`http://localhost:${PORT}${BASE || "/"}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)

  const root = await page.$("#root")
  if (!root) throw new Error("the app did not mount: no #root in the document")
  const mounted = (await root.innerHTML()).length
  if (mounted < 200) {
    problems.push(`#root has only ${mounted} chars — the app mounted but rendered nothing`)
  }
  console.log("home:", await page.$$eval("button", (b) => b.map((x) => x.textContent.trim())))
  await shot("1-home")

  await page.getByRole("button", { name: /pass and play/i }).click()
  await page.waitForTimeout(800)
  console.log("lobby route:", new URL(page.url()).hash || new URL(page.url()).pathname)
  await shot("2-lobby")

  const start = page.getByRole("button", { name: /^start/i })
  if (await start.count()) {
    await start.click()
    await page.waitForTimeout(2500)
  }
  await shot("3-match")

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
    await shot("4-rolled")
  }

  // A phone viewport must never scroll sideways.
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  )
  if (overflow > 0) problems.push(`page overflows horizontally by ${overflow}px`)

  await browser.close()
  server.close()
}

await run()

if (problems.length > 0) {
  console.error("\nProblems:")
  for (const p of problems) console.error("  - " + p)
  process.exit(1)
}
console.log("\nNo console errors, no page errors, no horizontal overflow.")
