import type { TimelineEvent } from "@mutation/engine/events"
import type { MatchState } from "@mutation/engine/types"

/** The part of a `Scene` that showing a round drives. Narrow on purpose: it
 *  is the whole contract between React's effect and the renderer, and it is
 *  what lets the ordering below be tested without a WebGL context. */
export interface RoundStage {
  sync(state: MatchState, options: { readonly snapTokens: boolean }): void
  play(timeline: ReadonlyArray<TimelineEvent>, onDone: () => void): void
}

/**
 * Show `state`, replaying its round if it carries one `lastPlayed` is not
 * already. Returns the timeline the stage now owns, for the caller to hold.
 *
 * The ordering is the point. `sync` places tokens wherever the state says
 * they are, but the state handed to a render that is about to replay a round
 * is that round's *outcome* — so placing them there puts each token on its
 * destination and the clip then animates it from its origin, playing the move
 * backwards after the fact. While a round is pending the clips own the
 * tokens; `play`'s `onDone` places them once it has finished.
 */
export const showRound = (
  stage: RoundStage,
  state: MatchState,
  lastPlayed: ReadonlyArray<TimelineEvent> | null,
  onSettled?: () => void,
): ReadonlyArray<TimelineEvent> | null => {
  // Identity, not length: the engine builds a fresh timeline per round, and
  // two rounds can resolve to the same events.
  const pending = state.timeline.length > 0 && state.timeline !== lastPlayed
  stage.sync(state, { snapTokens: !pending })
  if (!pending) return lastPlayed

  const timeline = state.timeline
  stage.play(timeline, () => {
    stage.sync(state, { snapTokens: true })
    onSettled?.()
  })
  return timeline
}
