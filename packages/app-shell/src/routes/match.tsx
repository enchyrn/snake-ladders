import { useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { useSession } from "../app/session"
import type { CardKind } from "@mutation/engine/types"
import { actingSeatAtom, canRollAtom, matchAtom, ownedActableAtom, seatsAtom } from "../store/atoms"
import type { MatchClient } from "../store/match-client"
import { BoardCanvas } from "@mutation/ui/BoardCanvas"
import { DesyncBanner, NoticeBanner } from "../app/banners"
import { EventLog } from "@mutation/ui/EventLog"
import { ControlBar, ProgressRows } from "@mutation/ui/HUD"
import { RoundLogSheet } from "@mutation/ui/RoundLogSheet"
import { seatColour } from "@mutation/render/palette"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"
import { History, Settings } from "lucide-react"
import { gutterBandClass, headingClass, matchScreenClass } from "@mutation/ui/layout/screen"
import { noticeBanner } from "@mutation/ui/Banners"

/** Isolated so the Roll button re-renders on its own — not on every card play,
 *  every tile reveal, or the roster twitching — since `canRollAtom` is the
 *  only slice it reads. */
const rollButtonClass = cx(
  button({ variant: "primary", size: "md" }),
  css({ flex: "none", minWidth: { base: "4.5rem", sm: "6rem" } }),
)

const RollButton = ({ client, seat }: { readonly client: MatchClient; readonly seat: string }) => {
  const canRoll = useAtomValue(canRollAtom)
  return (
    <button
      type="button"
      className={rollButtonClass}
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
  const roundLogButton = useRef<HTMLButtonElement | null>(null)
  // While the sheet is open, everything behind it is inert — except the log
  // preview, which holds nothing focusable and is the live region.
  const behindSheet = showFullLog || undefined

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
    <main className={matchScreenClass}>
      <div className={cx(gutterBandClass, css({ flex: "none" }))} inert={behindSheet}>
        <NoticeBanner />
        <DesyncBanner />
        {armedDefuse && <p className={noticeBanner}>Tap a tile within reach to disarm it.</p>}
      </div>

      {/* Band 1: header — whose turn, round-log, settings (ADR 0020's chrome
       * home for the two controls that are not the board or the roll). */}
      <header
        inert={behindSheet}
        className={css({
          flex: "none",
          minHeight: "header",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "3",
          paddingLeft: "gutterL",
          paddingRight: "gutterR",
        })}
      >
        <div className={css({ minWidth: 0 })}>
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
        </div>
        <div className={css({ display: "flex", gap: "2", flex: "none" })}>
          <button
            ref={roundLogButton}
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

      {/* Band 1b: the seat switcher, only in simultaneous pass-and-play with
       * more than one local seat that can act. Its own band, one row, the
       * buttons sharing it the way the card rail's cards do: wrapping inside
       * the header grew it to ~170px at six seats and pushed the control bar
       * over the board. bands.ts budgets it; the log is what gives way. */}
      {ownedActable.length > 1 && (
        <div
          inert={behindSheet}
          role="group"
          aria-label="Act as"
          className={cx(gutterBandClass, css({ flex: "none", display: "flex", gap: "1", paddingBottom: "2" }))}
        >
          {ownedActable.map((seat) => {
            const player = match.players.find((p) => p.id === seat)
            return (
              <button
                key={seat}
                type="button"
                aria-pressed={seat === actingSeat}
                className={cx(
                  button({ variant: seat === actingSeat ? "primary" : "secondary", size: "sm" }),
                  css({ flex: "1 1 0", minWidth: 0, paddingInline: "1" }),
                )}
                // The seat's colour as an inset underline, tying the button to
                // its progress row: a swatch beside the name cost the width
                // six buttons do not have.
                style={player ? { boxShadow: `inset 0 -3px 0 ${seatColour(player.seat)}` } : undefined}
                onClick={() => client.setActingSeat(seat)}
              >
                <span className={css({ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" })}>
                  {nameOf(seat)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Band 2: progress rows. */}
      <div inert={behindSheet} className={css({ display: "contents" })}>
        <ProgressRows state={match} actingSeat={actingSeat} />
      </div>

      {/* Band 3: the board — fixed at the `board` token so a flex
       * miscalculation elsewhere in the tree can never squeeze it. */}
      <div
        inert={behindSheet}
        className={css({ position: "relative", flex: "none", h: "board", w: "board", maxW: "100%", marginInline: "auto" })}
      >
        <BoardCanvas state={match} onPickTile={hasMines ? pickTile : undefined} />
      </div>

      {/* Band 4: the log preview — the one band that flexes. It takes what
       * the fixed bands leave and is the first to give way; bands.ts is the
       * tested arithmetic that says it never has to take from the board.
       * A tap opens the full log; the header button is the keyboard path. */}
      <div
        className={cx(
          gutterBandClass,
          css({
            flex: "1 1 0",
            minHeight: 0,
            overflow: "hidden",
            paddingTop: "1",
            cursor: "pointer",
            // The preview hides itself below one whole line (EventLog.tsx).
            containerType: "size",
          }),
        )}
        onClick={() => setShowFullLog(true)}
      >
        <EventLog state={match} mode="preview" />
      </div>

      {match.phase === "finished" && (
        <div
          inert={behindSheet}
          // Fixed, not absolute: the screen scrolls when the bands outgrow a
          // short phone, and an absolute overlay covers only the unscrolled
          // first screenful — the control bar stayed uncovered beneath it.
          className={css({
            position: "fixed",
            inset: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "3",
            paddingLeft: "gutterL",
            paddingRight: "gutterR",
            background: "rgba(8, 11, 16, 0.92)",
            textAlign: "center",
          })}
        >
          {/* `winners[0]` under `.length > 0` is always in range — noUncheckedIndexedAccess
           * still types it as possibly-undefined, so name it explicitly instead of asserting. */}
          <h2 className={headingClass}>{winner ? `${nameOf(winner)} wins!` : "Match over"}</h2>
          <ol className={css({ margin: 0, padding: 0, listStyle: "none", fontSize: "1.1rem" })}>
            {match.winners.map((id, i) => (
              <li key={id}>
                {i + 1}. {nameOf(id)}
              </li>
            ))}
          </ol>
          <button type="button" className={button({ variant: "primary", size: "md" })} onClick={backHome}>
            Back to home
          </button>
        </div>
      )}

      {/* Band 5: the control bar — card rail, then dice tray and Roll. */}
      <div
        inert={behindSheet}
        className={css({
          flex: "none",
          // Pinned to the bottom by the log's flex above it, and by this if
          // the log is ever absent — never by `sticky`, which is what let the
          // bar ride up over the board when the header overgrew.
          marginTop: "auto",
          display: "flex",
          alignItems: "stretch",
          gap: "0.6rem",
          paddingTop: "0.6rem",
          paddingRight: "gutterR",
          paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))",
          paddingLeft: "gutterL",
          background: "surface",
          borderTop: "1px solid",
          borderColor: "border",
        })}
      >
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
        <RoundLogSheet state={match} onClose={() => setShowFullLog(false)} restoreFocusTo={roundLogButton} />
      )}
    </main>
  )
}
