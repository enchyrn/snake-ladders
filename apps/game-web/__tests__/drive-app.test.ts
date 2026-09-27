import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { clippedControls, recordProblems, serveDist } from "@mutation/tooling/drive-app"

const open: Array<{ close: (cb?: () => void) => void }> = []

afterEach(async () => {
  await Promise.all(
    open.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))),
  )
})

const fixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), "drive-app-"))
  await writeFile(join(dir, "index.html"), '<!doctype html><div id="root">hello</div>')
  return dir
}

/** Follows the self-signed certificate the harness mints for itself. */
const get = (origin: string, path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const url = new URL(path, origin)
    const send = url.protocol === "https:" ? httpsRequest : httpRequest
    const req = send(url, { rejectUnauthorized: false }, (res) => {
      let body = ""
      res.on("data", (c) => (body += c))
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on("error", reject)
    req.end()
  })

describe("serveDist", () => {
  it("serves over plain http unless asked otherwise", async () => {
    const served = await serveDist({ dist: await fixture(), port: 0 })
    open.push(served.server)
    expect(served.origin.startsWith("http://")).toBe(true)
    const page = await get(served.origin, "/")
    expect(page.status).toBe(200)
    expect(page.body).toContain('id="root"')
  })

  it("serves over TLS when asked, which is the only way to reach a secure context", async () => {
    // Mixed-content refusal, service-worker registration and installability
    // only exist on a secure origin, so a plain http harness cannot reproduce
    // any of them however carefully it drives the page.
    const served = await serveDist({ dist: await fixture(), port: 0, https: true })
    open.push(served.server)
    expect(served.origin.startsWith("https://")).toBe(true)
    const page = await get(served.origin, "/")
    expect(page.status).toBe(200)
    expect(page.body).toContain('id="root"')
  })

  it("keeps refusing everything outside the base path over TLS too", async () => {
    const served = await serveDist({
      dist: await fixture(),
      port: 0,
      https: true,
      base: "/snake-ladders",
    })
    open.push(served.server)
    expect((await get(served.origin, "/snake-ladders/")).status).toBe(200)
    // Both spellings of the prefix resolve; anything above it does not exist,
    // exactly as on a host serving a project site.
    expect((await get(served.origin, "/snake-ladders")).status).toBe(200)
    expect((await get(served.origin, "/")).status).toBe(404)
  })

  it("refuses a longer name that merely starts with the base, and its escape", async () => {
    // The check was a bare string prefix, so /snake-laddersX counted as inside
    // the base and left a *relative* remainder — the one shape where a leading
    // ".." survives normalize and join walks back out of dist.
    const parent = await mkdtemp(join(tmpdir(), "drive-app-outer-"))
    await writeFile(join(parent, "secret.txt"), "not servable")
    const dist = join(parent, "dist")
    await mkdir(dist)
    await writeFile(join(dist, "index.html"), '<!doctype html><div id="root">hello</div>')

    const served = await serveDist({ dist, port: 0, base: "/snake-ladders" })
    open.push(served.server)

    const escaped = await get(served.origin, "/snake-ladders../secret.txt")
    expect(escaped.status).toBe(404)
    expect(escaped.body).not.toContain("not servable")
  })
})

describe("clippedControls", () => {
  const at = (name: string, left: number, right: number) => ({ name, left, right, width: right - left })

  // The armed Roll at 320px, as measured: the match screen clips overflow, so
  // the page never scrolled and scrollWidth alone passed it.
  it("reports a control past the right edge", () => {
    expect(clippedControls([at("Confirm roll", 214, 348)], 320)).toEqual([
      '"Confirm roll" spans 214–348px of a 320px viewport',
    ])
  })

  it("reports a control past the left edge", () => {
    expect(clippedControls([at("Leave", -12, 90)], 320)).toHaveLength(1)
  })

  it("passes controls inside the viewport, subpixel rounding, and unrendered ones", () => {
    expect(
      clippedControls([at("Roll", 171, 304), at("Tray", 16, 320.4), { name: "gone", left: 400, right: 400, width: 0 }], 320),
    ).toEqual([])
  })
})

describe("recordProblems", () => {
  // Just the three events the gate listens for, shaped like Playwright's.
  const page = () => new EventEmitter()
  const response = (status: number, url: string) => ({ status: () => status, url: () => url })
  const message = (type: string, text: string) => ({ type: () => type, text: () => text })

  it("records page errors, failed responses and console errors", () => {
    const problems: string[] = []
    const p = page()
    recordProblems(p, problems)
    p.emit("pageerror", new Error("boom"))
    p.emit("response", response(404, "http://localhost/icon.png"))
    p.emit("console", message("error", "Uncaught thing"))
    expect(problems).toEqual(["pageerror: boom", "404 http://localhost/icon.png", "console: Uncaught thing"])
  })

  it("ignores successes, warnings, and the console echo of a failed request", () => {
    const problems: string[] = []
    const p = page()
    recordProblems(p, problems)
    p.emit("response", response(200, "http://localhost/"))
    p.emit("response", response(304, "http://localhost/sw.js"))
    p.emit("console", message("warning", "deprecated"))
    // The response handler already named the URL; this line cannot.
    p.emit("console", message("error", "Failed to load resource: the server responded with a status of 404"))
    expect(problems).toEqual([])
  })

  // The 320px passes are separate pages; a problem must say which one it was.
  it("names the page it came from when given a label", () => {
    const problems: string[] = []
    const p = page()
    recordProblems(p, problems, "320px hidden")
    p.emit("pageerror", new Error("boom"))
    p.emit("response", response(500, "http://localhost/x"))
    p.emit("console", message("error", "bad"))
    expect(problems).toEqual([
      "320px hidden: pageerror: boom",
      "320px hidden: 500 http://localhost/x",
      "320px hidden: console: bad",
    ])
  })
})
