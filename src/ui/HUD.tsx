import { cardBlurbs, cardCost, type CardKind, type MatchState, type Player } from "@/engine/types"
import { seatColour } from "@/render/palette"
import { lastTile } from "@/engine/board"

const CARDS: ReadonlyArray<CardKind> = ["anchor", "reverse", "double", "swap", "defuse"]

export const PlayerStrip = ({
  state,
  me,
}: {
  readonly state: MatchState
  readonly me: string
}) => (
  <ul className="players">
    {state.players.map((player) => (
      <li
        key={player.id}
        className={[
          "player",
          player.id === me ? "is-me" : "",
          player.finishedAtRound !== null ? "is-done" : "",
          player.connected ? "" : "is-away",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="pip" style={{ background: seatColour(player.seat) }} />
        <span className="player-name">{player.name}</span>
        <span className="player-stats">
          <span title="tile">{player.position}</span>
          {player.venom > 0 && <span className="venom" title="venom">☣{player.venom}</span>}
          {player.momentum > 0 && <span className="momentum" title="momentum">»{player.momentum}</span>}
          {player.anchored && <span title="anchored">⚓</span>}
          {player.stunned > 0 && <span title="sitting out">💤</span>}
        </span>
      </li>
    ))}
  </ul>
)

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

export const Progress = ({ state }: { readonly state: MatchState }) => {
  const top = lastTile(state.config.size)
  return (
    <div className="progress" aria-hidden>
      {state.players.map((player) => (
        <div
          key={player.id}
          className="progress-bar"
          style={{
            width: `${(player.position / top) * 100}%`,
            background: seatColour(player.seat),
          }}
        />
      ))}
    </div>
  )
}
