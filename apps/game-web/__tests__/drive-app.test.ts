import { mkdtemp, writeFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error -- plain .mjs with no type declarations
import { serveDist } from "@mutation/tooling/drive-app.mjs"

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
})
