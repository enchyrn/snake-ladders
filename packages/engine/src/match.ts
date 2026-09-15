import { Effect } from "effect"
import { RuleError, type Action } from "./actions"
import { generateBoard, lastTile, tileAt } from "./board"
import { seedRng } from "./rng"
import * as Mines from "./rules/minesweeper"
import * as Mutation from "./rules/mutation"
import * as Simul from "./rules/simultaneous"
import { nextActiveSeat, resolveRound } from "./resolve"
import { cardCost, type CardKind, type MatchConfig, type MatchState, type Player } from "./types"

/**
 * The reducer. `applyAction` is the only way match state ever changes, and it
 * is pure — the LAN host sequences actions, every peer folds the same sequence,
 * and nobody ships a board or a token position over the wire.
 */

export const initialMatch = (config: MatchConfig): MatchState => {
  const [board, rng] = generateBoard(config, seedRng(config.seed))
  return {
    config,
    board,
    players: [],
    round: 0,
    phase: "lobby",
    activeSeat: 0,
    commitments: {},
    rng,
    timeline: [],
    timelineRound: 0,
    winners: [],
  }
}

export const newPlayer = (id: string, name: string, seat: number): Player => ({
  id,
  name,
  seat,
  position: 0,
  venom: 0,
  momentum: 0,
  pending: [],
  anchored: false,
  stunned: 0,
  finishedAtRound: null,
  connected: true,
})

const fail = (reason: string, action?: Action["_tag"]) =>
  Effect.fail(new RuleError({ reason, action }))

const findPlayer = (state: MatchState, id: string) => {
  const index = state.players.findIndex((p) => p.id === id)
  return index < 0 ? null : ({ index, player: state.players[index]! } as const)
}

/* ---------------------------------------------------------------- *
 * Who still owes a roll this round
 * ---------------------------------------------------------------- */

export const pendingCommitters = (state: MatchState): Player[] => {
  const eligible = state.players.filter(
    (p) => p.connected && p.finishedAtRound === null && p.stunned === 0,
  )
  if (Simul.enabled(state.config)) {
    return eligible.filter((p) => state.commitments[p.id] === undefined)
  }
  const active = state.players[state.activeSeat]
  if (!active || !eligible.some((p) => p.id === active.id)) return []
  return state.commitments[active.id] === undefined ? [active] : []
}

export const canCommit = (state: MatchState, playerId: string): boolean =>
  state.phase === "committing" && pendingCommitters(state).some((p) => p.id === playerId)

/**
 * Resolve, then keep resolving while nobody is able to act — otherwise a round
 * in which every player is stunned would deadlock the match.
 */
const settle = (state: MatchState): MatchState => {
  let cur = resolveRound(state)
  let guard = 0
  while (
    cur.phase === "committing" &&
    pendingCommitters(cur).length === 0 &&
    guard++ < cur.players.length + 1
  ) {
    cur = resolveRound(cur)
  }
  return cur
}

/* ---------------------------------------------------------------- *
 * Cards
 * ---------------------------------------------------------------- */

const playCard = (
  state: MatchState,
  index: number,
  card: CardKind,
  targetTile: number | undefined,
): Effect.Effect<MatchState, RuleError> => {
  const player = state.players[index]!
  const cost = cardCost[card]
  if (!Mutation.enabled(state.config)) return fail("cards need the mutation module", "PlayCard")
  if (player.venom < cost) return fail(`${card} costs ${cost} venom`, "PlayCard")
  if (player.pending.includes(card)) return fail(`${card} already played this round`, "PlayCard")

  const players = state.players.slice()
  let board = state.board
  // A card played after the round's timeline was last written starts a fresh
  // one; otherwise BoardCanvas's array-identity replay would re-animate the
  // round that just finished.
  const fresh = state.timelineRound !== state.round
  const timeline = fresh
    ? [{ _tag: "CardPlayed" as const, playerId: player.id, card, cost }]
    : [...state.timeline, { _tag: "CardPlayed" as const, playerId: player.id, card, cost }]
  let spent = cost
  let pending = [...player.pending]
  let anchored = player.anchored
  let position = player.position

  switch (card) {
    case "anchor":
      anchored = true
      break

    case "reverse":
    case "double":
      // Consumed by the resolver at the end of the round.
      pending = [...pending, card]
      break

    case "swap": {
      const leader = players
        .filter((p) => p.id !== player.id && p.finishedAtRound === null)
        .sort((a, b) => b.position - a.position)[0]
      if (!leader) return fail("nobody to swap with", "PlayCard")
      if (leader.position <= player.position) return fail("you are already ahead", "PlayCard")
      const leaderIndex = players.findIndex((p) => p.id === leader.id)
      players[leaderIndex] = { ...leader, position: player.position, momentum: 0 }
      position = leader.position
      timeline.push({ _tag: "Swapped" as const, playerId: player.id, withPlayerId: leader.id })
      break
    }

    case "defuse": {
      if (!Mines.enabled(state.config)) return fail("no minefield in this match", "PlayCard")
      if (targetTile === undefined) return fail("defuse needs a target tile", "PlayCard")
      if (!Mines.canDefuse(board, player.position, targetTile)) {
        return fail(`tile ${targetTile} is out of reach`, "PlayCard")
      }
      const [next, wasMined] = Mines.defuse(board, targetTile)
      board = next
      timeline.push({ _tag: "MineDefused" as const, playerId: player.id, tile: targetTile })
      // A correct read refunds part of the cost; a wasted guess does not.
      if (wasMined) spent -= 1
      break
    }
  }

  players[index] = {
    ...players[index]!,
    venom: player.venom - spent,
    pending,
    anchored,
    position,
  }
  return Effect.succeed({ ...state, players, board, timeline, timelineRound: state.round })
}

/* ---------------------------------------------------------------- *
 * Reducer
 * ---------------------------------------------------------------- */

export const applyAction = (
  state: MatchState,
  action: Action,
): Effect.Effect<MatchState, RuleError> => {
  switch (action._tag) {
    case "Join": {
      if (state.phase !== "lobby") return fail("match already started", "Join")
      if (findPlayer(state, action.playerId)) {
        // Reconnect rather than duplicate: LAN peers drop and come back.
        const { index, player } = findPlayer(state, action.playerId)!
        const players = state.players.slice()
        players[index] = { ...player, connected: true, name: action.name }
        return Effect.succeed({ ...state, players })
      }
      if (state.players.length >= 6) return fail("match is full", "Join")
      return Effect.succeed({
        ...state,
        players: [...state.players, newPlayer(action.playerId, action.name, state.players.length)],
      })
    }

    case "Leave": {
      const found = findPlayer(state, action.playerId)
      if (!found) return fail("unknown player", "Leave")
      const players = state.players.slice()
      players[found.index] = { ...found.player, connected: false }
      // Never renumber seats: seat order is the deterministic tiebreaker.
      const next: MatchState = { ...state, players }
      return Effect.succeed(
        state.phase === "committing" && pendingCommitters(next).length === 0 && next.round > 0
          ? settle(next)
          : next,
      )
    }

    case "Configure": {
      if (state.phase !== "lobby") return fail("cannot reconfigure a running match", "Configure")
      const rebuilt = initialMatch(action.config)
      return Effect.succeed({ ...rebuilt, players: state.players })
    }

    case "Start": {
      if (state.phase !== "lobby") return fail("match already started", "Start")
      if (state.players.length < 1) return fail("need at least one player", "Start")
      return Effect.succeed({
        ...state,
        phase: "committing",
        round: 1,
        activeSeat: 0,
        timeline: [],
      })
    }

    case "Flag": {
      if (!Mines.enabled(state.config)) return fail("no minefield in this match", "Flag")
      const t = action.tile
      if (t <= 0 || t > lastTile(state.config.size)) return fail("tile out of range", "Flag")
      const current = tileAt(state.board, t)
      if (current.revealed) return fail("tile already revealed", "Flag")
      return Effect.succeed({
        ...state,
        board: Mines.setFlag(state.board, t, !current.flagged),
      })
    }

    case "PlayCard": {
      if (state.phase !== "committing") return fail("cards are played before rolling", "PlayCard")
      const found = findPlayer(state, action.playerId)
      if (!found) return fail("unknown player", "PlayCard")
      if (found.player.finishedAtRound !== null) return fail("you have already finished", "PlayCard")
      if (found.player.stunned > 0) return fail("you are sitting this round out", "PlayCard")
      if (!Simul.enabled(state.config) && state.players[state.activeSeat]?.id !== action.playerId) {
        return fail("wait for your turn", "PlayCard")
      }
      if (state.commitments[action.playerId] !== undefined) {
        return fail("you already rolled this round", "PlayCard")
      }
      return playCard(state, found.index, action.card, action.targetTile)
    }

    case "Commit": {
      if (state.phase !== "committing") return fail("not accepting rolls", "Commit")
      if (!canCommit(state, action.playerId)) return fail("not your roll", "Commit")
      const staged: MatchState = {
        ...state,
        commitments: { ...state.commitments, [action.playerId]: 1 },
      }
      // The last commitment of the round triggers resolution.
      return Effect.succeed(pendingCommitters(staged).length === 0 ? settle(staged) : staged)
    }
  }
}

/** Fold a whole action log. Used for replay, late joiners, and desync repair. */
export const replay = (
  config: MatchConfig,
  actions: ReadonlyArray<Action>,
): Effect.Effect<MatchState, RuleError> =>
  Effect.reduce(actions, initialMatch(config), (state, action) => applyAction(state, action))

export { nextActiveSeat }
