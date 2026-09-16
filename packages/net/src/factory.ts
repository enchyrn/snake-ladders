import { isTauri, makeLanTransport } from "./lan"
import { makeLocalTransport } from "./local"
import { makeWebSocketTransport } from "./websocket"
import type { TransportService } from "./transport"

/**
 * How a match reaches the other players.
 *
 * "local" is one device passed around; "network" is everyone else.
 */
export type TransportKind = "local" | "network"

/**
 * Pick a transport from what the player chose, and only then from what the
 * app is running inside.
 *
 * Getting that order the wrong way round is a real bug this had: choosing by
 * environment alone handed pass-and-play the LAN transport inside the
 * installed app, so every action was submitted to a room nobody had opened
 * and the first one failed. Pass-and-play must never depend on a room
 * existing, on any platform.
 */
export const makeTransport = (
  kind: TransportKind,
  native: boolean = isTauri(),
): TransportService => {
  if (kind === "local") return makeLocalTransport()
  // Only the installed app can open a listening socket. In a browser,
  // reaching other devices means connecting out to a relay someone runs.
  return native ? makeLanTransport() : makeWebSocketTransport()
}
