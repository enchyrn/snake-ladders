import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import pandaConfig from "../../../../panda.config"
import { BOARD_PX, HEADER_PX } from "../layout/bands"

// Panda 2.0.0-beta.17 ships no default presets. panda.config.ts declaring
// none meant every utility (bg, px, w, h, …) was undefined, so extraction
// silently fell back to the bare property/value pair instead of resolving a
// token — e.g. `.background_surface { background: surface; }`, which is not
// valid CSS, and every token-coloured style was dropped at runtime with no
// error anywhere in the pipeline. This runs the real extraction Panda's
// build step relies on (`panda cssgen`) against the real source tree.
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url))

let outDir = ""
let generated = ""

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "panda-tokens-test-"))
  const outfile = join(outDir, "out.css")
  execFileSync(join(repoRoot, "node_modules/.bin/panda"), ["cssgen", "--outfile", outfile], {
    cwd: repoRoot,
    stdio: "pipe",
  })
  generated = readFileSync(outfile, "utf8")
}, 60_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

interface Declaration {
  readonly property: string
  readonly value: string
}

// Custom properties are skipped: they are the token definitions themselves.
const declarations = (css: string): ReadonlyArray<Declaration> =>
  [...css.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:\s*([^;{}]+);/g)]
    .map((m) => ({ property: m[1]!, value: m[2]!.trim() }))
    .filter((d) => !d.property.startsWith("--"))

/** Every token name the stylesheet defines, in the spellings a source file
 *  would write it: `--colors-surface-raised` → `surfaceRaised`, `seat.0`. */
const tokenNames = (css: string, category: string): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const m of css.matchAll(new RegExp(`--${category}-([a-z0-9-]+):`, "g"))) {
    const kebab = m[1]!
    names.add(kebab)
    names.add(kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()))
    names.add(kebab.replace(/-(\d+)$/, ".$1"))
  }
  return names
}

const SPACING = /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)/
const COLOUR = /(^|-)(color|background|fill|stroke)$|^background$|^border(-[a-z]+)?-color$/
const SIZE = /^(min-|max-)?(width|height)$/

describe("panda css extraction", () => {
  it("resolves colour tokens to CSS variables, not bare token names", () => {
    expect(generated).toMatch(/background:\s*var\(--colors-surface\)/)
    expect(generated).not.toMatch(/background:\s*surface\s*;/)
  })

  // A multi-value shorthand of token names (`padding: "3 4"`, or
  // `"0 gutterR"`) is not resolved token by token — Panda emits it verbatim,
  // and `padding: 3 4` is invalid CSS the browser drops without a word. The
  // one before this test existed shipped in PwaPrompt's toast.
  it("emits no unresolved spacing token, alone or in a shorthand", () => {
    const spacing = tokenNames(generated, "spacing")
    const bad = declarations(generated).filter(
      (d) =>
        SPACING.test(d.property) &&
        d.value.split(/\s+/).some((part) => /^[1-9]\d*(\.\d+)?$/.test(part) || spacing.has(part)),
    )
    expect(bad).toEqual([])
  })

  it("emits no bare colour or size token names", () => {
    const colours = tokenNames(generated, "colors")
    const sizes = tokenNames(generated, "sizes")
    const bad = declarations(generated).filter(
      (d) =>
        (COLOUR.test(d.property) && d.value.split(/\s+/).some((part) => colours.has(part))) ||
        (SIZE.test(d.property) && sizes.has(d.value)),
    )
    expect(bad).toEqual([])
  })
})

// The band budget's arithmetic and the stylesheet's sizes are two copies of
// the same two numbers. A test is what keeps them one.
describe("layout tokens", () => {
  const sizes = pandaConfig.theme?.extend?.tokens?.sizes as Record<string, { value: string }> | undefined

  it("sizes the board band at BOARD_PX", () => {
    expect(sizes?.["board"]?.value).toBe(`${BOARD_PX}px`)
  })

  it("sizes the header band at HEADER_PX", () => {
    expect(sizes?.["header"]?.value).toBe(`${HEADER_PX}px`)
  })
})
