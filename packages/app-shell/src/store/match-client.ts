import { Registry } from "@effect-atom/atom"
import { Effect, Either } from "effect"
import { decodeAction, type Action } from "@mutation/engine/actions"
import { applyAction, initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchConfig } from "@mutation/engine/types"
import {
  unexpected,
  type Committed,
  type HostedRoom,
  type RosterEntry,
  type TransportService,
  type Unsubscribe,
} from "@mutation/net/transport"
import { actingSeatFor, clientStateAtom, emptyState, type ClientState, type Role } from "./atoms"

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
  /** Players for whom we have already submitted Leave. */
  private readonly retired = new Set<string>()
  /** Roster departures that arrived before their Join commit folded. */
  private readonly pendingDepartures = new Set<string>()

  constructor(
    transport: TransportService,
    config: MatchConfig,
    role: Role,
    me: string,
    registry: Registry.Registry = Registry.make(),
    seats: ReadonlyArray<string> = [me],
  ) {
    this.transport = transport
    this.registry = registry
    const initial = emptyState(config, role, me)
    this.registry.set(clientStateAtom, {
      ...initial,
      seats,
      actingSeat: actingSeatFor(initial.match, seats),
    })
    this.subscriptions.push(
      transport.onCommit((entry) => this.receive(entry)),
      transport.onRoster((roster) => {
        this.patch((s) => ({ ...s, roster }))
        for (const entry of roster) {
          if (!entry.connected) this.pendingDepartures.add(entry.player_id)
        }
        this.retireDeparted(roster)
      }),
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
    this.retired.clear()
    this.pendingDepartures.clear()
    const s = this.state
    this.registry.set(clientStateAtom, {
      ...emptyState(config, role, s.me),
      room: s.room,
      roster: s.roster,
      connection: s.connection,
      seats: s.seats,
      actingSeat: actingSeatFor(initialMatch(config), s.seats),
    })
  }

  setRoom(room: HostedRoom): void {
    this.patch((s) => ({ ...s, room }))
  }

  setSeats(seats: ReadonlyArray<string>): void {
    this.patch((s) => ({ ...s, seats, actingSeat: actingSeatFor(s.match, seats) }))
  }

  /**
   * Under `simultaneous` several owned seats can act at once and `actingSeatFor`
   * only ever picks the first, so the device needs a way to say which of its own
   * players is holding it. A seat it does not own is refused rather than
   * silently accepted: acting as someone else's player is rejected by every
   * device that folds the log, including this one.
   */
  setActingSeat(seat: string): void {
    if (!this.state.seats.includes(seat)) return
    this.patch((s) => ({ ...s, actingSeat: seat }))
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

  /**
   * Stop admitting newcomers. The reducer refuses a Join once the match has
   * started anyway; locking is what keeps the room off the Join screen so
   * nobody connects, is welcomed, and only then turned away.
   *
   * Host-only: a peer has no room to close, and the relay only honours a
   * lock request from whichever socket it recorded as the host.
   */
  lock(): void {
    if (this.state.role !== "host") return
    Effect.runPromise(Effect.either(this.transport.lock))
      .then((done) => {
        if (Either.isLeft(done)) {
          this.patch((s) => ({ ...s, notice: `could not close the room: ${done.left.reason}` }))
        }
      })
      .catch(() => {
        this.patch((s) => ({ ...s, notice: `could not close the room: ${unexpected}` }))
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

  /**
   * A seated player who never commits stalls the whole round under the
   * `simultaneous` module, so a disconnect has to reach the reducer. It goes
   * through the log like any other action — a locally applied Leave would
   * diverge every device that had not seen the same roster frame.
   *
   * The host submits it alone: it is the device that sequences, and one
   * departure should appear in the log once however many peers are watching.
   */
  private retireDeparted(roster: ReadonlyArray<RosterEntry>): void {
    if (this.state.role !== "host") return
    for (const entry of roster) {
      if (entry.connected) {
        // A reconnect undoes Leave via Join, so this id must become
        // retirable again — otherwise a rejoin-then-drop never sends a
        // second Leave and the round stalls forever.
        this.retired.delete(entry.player_id)
        this.pendingDepartures.delete(entry.player_id)
        continue
      }
      this.pendingDepartures.add(entry.player_id)
    }
    for (const playerId of this.pendingDepartures) {
      if (playerId === this.state.me) continue
      if (this.retired.has(playerId)) continue
      const seated = this.state.match.players.some((p) => p.id === playerId)
      if (!seated) continue
      this.retired.add(playerId)
      const action = { _tag: "Leave" as const, playerId }
      Effect.runPromise(Effect.either(this.transport.submit(action))).then((result) => {
        if (Either.isLeft(result)) {
          this.retired.delete(playerId)
          this.pendingDepartures.add(playerId)
          this.patch((s) => ({ ...s, notice: `could not send: ${result.left.reason}` }))
        }
      })
    }
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

      state = {
        ...state,
        match: result.right,
        actingSeat: actingSeatFor(result.right, state.seats),
        applied: state.applied + 1,
        notice: null,
      }
      changed = true
    }

    if (changed) this.registry.set(clientStateAtom, state)
    this.retireDeparted(this.state.roster)
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
