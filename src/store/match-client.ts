import { Registry } from "@effect-atom/atom"
import { Effect, Either } from "effect"
import { decodeAction, type Action } from "@/engine/actions"
import { applyAction } from "@/engine/match"
import { defaultConfig, type MatchConfig } from "@/engine/types"
import {
  unexpected,
  type Committed,
  type HostedRoom,
  type TransportService,
  type Unsubscribe,
} from "@/net/transport"
import { clientStateAtom, emptyState, type ClientState, type Role } from "./atoms"

export type { ClientState, Role } from "./atoms"

/**
 * Folds the host's numbered action log into `clientStateAtom` and exposes the
 * one imperative escape hatch — `send` — that the UI needs on top of reading
 * atoms.
 *
 * Nothing here ever applies a local action optimistically. A player's own
 * roll takes the same round trip as everyone else's, because the moment one
 * device folds in a different order from another, the shared PRNG stream
 * diverges and the two phones are playing different games.
 *
 * A `Registry` is accepted rather than assumed so the app can hand this the
 * one registry every component reads through (via `RegistryContext`), while
 * a test — or a second, unrelated match — gets an isolated one for free by
 * simply not passing one: the atom identity is shared, but its stored value
 * lives per-registry.
 */
export class MatchClient {
  private readonly registry: Registry.Registry
  private readonly transport: TransportService
  private readonly subscriptions: Unsubscribe[] = []
  /** Commits that arrived before the one we are waiting for. */
  private readonly buffer = new Map<number, unknown>()
  private nextSeq = 0

  constructor(
    transport: TransportService,
    config: MatchConfig,
    role: Role,
    me: string,
    registry: Registry.Registry = Registry.make(),
  ) {
    this.transport = transport
    this.registry = registry
    this.registry.set(clientStateAtom, emptyState(config, role, me))
    this.subscriptions.push(
      transport.onCommit((entry) => this.receive(entry)),
      transport.onRoster((roster) => this.patch((s) => ({ ...s, roster }))),
      transport.onStatus((connection) => this.patch((s) => ({ ...s, connection }))),
    )
  }

  /** A synchronous snapshot, for callers that are not React components. */
  get state(): ClientState {
    return this.registry.get(clientStateAtom)
  }

  /** Rebuild for a new match. Used when the seed or the rule set changes. */
  reset(config: MatchConfig, role: Role = this.state.role): void {
    this.buffer.clear()
    this.nextSeq = 0
    const s = this.state
    this.registry.set(clientStateAtom, {
      ...emptyState(config, role, s.me),
      room: s.room,
      roster: s.roster,
      connection: s.connection,
    })
  }

  setRoom(room: HostedRoom): void {
    this.patch((s) => ({ ...s, room }))
  }

  /**
   * Send an action. It is checked against the local match first so an obvious
   * mistake (rolling out of turn, a card you cannot afford) becomes a message
   * to this player instead of network traffic and a rejection everywhere else.
   */
  send(action: Action): void {
    const check = Effect.runSync(Effect.either(applyAction(this.state.match, action)))
    if (Either.isLeft(check)) {
      this.patch((s) => ({ ...s, notice: check.left.reason }))
      return
    }
    this.patch((s) => ({ ...s, notice: null }))
    Effect.runPromise(Effect.either(this.transport.submit(action)))
      .then((sent) => {
        if (Either.isLeft(sent)) {
          this.patch((s) => ({ ...s, notice: `could not send: ${sent.left.reason}` }))
        }
      })
      .catch(() => {
        this.patch((s) => ({ ...s, notice: `could not send: ${unexpected}` }))
      })
  }

  dismissNotice(): void {
    this.patch((s) => ({ ...s, notice: null }))
  }

  dispose(): void {
    for (const off of this.subscriptions) off()
    this.subscriptions.length = 0
    this.buffer.clear()
  }

  private patch(f: (s: ClientState) => ClientState): void {
    this.registry.set(clientStateAtom, f(this.registry.get(clientStateAtom)))
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
    let state = this.state
    let changed = false

    while (this.buffer.has(this.nextSeq)) {
      // `has` just confirmed this key is present; nothing else touches `buffer`.
      const raw = this.buffer.get(this.nextSeq)!
      this.buffer.delete(this.nextSeq)
      this.nextSeq += 1

      const decoded = decodeAction(raw)
      if (Either.isLeft(decoded)) {
        // This one IS alarming: a frame this device cannot even parse means
        // the room is running mismatched builds, and from here the folds can
        // genuinely diverge.
        state = { ...state, desync: `undecodable action at #${this.nextSeq - 1}` }
        changed = true
        continue
      }

      const result = Effect.runSync(Effect.either(applyAction(state.match, decoded.right)))
      if (Either.isLeft(result)) {
        // NOT a desync. Every device folds this same log through this same
        // reducer, so every device rejects this action identically and they
        // all stay consistent. It happens legitimately when two players act
        // at once — someone joining as the host presses start, say, since the
        // relay orders by arrival and their sockets race. Report it as
        // information, not alarm.
        state = {
          ...state,
          notice: `${decoded.right._tag} could not be applied: ${result.left.reason}`,
        }
        changed = true
        continue
      }

      state = { ...state, match: result.right, applied: state.applied + 1, notice: null }
      changed = true
    }

    if (changed) this.registry.set(clientStateAtom, state)
  }
}

export const newClient = (
  transport: TransportService,
  seed: number,
  role: Role,
  me: string,
  overrides: Partial<MatchConfig> = {},
  registry?: Registry.Registry,
): MatchClient =>
  new MatchClient(transport, { ...defaultConfig(seed), ...overrides }, role, me, registry)
