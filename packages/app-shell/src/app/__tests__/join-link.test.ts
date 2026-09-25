import { describe, expect, it } from "vitest"
import { roomCode } from "../hooks"
import { joinArrival, joinLink } from "../join-link"

describe("joinLink", () => {
  it("points at the host's own server and names the room and the address", () => {
    // The host serves its bundle at the origin root — `request_path` maps `/`
    // to index.html — so the link is rooted there, not at the page's base.
    expect(joinLink("192.168.1.24", 5000, "W3SZ")).toBe(
      "http://192.168.1.24:5000/#/join?room=W3SZ&at=192.168.1.24:5000",
    )
  })

  it("keeps the room and address in the fragment, which is never sent", () => {
    // The never-touches-the-internet promise: the host learns nothing about
    // the room from the request line, because browsers do not send the hash.
    const [before, fragment] = joinLink("10.0.0.5", 41234, "7QF2").split("#")
    expect(before).toBe("http://10.0.0.5:41234/")
    expect(fragment).toContain("room=7QF2")
    expect(fragment).toContain("at=10.0.0.5:41234")
  })
})

describe("joinArrival", () => {
  it("reads back what joinLink wrote, for every code roomCode can produce", () => {
    for (const seed of [0, 1, 30, 31, 12345, 31 ** 4 - 1]) {
      const link = joinLink("192.168.1.24", 5000, roomCode(seed))
      const arrival = joinArrival(link.slice(link.indexOf("#")))
      expect(arrival).toEqual({ addr: "192.168.1.24:5000", seed })
    }
  })

  it("accepts a percent-encoded address, because the browser may rewrite one", () => {
    expect(joinArrival("#/join?room=W3SZ&at=192.168.1.24%3A5000")).toEqual({
      addr: "192.168.1.24:5000",
      seed: 915891,
    })
  })

  it("finds nothing when the player opened the join screen by hand", () => {
    expect(joinArrival("#/join")).toBeNull()
    expect(joinArrival("#/")).toBeNull()
    expect(joinArrival("")).toBeNull()
  })

  it("refuses a link missing either half, rather than half-filling the field", () => {
    expect(joinArrival("#/join?room=W3SZ")).toBeNull()
    expect(joinArrival("#/join?at=192.168.1.24:5000")).toBeNull()
  })

  it("refuses a room code that is not exactly four valid characters", () => {
    // The code is the seed: a code that decodes anyway builds a different
    // board silently, because every frame still parses.
    expect(joinArrival("#/join?room=ABC&at=192.168.1.24:5000")).toBeNull()
    expect(joinArrival("#/join?room=AB1D&at=192.168.1.24:5000")).toBeNull()
  })

  it("still accepts the lower-case spelling a scanner may hand back", () => {
    expect(joinArrival("#/join?room=w3sz&at=192.168.1.24:5000")?.seed).toBe(915891)
  })
})
