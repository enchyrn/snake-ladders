import { lastTile, linkAt, tileAt } from "./board"
import type { TimelineEvent } from "./events"
import { nextRange, type RngState } from "./rng"
import * as Mines from "./rules/minesweeper"
import * as Momentum from "./rules/momentum"
import * as Mutation from "./rules/mutation"
import * as Simul from "./rules/simultaneous"
import type { Board, MatchState, Player } from "./types"

/**
 * One round of resolution, shared by every rule combination.
 *
 * The whole function is a pure fold over (state, rng) -> (state, rng, events).
 * Nothing here reads the clock, the DOM, or Math.random, which is the single
 * property that makes LAN lockstep viable: two devices that have applied the
 * same actions in the same order are byte-for-byte identical afterwards.
 */

interface Ctx {
  board: Board
  players: Player[]
  rng: RngState
  events: TimelineEvent[]
}

const seatOf = (players: ReadonlyArray<Player>, id: string): number =>
  players.findIndex((p) => p.id === id)

const isPlaying = (p: Player): boolean => p.finishedAtRound === null && p.connected

/** Draw this round's dice for one player, honouring a pending `double`. */
const rollFor = (ctx: Ctx, idx: number, config: MatchState["config"]): number => {
  const player = ctx.players[idx]!
  const dice: number[] = []
  const count = player.pending.includes("double") ? 2 : 1
  for (let i = 0; i < count; i++) {
    const [v, s] = nextRange(ctx.rng, 1, 6)
    ctx.rng = s
    dice.push(v)
  }
  const total = dice.reduce((a, b) => a + b, 0)
  const momentumBonus = Momentum.enabled(config) ? player.momentum : 0
  ctx.events.push({
    _tag: "Rolled",
    playerId: player.id,
    dice,
    total,
    momentumBonus,
  })
  return total + momentumBonus
}

/** Mine handling for a tile a player has just landed on. */
const applyTile = (ctx: Ctx, idx: number, config: MatchState["config"]): void => {
  if (!Mines.enabled(config)) return
  const player = ctx.players[idx]!
  if (player.position <= 0) return

  const [revealedBoard, opened] = Mines.stepOn(ctx.board, player.position)
  ctx.board = revealedBoard
  if (opened.length > 0) ctx.events.push({ _tag: "Revealed", tiles: opened })

  const tile = tileAt(ctx.board, player.position)
  if (!Mines.isLive(tile)) return

  ctx.board = Mines.detonate(ctx.board, player.position)

  if (player.anchored) {
    ctx.players[idx] = { ...player, anchored: false }
    ctx.events.push({
      _tag: "MineTripped",
      playerId: player.id,
      tile: player.position,
      to: player.position,
      absorbed: true,
    })
    return
  }

  const to = Mines.blastKnockback(config, player.position)
  ctx.events.push({
    _tag: "MineTripped",
    playerId: player.id,
    tile: player.position,
    to,
    absorbed: false,
  })
  ctx.events.push({ _tag: "Stunned", playerId: player.id, rounds: Mines.blastStun })
  ctx.players[idx] = { ...player, position: to, stunned: Mines.blastStun, momentum: 0 }
}

/** Snake/ladder handling, including reversal and ladder collapse. */
const applyLink = (ctx: Ctx, idx: number, config: MatchState["config"]): number => {
  const player = ctx.players[idx]!
  const link = linkAt(ctx.board, player.position)
  if (!link) return 0

  const reversed = player.pending.includes("reverse")
  const span = link.to - link.from
  // Reversal flips the direction of travel, not the identity of the link:
  // a snake becomes a climb of the same length, a ladder becomes a drop.
  const effectiveDelta = reversed ? -span : span
  const actsAsSnake = effectiveDelta < 0

  if (actsAsSnake && player.anchored) {
    ctx.players[idx] = { ...player, anchored: false }
    return 0
  }

  const landing = Momentum.advance(config, player.position, effectiveDelta)
  const to = landing.tile

  ctx.events.push({
    _tag: "TookLink",
    playerId: player.id,
    kind: link.kind,
    from: player.position,
    to,
    reversed,
  })

  let venom = 0
  if (actsAsSnake) {
    venom = Mutation.venomForBite(config, effectiveDelta)
    if (venom > 0) ctx.events.push({ _tag: "VenomGained", playerId: player.id, amount: venom })
  }

  ctx.players[idx] = { ...player, position: to, venom: player.venom + venom }

  // Wear the ladder down. A collapsed ladder inverts into a snake in place.
  if (Mutation.enabled(config) && link.kind === "ladder" && !reversed) {
    const used = { ...link, uses: link.uses + 1 }
    const next = Mutation.isSpent(used) ? Mutation.collapse(used) : used
    ctx.board = {
      ...ctx.board,
      links: ctx.board.links.map((l) => (l.id === link.id ? next : l)),
    }
    if (Mutation.isSpent(used)) {
      ctx.events.push({
        _tag: "LinkCollapsed",
        linkId: link.id,
        from: next.from,
        to: next.to,
      })
    }
  }

  return Momentum.gainFromLink(config, effectiveDelta)
}

/** Simultaneous-mode collisions: the arriving token displaces the sitting one. */
const applyCollisions = (ctx: Ctx, idx: number, config: MatchState["config"]): void => {
  if (!Simul.enabled(config)) return
  const mover = ctx.players[idx]!
  if (mover.position <= 0) return

  for (let i = 0; i < ctx.players.length; i++) {
    if (i === idx) continue
    const other = ctx.players[i]!
    if (other.position !== mover.position || other.finishedAtRound !== null) continue
    const to = Simul.knockbackTile(ctx.board, other.position)
    ctx.events.push({
      _tag: "Knocked",
      playerId: other.id,
      byPlayerId: mover.id,
      from: other.position,
      to,
    })
    ctx.players[i] = { ...other, position: to, momentum: 0 }
  }
}

const applyFinish = (ctx: Ctx, idx: number, state: MatchState, placed: string[]): void => {
  const player = ctx.players[idx]!
  const top = lastTile(state.config.size)
  if (player.position < top || player.finishedAtRound !== null) return
  placed.push(player.id)
  ctx.players[idx] = { ...player, finishedAtRound: state.round }
  ctx.events.push({
    _tag: "Finished",
    playerId: player.id,
    place: state.winners.length + placed.length,
  })
}

/** Move a single player end-to-end: roll, travel, tile, link, collisions. */
const moveOne = (ctx: Ctx, idx: number, steps: number, state: MatchState, placed: string[]): void => {
  const config = state.config
  const before = ctx.players[idx]!
  const carried = before.momentum
  const landing = Momentum.advance(config, before.position, steps)

  ctx.events.push({
    _tag: "Moved",
    playerId: before.id,
    from: before.position,
    to: landing.tile,
    bounced: landing.bounced,
  })
  ctx.players[idx] = { ...before, position: landing.tile }

  applyTile(ctx, idx, config)
  // A blast throws the token off the tile it landed on, so whatever link sat
  // under that tile no longer applies.
  const blasted = ctx.players[idx]!.position !== landing.tile
  let gained = blasted ? 0 : applyLink(ctx, idx, config)

  if (!blasted) {
    const afterLink = ctx.players[idx]!.position
    applyTile(ctx, idx, config)
    // A mine at the far end of a snake or ladder cancels the momentum gain.
    if (ctx.players[idx]!.position !== afterLink) gained = 0
  }

  applyCollisions(ctx, idx, config)

  const after = ctx.players[idx]!
  ctx.players[idx] = {
    ...after,
    // Speed just spent bleeds off by half; a fresh link overrides it outright.
    // A blast is the exception: it throws the token off the board's line
    // entirely, so there is no speed left to carry.
    momentum: Momentum.enabled(config) && !blasted ? Momentum.decay(carried, gained) : 0,
  }
  applyFinish(ctx, idx, state, placed)
}

/**
 * Resolve every committed roll for the current round and hand back the next
 * state. Callers guarantee that the phase is `committing` and that the
 * required commitments are present.
 */
export const resolveRound = (state: MatchState): MatchState => {
  const ctx: Ctx = {
    board: state.board,
    players: state.players.slice(),
    rng: state.rng,
    events: [],
  }
  const config = state.config

  const participants = ctx.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => isPlaying(p) && p.stunned === 0 && state.commitments[p.id] !== undefined)

  // Draw dice first, in seat order, so the RNG stream does not depend on the
  // order commitments happened to arrive over the network.
  const rolls = participants.map(({ i }) => ({ i, total: rollFor(ctx, i, config) }))

  const ordered = Simul.enabled(config)
    ? Simul.resolutionOrder(rolls.map(({ i, total }) => ({ player: ctx.players[i]!, total }))).map(
        (c) => ({ i: seatOf(ctx.players, c.player.id), total: c.total }),
      )
    : rolls

  // Captured before resolution: only players who sat this round out get their
  // stun ticked down, so a mine tripped *this* round still costs a full round.
  const satOut = new Set(state.players.filter((p) => p.stunned > 0).map((p) => p.id))

  const placed: string[] = []
  for (const { i, total } of ordered) moveOne(ctx, i, total, state, placed)

  // End-of-round bookkeeping: stun ticks down, cards expire, anchors persist.
  ctx.players = ctx.players.map((p) => ({
    ...p,
    stunned: satOut.has(p.id) ? Math.max(0, p.stunned - 1) : p.stunned,
    pending: [],
  }))

  let rng = ctx.rng
  let board = ctx.board
  const round = state.round + 1

  if (Mutation.shouldBreathe(config, round)) {
    const occupied = new Set(ctx.players.map((p) => p.position))
    const [breathed, moved, nextRng] = Mutation.breathe(board, config, occupied, rng)
    board = breathed
    rng = nextRng
    if (moved.length > 0) ctx.events.push({ _tag: "BoardBreathed", movedLinkIds: moved })
  }

  const winners = [...state.winners, ...placed]
  const stillRunning = ctx.players.filter((p) => isPlaying(p) && p.finishedAtRound === null)
  const finished = winners.length > 0 || stillRunning.length === 0

  const nextSeat = Simul.enabled(config)
    ? state.activeSeat
    : nextActiveSeat(ctx.players, state.activeSeat)

  return {
    ...state,
    board,
    players: ctx.players,
    rng,
    round,
    phase: finished ? "finished" : "committing",
    activeSeat: nextSeat,
    commitments: {},
    timeline: ctx.events,
    winners,
  }
}

/** Sequential mode: hand the turn to the next seat that can actually move. */
export const nextActiveSeat = (players: ReadonlyArray<Player>, from: number): number => {
  if (players.length === 0) return 0
  for (let step = 1; step <= players.length; step++) {
    const seat = (from + step) % players.length
    const p = players[seat]
    if (p && isPlaying(p)) return seat
  }
  return from
}
