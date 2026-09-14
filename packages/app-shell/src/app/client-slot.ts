/**
 * Holds the one live client, so whoever disposes it reads the current value
 * rather than one captured earlier.
 *
 * A React handler rebuilt each render closes over that render's state, and a
 * caller that opens and then closes within a single render — JoinScreen, on a
 * failed join — would dispose the client from before the open and leave the
 * new one running. Every MatchClient writes into the one shared atom, so an
 * abandoned one is a live writer, not just garbage.
 */
export interface ClientSlot<T extends { dispose: () => void }> {
  readonly current: T | null
  put: (next: T) => T
  clear: () => void
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
  }
}
