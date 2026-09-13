import { Effect, Layer } from "effect"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { Action } from "@/engine/actions"
import { encodeAction } from "@/engine/actions"
import {
  emitter,
  Transport,
  TransportError,
  type Committed,
  type ConnectionStatus,
  type HostedRoom,
  type Identity,
  type RoomView,
  type RosterEntry,
  type TransportService,
} from "./transport"

/** True inside the Tauri webview, false in a plain browser tab. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

const call = <A>(command: string, args?: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () => invoke<A>(command, args),
    catch: (cause) => new TransportError({ reason: String(cause) }),
  })

/**
 * LAN transport over the Rust side. Every method is a thin `invoke`; the
 * interesting work — sequencing, discovery, catch-up — happens in the
 * `lan-sync` crate, where it is covered by tests that run without a webview.
 */
export const makeLanTransport = (): TransportService => {
  const commits = emitter<Committed>()
  const rosters = emitter<ReadonlyArray<RosterEntry>>()
  const statuses = emitter<ConnectionStatus>()

  // Tauri's `listen` resolves to an unlisten function. Nothing here awaits it,
  // so the teardown is queued behind the same promise.
  const bridge = <A>(event: string, emit: (value: A) => void) => {
    const pending = listen<A>(event, (e) => emit(e.payload))
    return () => {
      void pending.then((unlisten) => unlisten())
    }
  }

  const detach = [
    bridge<Committed>("lan://commit", commits.emit),
    bridge<ReadonlyArray<RosterEntry>>("lan://roster", rosters.emit),
    bridge<ConnectionStatus>("lan://status", statuses.emit),
  ]

  return {
    host: ({ seed, name, capacity }) =>
      call<HostedRoom>("net_host", { seed, name, capacity }),
    browse: call<void>("net_browse"),
    rooms: call<ReadonlyArray<RoomView>>("net_rooms"),
    join: (addr: string, identity: Identity) =>
      call<void>("net_join", { addr, identity }),
    lock: call<void>("net_lock"),
    // The action is encoded through the schema on the way out, so a malformed
    // action is caught here rather than on somebody else's phone.
    submit: (action: Action) =>
      Effect.suspend(() => call<void>("net_submit", { action: encodeAction(action) })),
    leave: Effect.zipRight(
      call<void>("net_leave"),
      Effect.sync(() => {
        for (const off of detach) off()
      }),
    ),
    onCommit: commits.subscribe,
    onRoster: rosters.subscribe,
    onStatus: statuses.subscribe,
  }
}

export const LanTransportLive = Layer.sync(Transport, makeLanTransport)
