import { describe, expect, it } from "vitest"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState } from "@mutation/engine/types"
import type { TimelineEvent } from "@mutation/engine/events"
import { showRound, type RoundStage } from "../round-playback"

const moved = (from: number, to: number): TimelineEvent =>
  ({ _tag: "Moved", playerId: "a", from, to }) as TimelineEvent

/** Records what a real `Scene` would have been told to do. */
const stage = () => {
  const calls: string[] = []
  let settle: (() => void) | null = null
  const it: RoundStage = {
    sync: (_state, options) => calls.push(options.snapTokens ? "sync:snap" : "sync:hold"),
    play: (timeline, onDone) => {
      calls.push(`play:${timeline.length}`)
      settle = onDone
    },
  }
  return { it, calls, settle: () => settle?.() }
}

const withTimeline = (timeline: ReadonlyArray<TimelineEvent>): MatchState => ({
  ...initialMatch(defaultConfig(915891)),
  timeline,
})

describe("showRound", () => {
  it("does not place tokens on a state whose round is about to replay", () => {
    // The defect this guards: `sync` ran unconditionally before `play`, and it
    // places tokens whenever nothing is animating — which is exactly true
    // between rounds. The token landed on its destination and the clip then
    // animated it from its origin, so the move played backwards.
    const s = stage()
    showRound(s.it, withTimeline([moved(1, 7)]), null)
    expect(s.calls).toEqual(["sync:hold", "play:1"])
  })

  it("places them once the round has played out", () => {
    const s = stage()
    showRound(s.it, withTimeline([moved(1, 7)]), null)
    s.settle()
    expect(s.calls).toEqual(["sync:hold", "play:1", "sync:snap"])
  })

  it("places them directly when the state carries no round to replay", () => {
    const s = stage()
    showRound(s.it, withTimeline([]), null)
    expect(s.calls).toEqual(["sync:snap"])
  })

  it("replays a round once, however many times React re-renders it", () => {
    const s = stage()
    const state = withTimeline([moved(1, 7)])
    const played = showRound(s.it, state, null)
    showRound(s.it, state, played)
    // The second render still shows the state; it just does not replay it,
    // and with nothing pending it may place tokens again.
    expect(s.calls).toEqual(["sync:hold", "play:1", "sync:snap"])
  })

  it("reports the timeline it played, so the caller can hold it", () => {
    const s = stage()
    const timeline = [moved(1, 7)]
    expect(showRound(s.it, withTimeline(timeline), null)).toBe(timeline)
  })

  it("keeps holding the previous timeline when there is nothing new to play", () => {
    const s = stage()
    const timeline = [moved(1, 7)]
    expect(showRound(s.it, withTimeline([]), timeline)).toBe(timeline)
  })

  it("calls back once the round has settled, for the caller's own bookkeeping", () => {
    const s = stage()
    let settled = 0
    showRound(s.it, withTimeline([moved(1, 7)]), null, () => (settled += 1))
    expect(settled).toBe(0)
    s.settle()
    expect(settled).toBe(1)
  })
})
