import { describe, expect, it } from "vitest"
import config from "@mutation/panda-config"

// Throwing beats an optional chain: an absent recipe must fail the test that
// pins it, not silently satisfy an assertion about an empty object.
const recipe = () => {
  const button = config.theme?.extend?.recipes?.button
  if (!button?.variants) throw new Error("panda.config defines no button recipe")
  return button.variants
}

describe("the button recipe", () => {
  it("covers every button this app has", () => {
    expect(Object.keys(recipe().variant ?? {}).sort()).toEqual([
      "card", "ghost", "primary", "secondary", "toggle",
    ])
  })

  // Every variant is a real tap target on a phone; the survey found buttons
  // that were not. Pinning the token name rather than 44px keeps the minimum
  // in one place — the `sizes.tap` token — instead of two.
  it("never defines a size below the 44px tap minimum", () => {
    const sizes = Object.values(recipe().size ?? {})
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) {
      expect((size as { minHeight?: string }).minHeight).toBe("tap")
    }
  })
})
