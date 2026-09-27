import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { decodeAction } from "../actions"
import { initialMatch } from "../match"
import { defaultConfig } from "../types"
import { at, run } from "./helpers"

describe("Join with a colour", () => {
  // A required field makes an older build's frame undecodable, and CLAUDE.md
  // classifies that as desync — meaning mismatched builds. Optional is what
  // keeps a cosmetic feature from becoming a version wall.
  it("still decodes a frame from a build that does not send one", () => {
    const older = { _tag: "Join", playerId: "p1", name: "Mamba" }
    expect(decodeAction(older)._tag).toBe("Right")
  })

  it("decodes a frame that does", () => {
    const newer = { _tag: "Join", playerId: "p1", name: "Mamba", colour: "#4cc2ff" }
    expect(decodeAction(newer)._tag).toBe("Right")
  })

  // The two cases above pass without the field declared at all: a Struct
  // ignores excess keys — by dropping them, so the colour would be lost on
  // every frame that crossed the wire.
  it("keeps the colour through a decode", () => {
    const newer = { _tag: "Join", playerId: "p1", name: "Mamba", colour: "#4cc2ff" }
    expect(Either.getOrThrow(decodeAction(newer))).toEqual(newer)
  })
})

describe("a player's colour", () => {
  const lobby = () => initialMatch(defaultConfig(7))

  it("is carried onto the player a Join seats", () => {
    const state = run(lobby(), { _tag: "Join", playerId: "p1", name: "Mamba", colour: "#4cc2ff" })
    expect(at(state, "p1").colour).toBe("#4cc2ff")
  })

  it("stays absent, not undefined, when the Join carries none", () => {
    const state = run(lobby(), { _tag: "Join", playerId: "p1", name: "Mamba" })
    expect("colour" in at(state, "p1")).toBe(false)
  })

  // A re-Join is how the lobby changes a pick; the seat must not move with it.
  it("changes on a re-Join, and a re-Join without one returns to the seat colour", () => {
    let state = run(lobby(), { _tag: "Join", playerId: "p0", name: "Adder" })
    state = run(state, { _tag: "Join", playerId: "p1", name: "Mamba", colour: "#4cc2ff" })
    state = run(state, { _tag: "Join", playerId: "p1", name: "Mamba", colour: "#ff6b5a" })
    expect(at(state, "p1").colour).toBe("#ff6b5a")
    expect(at(state, "p1").seat).toBe(1)

    state = run(state, { _tag: "Join", playerId: "p1", name: "Mamba" })
    expect("colour" in at(state, "p1")).toBe(false)
  })
})
