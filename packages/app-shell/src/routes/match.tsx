import { useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useSession } from "../app/session"
import type { CardKind } from "@mutation/engine/types"
import { actingSeatAtom, canRollAtom, matchAtom, ownedActableAtom, seatsAtom } from "../store/atoms"
import type { MatchClient } from "../store/match-client"
import { BoardCanvas } from "@mutation/ui/BoardCanvas"
import { DesyncBanner, NoticeBanner } from "../app/banners"
import { EventLog } from "@mutation/ui/EventLog"
import { CardRail, DiceTray, ProgressRows } from "@mutation/ui/HUD"

/** Isolated so the Roll button re-renders on its own — not on every card play,
 *  every tile reveal, or the roster twitching — since `canRollAtom` is the
 *  only slice it reads. */
const RollButton = ({ client, seat }: { readonly client: MatchClient; readonly seat: string }) => {
  const canRoll = useAtomValue(canRollAtom)
  return (
    <button
      type="button"
      className="primary roll"
      disabled={!canRoll}
      onClick={() => client.send({ _tag: "Commit", playerId: seat })}
    >
      Roll
    </button>
  )
}

export const MatchScreen = () => {
  const session = useSession()
  const navigate = useNavigate()
  const client = session.client
  const match = useAtomValue(matchAtom)
  const actingSeat = useAtomValue(actingSeatAtom)
  const seats = useAtomValue(seatsAtom)
  const ownedActable = useAtomValue(ownedActableAtom)
  const canRollNow = useAtomValue(canRollAtom)
  // Set by pressing the defuse card; the next tile tap targets it instead of
  // toggling a flag, so a card that needs a target does not need its own
  // separate picker UI.
  const [armedDefuse, setArmedDefuse] = useState(false)

  useEffect(() => {
    if (!client) void navigate({ to: "/" })
  }, [client, navigate])

  if (!client) return null

  const actingPlayer = match.players.find((p) => p.id === actingSeat)
  const nameOf = (id: string) => match.players.find((p) => p.id === id)?.name ?? id
  const hasMines = match.config.modules.includes("minesweeper")
  const winner = match.winners[0]

  const playCard = (card: CardKind) => {
    if (card === "defuse") {
      setArmedDefuse(true)
      return
    }
    client.send({ _tag: "PlayCard", playerId: actingSeat, card })
  }

  const pickTile = (tile: number) => {
    if (armedDefuse) {
      client.send({ _tag: "PlayCard", playerId: actingSeat, card: "defuse", targetTile: tile })
      setArmedDefuse(false)
      return
    }
    client.send({ _tag: "Flag", playerId: actingSeat, tile })
  }

  const backHome = () => {
    session.close()
    void navigate({ to: "/" })
  }

  return (
    <main className="screen match">
      <NoticeBanner />
      <DesyncBanner />
      {armedDefuse && (
        <p className="banner notice">Tap a tile within reach to disarm it.</p>
      )}

      <div className="board-wrap">
        <BoardCanvas state={match} onPickTile={hasMines ? pickTile : undefined} />
      </div>

      <ProgressRows state={match} actingSeat={actingSeat} />
      <EventLog state={match} />

      {match.phase === "finished" && (
        <div className="result-overlay">
          {/* `winners[0]` under `.length > 0` is always in range — noUncheckedIndexedAccess
           * still types it as possibly-undefined, so name it explicitly instead of asserting. */}
          <h2>{winner ? `${nameOf(winner)} wins!` : "Match over"}</h2>
          <ol className="standings">
            {match.winners.map((id, i) => (
              <li key={id}>
                {i + 1}. {nameOf(id)}
              </li>
            ))}
          </ol>
          <button type="button" className="primary" onClick={backHome}>
            Back to home
          </button>
        </div>
      )}

      {seats.length > 1 && actingPlayer && (
        <div className="seat-turn">
          <p className="hint">
            {canRollNow
              ? `${actingPlayer.name}'s turn — pass the device`
              : `Playing as ${actingPlayer.name}`}
          </p>
          {ownedActable.length > 1 && (
            <div className="seat-switch">
              {ownedActable.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  className={seat === actingSeat ? "is-acting" : ""}
                  onClick={() => client.setActingSeat(seat)}
                >
                  {nameOf(seat)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="control-bar">
        <CardRail me={actingPlayer} state={match} onPlay={playCard} disabled={match.phase !== "committing"} />
        <DiceTray
          onRoll={() => client.send({ _tag: "Commit", playerId: actingSeat })}
          disabled={!canRollNow}
        />
        <RollButton client={client} seat={actingSeat} />
      </div>
    </main>
  )
}
