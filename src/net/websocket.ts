import { Effect, Layer } from "effect"
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

/**
 * Transport for a match relayed by `scripts/lan-relay.mjs`.
 *
 * This is what lets a browser join a LAN match at all: a web page cannot open
 * a listening socket or broadcast on UDP, so it cannot host, but it can
 * connect out to a relay someone runs on a laptop. The relay speaks the same
 * frames as the Rust host, so from here the two are indistinguishable — and
 * from the UI's point of view this is just a third implementation of an
 * interface it already used twice.
 */

/** Frames the relay sends. Mirrors `lan_sync::protocol::Downstream`. */
type Downstream =
  | { t: "welcome"; player_id: string; room: string; log: ReadonlyArray<Committed> }
  | ({ t: "commit" } & Committed)
  | { t: "roster"; peers: ReadonlyArray<RosterEntry> }
  | { t: "rejected"; reason: string }
  | { t: "pong" }

/** `host:port`, with `ws://` and a default port filled in if omitted. */
export const relayUrl = (address: string): string => {
  const trimmed = address.trim().replace(/^wss?:\/\//, "")
  if (trimmed === "") throw new TransportError({ reason: "no address given" })
  return `ws://${trimmed.includes(":") ? trimmed : `${trimmed}:4455`}`
}

export const makeWebSocketTransport = (): TransportService => {
  const commits = emitter<Committed>()
  const rosters = emitter<ReadonlyArray<RosterEntry>>()
  const statuses = emitter<ConnectionStatus>()

  let socket: WebSocket | null = null
  /** Set once the relay refuses us, so a close isn't reported twice. */
  let refused = false

  const close = () => {
    const current = socket
    socket = null
    if (!current) return
    // Drop the handlers first: closing otherwise fires onclose and reports a
    // disconnection the player caused deliberately.
    current.onopen = null
    current.onmessage = null
    current.onclose = null
    current.onerror = null
    current.close()
  }

  const connect = (address: string, identity: Identity) =>
    Effect.async<void, TransportError>((resume) => {
      close()
      refused = false

      let url: string
      try {
        url = relayUrl(address)
      } catch (cause) {
        resume(Effect.fail(cause as TransportError))
        return
      }

      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (cause) {
        resume(Effect.fail(new TransportError({ reason: String(cause) })))
        return
      }
      socket = ws

      // The open event only means the socket connected; the relay may still
      // refuse the handshake, which arrives as a `rejected` frame.
      ws.onopen = () => {
        ws.send(
          JSON.stringify({ t: "hello", player_id: identity.player_id, name: identity.name }),
        )
        resume(Effect.void)
      }

      ws.onerror = () => {
        resume(
          Effect.fail(
            new TransportError({
              reason: `could not reach ${url}. Is the relay running and on this network?`,
            }),
          ),
        )
      }

      ws.onmessage = (event) => {
        let frame: Downstream
        try {
          frame = JSON.parse(String(event.data)) as Downstream
        } catch {
          return // Junk on the wire is not worth dropping the match over.
        }
        switch (frame.t) {
          case "welcome":
            // Catch-up first, then report connected, so the UI never shows a
            // joined-but-empty match for one that is already in progress.
            for (const entry of frame.log) commits.emit(entry)
            statuses.emit({ connected: true, reason: null })
            break
          case "commit":
            commits.emit({ seq: frame.seq, action: frame.action })
            break
          case "roster":
            rosters.emit(frame.peers)
            break
          case "rejected":
            refused = true
            statuses.emit({ connected: false, reason: frame.reason })
            break
          case "pong":
            break
        }
      }

      ws.onclose = () => {
        if (socket !== ws) return // Superseded by a newer connection.
        socket = null
        if (refused) return
        statuses.emit({ connected: false, reason: "lost the relay" })
      }

      return Effect.sync(close)
    })

  const unsupported = (what: string) =>
    Effect.fail(
      new TransportError({
        reason: `a browser cannot ${what} — run the relay on a computer and join it`,
      }),
    )

  return {
    // Hosting means owning a listening socket, which a page cannot do. The
    // relay is the host; everyone, including whoever started it, joins.
    host: () => unsupported("host a match") as Effect.Effect<HostedRoom, TransportError>,
    browse: Effect.void,
    // Discovery needs UDP, so rooms are reached by the address the relay prints.
    rooms: Effect.succeed([] as ReadonlyArray<RoomView>),
    join: connect,
    lock: Effect.void,
    submit: (action: Action) =>
      Effect.suspend(() => {
        const current = socket
        if (!current || current.readyState !== WebSocket.OPEN) {
          return Effect.fail(new TransportError({ reason: "not connected to a relay" }))
        }
        // Encoded through the schema on the way out, so a malformed action is
        // caught here rather than on somebody else's phone.
        current.send(JSON.stringify({ t: "submit", action: encodeAction(action) }))
        return Effect.void
      }),
    leave: Effect.sync(() => {
      close()
      statuses.emit({ connected: false, reason: null })
    }),
    onCommit: commits.subscribe,
    onRoster: rosters.subscribe,
    onStatus: statuses.subscribe,
  }
}

export const WebSocketTransportLive = Layer.sync(Transport, makeWebSocketTransport)
