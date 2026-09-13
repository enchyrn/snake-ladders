import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeTransport } from "../factory"
import type { Committed } from "../transport"

describe("makeTransport", () => {
  /**
   * The regression this pins: inside the installed app, pass-and-play was
   * given the LAN transport, so its very first action was submitted to a room
   * that had never been opened and the lobby failed with a transport error.
   * Pass-and-play must work with no room, on every platform.
   */
  it.each([true, false])(
    "gives pass-and-play a transport that works with no room open (native=%s)",
    async (native) => {
      const transport = makeTransport("local", native)
      const commits: Committed[] = []
      transport.onCommit((c) => commits.push(c))

      // No host() call, deliberately: pass-and-play never opens one.
      await Effect.runPromise(transport.submit({ _tag: "Join", playerId: "a", name: "A" }))
      await new Promise((r) => setTimeout(r, 20))

      expect(commits.map((c) => c.seq)).toEqual([0])
    },
  )

  it("uses the relay transport for a networked match outside the installed app", async () => {
    const transport = makeTransport("network", false)
    // A browser cannot host, and says so plainly rather than failing obscurely.
    const result = await Effect.runPromise(
      Effect.either(transport.host({ seed: 1, name: "a", capacity: 6 })),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") expect(result.left.reason).toMatch(/cannot host/)
  })
})
