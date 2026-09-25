import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("styles.css layering", () => {
  it("wraps all rules in @layer blocks to avoid unlayered overrides", () => {
    const stylesPath = join(__dirname, "..", "styles.css")
    const content = readFileSync(stylesPath, "utf-8")

    // Strip comments (both /* */ and line comments)
    let stripped = content
    // Remove /* */ block comments
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "")
    // Remove line comments
    stripped = stripped.replace(/\/\/.*$/gm, "")

    // Track brace depth and identify top-level statements
    let depth = 0
    let topLevelStatements: string[] = []
    let currentStatement = ""

    for (let i = 0; i < stripped.length; i++) {
      const char = stripped[i]
      currentStatement += char

      if (char === "{") {
        depth++
      } else if (char === "}") {
        depth--
        if (depth === 0) {
          // End of a top-level statement
          topLevelStatements.push(currentStatement.trim())
          currentStatement = ""
        }
      } else if (char === ";" && depth === 0) {
        // Top-level semicolon (like @layer ...;)
        topLevelStatements.push(currentStatement.trim())
        currentStatement = ""
      }
    }

    // Clean up any remaining whitespace-only statements
    topLevelStatements = topLevelStatements.filter((stmt) => stmt.length > 0 && /\S/.test(stmt))

    // All top-level statements should be either:
    // 1. @layer ... ; (the layer declaration)
    // 2. @layer base { ... } (the layer block)
    const validLayerStatements = topLevelStatements.filter(
      (stmt) =>
        stmt.startsWith("@layer reset, base, tokens, recipes, utilities;") ||
        stmt.startsWith("@layer base {"),
    )

    expect(topLevelStatements.length).toBe(validLayerStatements.length)
    expect(validLayerStatements.some((stmt) => stmt.startsWith("@layer base {"))).toBe(true)
  })
})
