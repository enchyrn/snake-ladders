import { describe, expect, it } from "vitest"
import config from "../../../../panda.config"

const recipe = () => {
  const recipes = config.theme?.extend?.recipes ?? {}
  return recipes.button
}

describe("the button recipe", () => {
  it("covers every button this app has", () => {
    expect(Object.keys(recipe().variants.variant).sort()).toEqual([
      "card", "ghost", "primary", "secondary", "toggle",
    ])
  })

  // Every variant is a real tap target on a phone; the survey found buttons
  // that were not.
  it("never defines a size below the 44px tap minimum", () => {
    for (const size of Object.values(recipe().variants.size)) {
      expect(size.minHeight).toBe("tap")
    }
  })
})
