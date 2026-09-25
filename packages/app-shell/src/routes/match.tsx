import { useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useSession } from "../app/session"
import { useViewport } from "../app/hooks"
import type { CardKind } from "@mutation/engine/types"
import { actingSeatAtom, canRollAtom, matchAtom, ownedActableAtom, seatsAtom } from "../store/atoms"
import type { MatchClient } from "../store/match-client"
import { BoardCanvas } from "@mutation/ui/BoardCanvas"
import { DesyncBanner, NoticeBanner } from "../app/banners"
import { EventLog } from "@mutation/ui/EventLog"
import { ControlBar, ProgressRows } from "@mutation/ui/HUD"
import { bands } from "@mutation/ui/layout/bands"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"
import { History, Settings, X } from "lucide-react"

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

const headerIconButton = cx(button({ variant: "ghost", size: "sm" }), css({ width: "tap", paddingInline: "0" }))

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
  // The header's round-log button opens the full timeline; the band below it
  // always shows the two-line preview (ADR 0020 rule 2 never takes the live
  // region out of the tree, so the preview keeps narrating underneath).
  const [showFullLog, setShowFullLog] = useState(false)
  const viewport = useViewport()

  useEffect(() => {
    if (!client) void navigate({ to: "/" })
  }, [client, navigate])

  if (!client) return null

  const actingPlayer = match.players.find((p) => p.id === actingSeat)
  const nameOf = (id: string) => match.players.find((p) => p.id === id)?.name ?? id
  const hasMines = match.config.modules.includes("minesweeper")
  const winner = match.winners[0]
  const logBand = bands(match.players.length, viewport.height)

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
      {armedDefuse && <p className="banner notice">Tap a tile within reach to disarm it.</p>}

      {/* Band 1: header — whose turn, round-log, settings (ADR 0020's chrome
       * home for the two controls that are not the board or the roll). */}
      <header
        // Panda's static extraction only resolves literal values, not the
        // imported `HEADER_PX` — a template-interpolated constant here
        // produces a classname with no matching rule (silently 0px). The
        // literal has to mirror `HEADER_PX` in layout/bands.ts by hand.
        className={css({
          flex: "none",
          minHeight: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "3",
          paddingInline: "4",
        })}
      >
        <div className={css({ display: "flex", flexDirection: "column", gap: "2", minWidth: 0 })}>
          {seats.length > 1 && actingPlayer && (
            <p
              className={css({
                margin: 0,
                fontSize: "sm",
                color: "textDim",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              })}
            >
              {canRollNow
                ? `${actingPlayer.name}'s turn — pass the device`
                : `Playing as ${actingPlayer.name}`}
            </p>
          )}
          {ownedActable.length > 1 && (
            <div className={css({ display: "flex", gap: "2", flexWrap: "wrap" })}>
              {ownedActable.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  className={button({ variant: seat === actingSeat ? "primary" : "ghost", size: "sm" })}
                  onClick={() => client.setActingSeat(seat)}
                >
                  {nameOf(seat)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={css({ display: "flex", gap: "2", flex: "none" })}>
          <button
            type="button"
            aria-label="Round log"
            className={headerIconButton}
            onClick={() => setShowFullLog(true)}
          >
            <History size={18} aria-hidden="true" />
          </button>
          {/* Inert rather than hidden, per ADR 0020's own precedent for a
           * control the player cannot use yet (CardRail's unaffordable
           * cards): `disabled` keeps it visible and legible as "not yet"
           * instead of erasing it, and plan 2 is what wires it up. */}
          <button type="button" aria-label="Settings" className={headerIconButton} disabled>
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Band 2: progress rows. */}
      <ProgressRows state={match} actingSeat={actingSeat} />

      {/* Band 3: the board — fixed at the `board` token so a flex
       * miscalculation elsewhere in the tree can never squeeze it. */}
      <div className={cx("board-wrap", css({ flex: "none", h: "board", w: "100%" }))}>
        <BoardCanvas state={match} onPickTile={hasMines ? pickTile : undefined} />
      </div>

      {/* Band 4: the log preview — takes whatever the other bands leave,
       * capped by the pure band budget rather than an open-ended flex-grow. */}
      <div
        className={css({ flex: "1 1 auto", minHeight: 0, overflow: "hidden" })}
        style={{ maxHeight: `${logBand.log}px` }}
      >
        <EventLog state={match} mode="preview" />
      </div>

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

      {/* Band 5: the control bar — card rail, then dice tray and Roll. */}
      <div className="control-bar">
        <ControlBar
          me={actingPlayer}
          state={match}
          onPlay={playCard}
          cardsDisabled={match.phase !== "committing"}
          onRoll={() => client.send({ _tag: "Commit", playerId: actingSeat })}
          rollDisabled={!canRollNow}
        >
          <RollButton client={client} seat={actingSeat} />
        </ControlBar>
      </div>

      {showFullLog && (
        <div
          role="dialog"
          aria-label="Round log"
          className={css({
            position: "absolute",
            inset: 0,
            zIndex: 6,
            display: "flex",
            flexDirection: "column",
            background: "rgba(8, 11, 16, 0.92)",
            padding: "4",
            gap: "3",
          })}
        >
          <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
            <h2 className={css({ margin: 0, fontSize: "lg" })}>Round log</h2>
            <button
              type="button"
              aria-label="Close round log"
              className={headerIconButton}
              onClick={() => setShowFullLog(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className={css({ overflowY: "auto", flex: "1 1 auto" })}>
            <EventLog state={match} mode="full" />
          </div>
        </div>
      )}
    </main>
  )
}
