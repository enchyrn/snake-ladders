import { Store } from "@tanstack/store"
import { Effect, Either } from "effect"
import { decodeAction, type Action } from "@/engine/actions"
import { applyAction, initialMatch } from "@/engine/match"
import { defaultConfig, type MatchConfig, type MatchState } from "@/engine/types"
import type {
  Committed,
  ConnectionStatus,
  HostedRoom,
  RosterEntry,
  TransportService,
  Unsubscribe,
} from "@/net/transport"

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

const emptyState = (config: MatchConfig, role: Role, me: string): ClientState => ({
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
 * Holds the local copy of the match and folds the host's numbered log into it.
 *
 * Nothing here ever applies a local action optimistically. A player's own roll
 * takes the same round trip as everyone else's, because the moment one device
 * folds in a different order from another, the shared PRNG stream diverges and
 * the two phones are playing different games.
 */
export class MatchClient {
  readonly store: Store<ClientState>
  private readonly subscriptions: Unsubscribe[] = []
  /** Commits that arrived before the one we are waiting for. */
  private readonly buffer = new Map<number, unknown>()
  private nextSeq = 0

  constructor(
    private readonly transport: TransportService,
    config: MatchConfig,
    role: Role,
    me: string,
  ) {
    this.store = new Store<ClientState>(emptyState(config, role, me))
    this.subscriptions.push(
      transport.onCommit((entry) => this.receive(entry)),
      transport.onRoster((roster) => this.store.setState((s) => ({ ...s, roster }))),
      transport.onStatus((connection) => this.store.setState((s) => ({ ...s, connection }))),
    )
  }

  /** Rebuild for a new match. Used when the seed or the rule set changes. */
  reset(config: MatchConfig, role: Role = this.store.state.role): void {
    this.buffer.clear()
    this.nextSeq = 0
    this.store.setState((s) => ({
      ...emptyState(config, role, s.me),
      room: s.room,
      roster: s.roster,
      connection: s.connection,
    }))
  }

  setRoom(room: HostedRoom): void {
    this.store.setState((s) => ({ ...s, room }))
  }

  /**
   * Send an action. It is checked against the local match first so an obvious
   * mistake (rolling out of turn, a card you cannot afford) becomes a message
   * to this player instead of network traffic and a rejection everywhere else.
   */
  send(action: Action): void {
    const check = Effect.runSync(Effect.either(applyAction(this.store.state.match, action)))
    if (Either.isLeft(check)) {
      this.store.setState((s) => ({ ...s, notice: check.left.reason }))
      return
    }
    this.store.setState((s) => ({ ...s, notice: null }))
    Effect.runPromise(this.transport.submit(action)).catch((cause: unknown) => {
      this.store.setState((s) => ({ ...s, notice: `could not send: ${String(cause)}` }))
    })
  }

  dismissNotice(): void {
    this.store.setState((s) => ({ ...s, notice: null }))
  }

  dispose(): void {
    for (const off of this.subscriptions) off()
    this.subscriptions.length = 0
    this.buffer.clear()
  }

  /* -------------------------------------------------------------- *
   * Fold
   * -------------------------------------------------------------- */

  private receive(entry: Committed): void {
    if (entry.seq < this.nextSeq) return // already folded; a duplicate delivery
    this.buffer.set(entry.seq, entry.action)
    this.drain()
  }

  /** Apply buffered commits in strict sequence order, stopping at the first gap. */
  private drain(): void {
    let state = this.store.state
    let changed = false

    while (this.buffer.has(this.nextSeq)) {
      const raw = this.buffer.get(this.nextSeq)!
      this.buffer.delete(this.nextSeq)
      this.nextSeq += 1

      const decoded = decodeAction(raw)
      if (Either.isLeft(decoded)) {
        state = { ...state, desync: `undecodable action at #${this.nextSeq - 1}` }
        changed = true
        continue
      }

      const result = Effect.runSync(Effect.either(applyAction(state.match, decoded.right)))
      if (Either.isLeft(result)) {
        // The host accepted an action this device refuses: the two are no
        // longer folding the same game. Surface it rather than drifting on.
        state = {
          ...state,
          desync: `${decoded.right._tag} rejected at #${this.nextSeq - 1}: ${result.left.reason}`,
        }
        changed = true
        continue
      }

      state = { ...state, match: result.right, applied: state.applied + 1, notice: null }
      changed = true
    }

    if (changed) this.store.setState(() => state)
  }
}

export const newClient = (
  transport: TransportService,
  seed: number,
  role: Role,
  me: string,
  overrides: Partial<MatchConfig> = {},
): MatchClient =>
  new MatchClient(transport, { ...defaultConfig(seed), ...overrides }, role, me)
