import { useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useSession } from "@mutation/app-shell/app/session"
import type { CardKind } from "@mutation/engine/types"
import { canRollAtom, matchAtom, meAtom } from "@mutation/app-shell/store/atoms"
import type { MatchClient } from "@mutation/app-shell/store/match-client"
import { BoardCanvas } from "@mutation/ui/BoardCanvas"
import { DesyncBanner, NoticeBanner } from "@mutation/ui/Banners"
import { EventLog } from "@mutation/ui/EventLog"
import { CardRail, PlayerStrip, Progress } from "@mutation/ui/HUD"

/** Isolated so the Roll button re-renders on its own — not on every card play,
 *  every tile reveal, or the roster twitching — since `canRollAtom` is the
 *  only slice it reads. */
const RollButton = ({ client, me }: { readonly client: MatchClient; readonly me: string }) => {
  const canRoll = useAtomValue(canRollAtom)
  return (
    <button
      type="button"
      className="primary roll"
      disabled={!canRoll}
      onClick={() => client.send({ _tag: "Commit", playerId: me })}
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
  const me = useAtomValue(meAtom)
  // Set by pressing the defuse card; the next tile tap targets it instead of
  // toggling a flag, so a card that needs a target does not need its own
  // separate picker UI.
  const [armedDefuse, setArmedDefuse] = useState(false)

  useEffect(() => {
    if (!client) void navigate({ to: "/" })
  }, [client, navigate])

  if (!client) return null

  const mePlayer = match.players.find((p) => p.id === me)
  const nameOf = (id: string) => match.players.find((p) => p.id === id)?.name ?? id
  const hasMines = match.config.modules.includes("minesweeper")
  const winner = match.winners[0]

  const playCard = (card: CardKind) => {
    if (card === "defuse") {
      setArmedDefuse(true)
      return
    }
    client.send({ _tag: "PlayCard", playerId: me, card })
  }

  const pickTile = (tile: number) => {
    if (armedDefuse) {
      client.send({ _tag: "PlayCard", playerId: me, card: "defuse", targetTile: tile })
      setArmedDefuse(false)
      return
    }
    client.send({ _tag: "Flag", playerId: me, tile })
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

      <PlayerStrip state={match} me={me} />
      <Progress state={match} />
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

      <div className="control-bar">
        <CardRail me={mePlayer} state={match} onPlay={playCard} disabled={match.phase !== "committing"} />
        <RollButton client={client} me={me} />
      </div>
    </main>
  )
}
