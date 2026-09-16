import { Context, Data, Effect } from "effect"
import type { Action } from "@mutation/engine/actions"

/** One action, numbered by the host. Peers fold these in `seq` order. */
export interface Committed {
  readonly seq: number
  readonly action: unknown
}

export interface RoomView {
  readonly room: string
  readonly host: string
  readonly addr: string
  readonly players: number
  readonly capacity: number
  readonly locked: boolean
  readonly seed: number
}

export interface HostedRoom {
  readonly room: string
  readonly port: number
  readonly seed: number
  /** The LAN address a browser can load the page from, if the host has one. */
  readonly address: string | null
}

export interface RosterEntry {
  readonly player_id: string
  readonly name: string
  readonly connected: boolean
}

export interface ConnectionStatus {
  readonly connected: boolean
  readonly reason: string | null
}

export interface Identity {
  readonly player_id: string
  readonly name: string
}

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: string
}> {}

/**
 * What to show when an effect fails with something that is not a
 * `TransportError`.
 *
 * Reaching for `String(cause)` on a rejected `Effect.runPromise` renders
 * Effect's own FiberFailure dump, which in a production bundle is a minified
 * stack trace with a bundle offset — a player once saw exactly that in a
 * banner. A `TransportError` carries a `reason` written to be read, so take
 * that wherever there is one and fall back to this only for a real defect.
 */
export const unexpected = "Something went wrong. Try again, or restart the app."

export type Unsubscribe = () => void

/**
 * Everything the game needs from the network, with the LAN implementation and
 * the single-device one behind the same interface. The UI is written against
 * this, so pass-and-play is not a special case anywhere above this line.
 */
export interface TransportService {
  /** Open a room on this device and advertise it on the local network. */
  readonly host: (opts: {
    seed: number
    name: string
    capacity: number
  }) => Effect.Effect<HostedRoom, TransportError>
  /** Start listening for rooms. */
  readonly browse: Effect.Effect<void, TransportError>
  /** Rooms visible right now. */
  readonly rooms: Effect.Effect<ReadonlyArray<RoomView>, TransportError>
  readonly join: (
    addr: string,
    identity: Identity,
  ) => Effect.Effect<void, TransportError>
  /** Stop accepting joins. */
  readonly lock: Effect.Effect<void, TransportError>
  /** Hand an action over for sequencing; it returns via `onCommit`. */
  readonly submit: (action: Action) => Effect.Effect<void, TransportError>
  readonly leave: Effect.Effect<void, TransportError>

  readonly onCommit: (f: (entry: Committed) => void) => Unsubscribe
  readonly onRoster: (f: (roster: ReadonlyArray<RosterEntry>) => void) => Unsubscribe
  readonly onStatus: (f: (status: ConnectionStatus) => void) => Unsubscribe
}

export class Transport extends Context.Tag("Transport")<Transport, TransportService>() {}

/** Minimal typed event bus shared by both transport implementations. */
export const emitter = <A>() => {
  const listeners = new Set<(value: A) => void>()
  return {
    emit: (value: A): void => {
      // Copy first: a listener may unsubscribe while being notified.
      for (const listener of [...listeners]) listener(value)
    },
    subscribe: (f: (value: A) => void): Unsubscribe => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    clear: (): void => listeners.clear(),
  }
}
