import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Panda 2.0.0-beta.17 ships no default presets. panda.config.ts declaring
// none meant every utility (bg, px, w, h, …) was undefined, so extraction
// silently fell back to the bare property/value pair instead of resolving a
// token — e.g. `.background_surface { background: surface; }`, which is not
// valid CSS, and every token-coloured style was dropped at runtime with no
// error anywhere in the pipeline. This runs the real extraction Panda's
// build step relies on (`panda cssgen`) against the real source tree, and
// pins that a token property already in production use (HUD.tsx's
// `css({ background: "surface" })`) resolves to a CSS custom property
// rather than being emitted verbatim.
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url))

describe("panda css extraction", () => {
  it("resolves colour tokens to CSS variables, not bare token names", () => {
    const outDir = mkdtempSync(join(tmpdir(), "panda-tokens-test-"))
    const outfile = join(outDir, "out.css")
    try {
      execFileSync(join(repoRoot, "node_modules/.bin/panda"), ["cssgen", "--outfile", outfile], {
        cwd: repoRoot,
        stdio: "pipe",
      })
      const css = readFileSync(outfile, "utf8")

      expect(css).toMatch(/background:\s*var\(--colors-surface\)/)
      expect(css).not.toMatch(/background:\s*surface\s*;/)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
