import { Effect, Layer } from "effect"
import type { Action } from "@mutation/engine/actions"
import {
  emitter,
  Transport,
  TransportError,
  type Committed,
  type ConnectionStatus,
  type HostedRoom,
  type RosterEntry,
  type RoomView,
  type TransportService,
} from "./transport"

/**
 * Single-device transport: the room is this phone, and the sequencer is a
 * counter. Pass-and-play and solo practice run through exactly the same fold
 * as a four-phone LAN match, which means the engine is exercised identically
 * whether or not a network is involved.
 */
export const makeLocalTransport = (): TransportService => {
  const commits = emitter<Committed>()
  const rosters = emitter<ReadonlyArray<RosterEntry>>()
  const statuses = emitter<ConnectionStatus>()
  let seq = 0

  return {
    host: ({ seed }) =>
      Effect.sync((): HostedRoom => {
        seq = 0
        statuses.emit({ connected: true, reason: null })
        return { room: "LOCAL", port: 0, seed }
      }),
    browse: Effect.void,
    rooms: Effect.succeed([] as ReadonlyArray<RoomView>),
    join: () =>
      Effect.fail(new TransportError({ reason: "this device is not on a network" })),
    lock: Effect.void,
    submit: (action: Action) =>
      Effect.sync(() => {
        // Asynchronous on purpose: the UI must not depend on a commit landing
        // synchronously, because over a real network it never does.
        const entry = { seq: seq++, action }
        queueMicrotask(() => commits.emit(entry))
      }),
    leave: Effect.sync(() => {
      statuses.emit({ connected: false, reason: null })
    }),
    onCommit: commits.subscribe,
    onRoster: rosters.subscribe,
    onStatus: statuses.subscribe,
  }
}

export const LocalTransportLive = Layer.sync(Transport, makeLocalTransport)
