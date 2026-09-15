/**
 * Holds the one live client, so whoever disposes it reads the current value
 * rather than one captured earlier.
 *
 * A React handler rebuilt each render closes over that render's state, and a
 * caller that opens and then closes within a single render — JoinScreen, on a
 * failed join — would dispose the client from before the open and leave the
 * new one running. Every MatchClient writes into the one shared atom, so an
 * abandoned one is a live writer, not just garbage.
 *
 * `clearIf` is the other half of that: a caller whose work has been overtaken —
 * a join that settles late, after the player has already joined somewhere else
 * — would otherwise dispose the session it no longer owns.
 */
export interface ClientSlot<T extends { dispose: () => void }> {
  readonly current: T | null
  put: (next: T) => T
  clear: () => void
  /** Disposes only when `expected` is still the held value; reports whether it was. */
  clearIf: (expected: T) => boolean
}

/**
 * The `closeIf` contract every session-like owner needs, factored out of
 * `SessionProvider` so it can be exercised without rendering a React
 * component: run `teardown` only when `clearIf` shows this caller still owns
 * the slot. A version that calls `clearIf` and `teardown` unconditionally
 * would pass every `ClientSlot` test (it never touches `held` itself) while
 * still tearing down a live session out from under a caller that lost the
 * race — the bug this composition exists to rule out.
 *
 * Returns whether `owned` still held the slot, so a caller that lost the
 * race can also skip whatever it would otherwise have done after tearing
 * down — reporting an error into a screen the player has already left, say.
 */
export const closeIfOwned = <T extends { dispose: () => void }>(
  clientSlot: ClientSlot<T>,
  owned: T,
  teardown: () => void,
): boolean => {
  const owns = clientSlot.clearIf(owned)
  if (owns) teardown()
  return owns
}

export const makeClientSlot = <T extends { dispose: () => void }>(): ClientSlot<T> => {
  let held: T | null = null
  return {
    get current() {
      return held
    },
    put: (next) => {
      held?.dispose()
      held = next
      return next
    },
    clear: () => {
      held?.dispose()
      held = null
    },
    clearIf: (expected) => {
      if (held !== expected) return false
      held.dispose()
      held = null
      return true
    },
  }
}
