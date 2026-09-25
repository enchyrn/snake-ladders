import { cardBlurbs, cardCost, type CardKind, type MatchState, type Player } from "@mutation/engine/types"
import { countColour, seatColour } from "@mutation/render/palette"
import { lastTile } from "@mutation/engine/board"
import { css } from "styled-system/css"
import { ChevronRight } from "lucide-react"
import { AnchorIcon, MomentumIcon, StunIcon, VenomIcon } from "./icons"

const CARDS: ReadonlyArray<CardKind> = ["anchor", "reverse", "double", "swap", "defuse"]

/**
 * One row per player: swatch, name, and a bar showing how far along the board
 * they are. This replaces both the tile numeral in the old PlayerStrip and the
 * 5%-wide stub the old Progress rendered — a player reads the race off the
 * bars' relative lengths (ADR 0020). The tile number stays on the board.
 */
export const ProgressRows = ({
  state,
  actingSeat,
}: {
  readonly state: MatchState
  readonly actingSeat: string
}) => {
  const top = lastTile(state.config.size)
  return (
    <ul
      className={css({
        listStyleType: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "9px",
      })}
    >
      {state.players.map((player) => {
        const isActing = player.id === actingSeat
        const isDone = player.finishedAtRound !== null
        const isAway = !player.connected
        return (
          <li
            key={player.id}
            data-acting={isActing}
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "9px",
              opacity: isAway ? 0.35 : 1,
              textDecoration: isAway ? "line-through" : "none",
            })}
          >
            {/* Reserves its width on every row so the acting row's marker
             * appearing doesn't nudge the swatch and bar sideways. Bold alone
             * would fail colour-blind and low-vision players the same way the
             * dropped colour-only cue would have (ADR 0020). */}
            <span
              className={css({
                width: "14px",
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              })}
            >
              {isActing && <ChevronRight size={14} aria-hidden="true" />}
            </span>
            <span
              className={css({ width: "14px", height: "14px", borderRadius: "50%", flex: "none" })}
              style={{ background: seatColour(player.seat) }}
            />
            <span
              className={css({
                fontSize: "sm",
                fontWeight: isActing ? 700 : 600,
                color: isDone ? "finish" : "text",
                width: "54px",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              })}
            >
              {player.name}
            </span>
            <span
              role="progressbar"
              aria-label={player.name}
              aria-valuenow={player.position}
              aria-valuemin={0}
              aria-valuemax={top}
              className={css({
                flexGrow: 1,
                height: "10px",
                borderRadius: "5px",
                background: "surface",
                overflow: "hidden",
              })}
            >
              <span
                className={css({ display: "block", height: "100%", borderRadius: "5px" })}
                style={{ width: `${(player.position / top) * 100}%`, background: seatColour(player.seat) }}
              />
            </span>
            {/* Module state a player has to weigh against a decision (a card's
             * venom cost, whether to risk a stunned turn) rather than colour
             * or animation alone — ADR 0020 keeps these as honest glyphs plus
             * digits, gated exactly as the old PlayerStrip gated them. */}
            <span
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flex: "none",
                fontSize: "xs",
                color: "textDim",
              })}
            >
              {player.venom > 0 && (
                <span
                  aria-label={`${player.venom} venom`}
                  className={css({ display: "flex", alignItems: "center", gap: "2px" })}
                >
                  <VenomIcon size={14} />
                  {player.venom}
                </span>
              )}
              {player.momentum > 0 && (
                <span
                  aria-label={`${player.momentum} momentum`}
                  className={css({ display: "flex", alignItems: "center", gap: "2px" })}
                >
                  <MomentumIcon size={14} />
                  {player.momentum}
                </span>
              )}
              {player.anchored && (
                <span aria-label="anchored" className={css({ display: "flex", alignItems: "center" })}>
                  <AnchorIcon size={14} />
                </span>
              )}
              {player.stunned > 0 && (
                <span aria-label="sitting out" className={css({ display: "flex", alignItems: "center" })}>
                  <StunIcon size={14} />
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export const CardRail = ({
  me,
  state,
  onPlay,
  disabled,
}: {
  readonly me: Player | undefined
  readonly state: MatchState
  readonly onPlay: (card: CardKind) => void
  readonly disabled: boolean
}) => {
  if (!me || !state.config.modules.includes("mutation")) return null
  const hasMines = state.config.modules.includes("minesweeper")

  return (
    <div className="cards">
      {CARDS.filter((card) => card !== "defuse" || hasMines).map((card) => {
        const cost = cardCost[card]
        const affordable = me.venom >= cost
        const alreadyPlayed = me.pending.includes(card)
        return (
          <button
            key={card}
            type="button"
            className="card"
            disabled={disabled || !affordable || alreadyPlayed}
            title={cardBlurbs[card]}
            onClick={() => onPlay(card)}
          >
            <span className="card-name">{card}</span>
            <span className="card-cost">☣{cost}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A one-line key to the minefield. Hidden tiles, revealed counts, flags and
 * spent mines are all drawn on the board itself; this names them, and tells a
 * first-time player the one thing the board cannot: tapping flags a tile.
 */
export const MineLegend = () => (
  <ul className="legend" aria-label="Minefield key">
    <li>
      <span className="legend-swatch is-hidden" />
      hidden
    </li>
    <li>
      <span className="legend-swatch is-revealed" style={{ color: countColour(2) }}>
        2
      </span>
      mines nearby
    </li>
    <li>
      <span className="legend-swatch is-flag">⚑</span>
      flag <span className="legend-hint">(tap a hidden tile)</span>
    </li>
    <li>
      <span className="legend-swatch is-mine">✸</span>
      spent mine
    </li>
  </ul>
)
