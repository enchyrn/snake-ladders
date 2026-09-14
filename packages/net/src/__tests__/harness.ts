import { Effect } from "effect"
// @ts-expect-error -- plain .mjs with no type declarations
import { startRelay } from "@mutation/relay"
import { makeWebSocketTransport } from "../websocket"
import type { Committed, ConnectionStatus, TransportService } from "../transport"

/**
 * A live relay plus joined transports, for tests that need the real socket
 * rather than a fake.
 *
 * Not a `.test.ts`, so vitest collects the files that import it and not this.
 * It lives in `net` because that is where the transport is, and `app-shell`
 * may depend on `net` — the reverse is the cycle the layer tags forbid.
 *
 * Every caller passes its own `basePort`: vitest runs test files in separate
 * workers, so two files sharing one counter would race for the same port.
 */
export const makeRelayHarness = (basePort: number) => {
  const servers: Array<{ wss: { close: (cb?: () => void) => void } }> = []
  const transports: TransportService[] = []
  let nextPort = basePort

  const relay = (opts: Record<string, unknown> = {}) => {
    const started = startRelay({ port: nextPort++, room: "TEST", ...opts })
    servers.push(started)
    return started as { port: number; sequencer: { lock: () => void } }
  }

  const until = async (predicate: () => boolean, ms = 4000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((r) => setTimeout(r, 15))
    }
    throw new Error("condition never became true")
  }

  const joined = async (port: number, id: string) => {
    const transport = makeWebSocketTransport()
    transports.push(transport)
    const commits: Committed[] = []
    const statuses: ConnectionStatus[] = []
    transport.onCommit((c) => commits.push(c))
    transport.onStatus((s) => statuses.push(s))
    await Effect.runPromise(transport.join(`127.0.0.1:${port}`, { player_id: id, name: id }))
    await until(() => statuses.some((s) => s.connected))
    return { transport, commits, statuses }
  }

  /** Register a transport a test built itself, so teardown still closes it. */
  const track = <T extends TransportService>(transport: T): T => {
    transports.push(transport)
    return transport
  }

  const teardown = async () => {
    for (const t of transports.splice(0)) await Effect.runPromise(t.leave)
    await Promise.all(
      servers.splice(0).map((s) => new Promise<void>((r) => s.wss.close(() => r()))),
    )
  }

  return { relay, joined, until, track, teardown }
}
