import { Atom } from "@effect-atom/atom"
import { canCommit, initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchConfig, type MatchState, type Phase, type Player } from "@mutation/engine/types"
import type { ConnectionStatus, HostedRoom, RosterEntry } from "@mutation/net/transport"

export type Role = "host" | "peer" | "local"

export interface ClientState {
  readonly match: MatchState
  readonly role: Role
  readonly me: string
  readonly room: HostedRoom | null
  readonly roster: ReadonlyArray<RosterEntry>
  readonly connection: ConnectionStatus
  /** Set when a committed action was refused locally — i.e. a real desync. */
  readonly desync: string | null
  /** Last locally-rejected action, shown to the player as a nudge. */
  readonly notice: string | null
  readonly applied: number
}

export const emptyState = (config: MatchConfig, role: Role, me: string): ClientState => ({
  match: initialMatch(config),
  role,
  me,
  room: null,
  roster: [],
  connection: { connected: role === "local", reason: null },
  desync: null,
  notice: null,
  applied: 0,
})

/**
 * The one writable cell every MatchClient reads and writes through. It has to
 * outlive React: a commit can land (and must fold) before any component has
 * subscribed to it — e.g. between `session.open` and the lobby screen's first
 * render — and effect-atom drops an atom's stored value once nothing is
 * subscribed, unless it is marked `keepAlive`. Losing that gap would silently
 * replay the match from its initial state instead of the one actually folded.
 */
export const clientStateAtom = Atom.keepAlive(
  Atom.make(emptyState(defaultConfig(0), "local", "")),
)

const select = <T>(f: (state: ClientState) => T) => Atom.map(clientStateAtom, f)

/* ------------------------------------------------------------------ *
 * Derived atoms — each lets a component subscribe to the one slice it
 * actually renders from, instead of re-rendering on every fold.
 * ------------------------------------------------------------------ */

export const matchAtom = select((s) => s.match)
export const playersAtom = select((s): ReadonlyArray<Player> => s.match.players)
export const phaseAtom = select((s): Phase => s.match.phase)
export const noticeAtom = select((s) => s.notice)
export const desyncAtom = select((s) => s.desync)
export const connectionAtom = select((s) => s.connection)
export const rosterAtom = select((s) => s.roster)
export const roleAtom = select((s) => s.role)
export const meAtom = select((s) => s.me)
export const roomAtom = select((s) => s.room)

/** Whether it is this device's turn to roll — narrow enough that the Roll
 *  button re-renders on its own, not whenever anything else about the round
 *  changes (a card played, a chat-free nudge, the roster blinking). */
export const canRollAtom = select((s) => canCommit(s.match, s.me))
