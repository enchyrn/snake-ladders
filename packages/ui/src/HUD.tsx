import type { ReactNode } from "react"
import { cardBlurbs, cardCost, type CardKind, type MatchState, type Player } from "@mutation/engine/types"
import { countColour, seatColour } from "@mutation/render/palette"
import { lastTile } from "@mutation/engine/board"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"
import { ChevronRight } from "lucide-react"
import { AnchorIcon, FlagIcon, MineIcon, MomentumIcon, StunIcon, VenomIcon } from "./icons"
import { ROW_PX, ROWS_PAD_PX } from "./layout/bands"

/** Text a screen reader speaks where the eye reads a glyph instead. */
const srOnlyClass = css({ srOnly: true })

/** A status glyph plus its count, named as one thing: `role="img"` is what
 *  makes assistive tech read the label — on a plain span, whose only content
 *  is an `aria-hidden` icon, it was silently ignored. */
const badgeClass = css({ display: "flex", alignItems: "center", gap: "2px" })

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
        flex: "none",
        listStyleType: "none",
        margin: 0,
        paddingLeft: "gutterL",
        paddingRight: "gutterR",
        display: "flex",
        flexDirection: "column",
        gap: "9px",
      })}
      // ROWS_PAD_PX and ROW_PX are what bands.ts budgets for this band, so
      // they are applied from the same constants rather than restated.
      style={{ paddingBlock: `${ROWS_PAD_PX / 2}px` }}
    >
      {state.players.map((player) => {
        const isActing = player.id === actingSeat
        const isDone = player.finishedAtRound !== null
        const isAway = !player.connected
        return (
          <li
            key={player.id}
            data-acting={isActing}
            aria-current={isActing ? "true" : undefined}
            style={{ height: `${ROW_PX}px` }}
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
              {isActing && (
                <>
                  <ChevronRight size={14} aria-hidden="true" />
                  <span className={srOnlyClass}>Acting: </span>
                </>
              )}
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
                <span role="img" aria-label={`${player.venom} venom`} className={badgeClass}>
                  <VenomIcon size={14} />
                  {player.venom}
                </span>
              )}
              {player.momentum > 0 && (
                <span role="img" aria-label={`${player.momentum} momentum`} className={badgeClass}>
                  <MomentumIcon size={14} />
                  {player.momentum}
                </span>
              )}
              {player.anchored && (
                <span role="img" aria-label="anchored" className={badgeClass}>
                  <AnchorIcon size={14} />
                </span>
              )}
              {player.stunned > 0 && (
                <span role="img" aria-label="sitting out" className={badgeClass}>
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
    // No `overflow-x`: the rail's five cards (four without minesweeper) flex
    // to fit the control bar rather than scrolling out of reach — the survey
    // found a half-clipped "Double" behind the old fixed-width, scrolling rail.
    // This is its own full-width row (`ControlBar` below puts the dice tray
    // and Roll on a second row after it), so it needs no `flex` of its own
    // here — the column parent's `align-items: stretch`/`width: 100%` gives
    // it the full row width, which five cards then divide evenly below.
    <div className={css({ display: "flex", gap: "4px" })}>
      {CARDS.filter((card) => card !== "defuse" || hasMines).map((card) => {
        const cost = cardCost[card]
        const affordable = me.venom >= cost
        const alreadyPlayed = me.pending.includes(card)
        return (
          <button
            key={card}
            type="button"
            className={cx(
              button({ variant: "card", size: "sm" }),
              // Five cards share the row, and the recipe's own padding
              // would leave each name about 43px at 390 — enough to truncate
              // every one past "swap". Tighter padding claims that back, and
              // matters most on the narrowest phones.
              css({ flex: "1 1 0", minWidth: 0, paddingInline: "1" }),
            )}
            disabled={disabled || !affordable || alreadyPlayed}
            title={cardBlurbs[card]}
            onClick={() => onPlay(card)}
          >
            <span
              className={css({
                textTransform: "capitalize",
                fontSize: "xs",
                overflow: "hidden",
                maxWidth: "100%",
                // One line, cut with an ellipsis if it must be. Wrapping at
                // `sm` broke "Reverse" mid-word; with the match screen's
                // gutters no longer doubled, the names fit at 390.
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                textAlign: "center",
              })}
            >
              {card}
            </span>
            <span className={css({ display: "flex", alignItems: "center", gap: "2px", color: "flag", fontSize: "xs" })}>
              <VenomIcon size={12} />
              {cost}
              <span className={srOnlyClass}> venom</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The input affordance, which is a different object from `Dice.show`'s
 * rendered outcome — an input control inside the renderer is what ADR 0007
 * exists to prevent. It is a real <button> so that hiding the Roll button
 * (plan 2) does not remove the only keyboard path to Commit.
 */
export const DiceTray = ({
  onRoll,
  disabled,
}: {
  readonly onRoll: () => void
  readonly disabled: boolean
}) => (
  <button
    type="button"
    aria-label="Roll the dice"
    disabled={disabled}
    onClick={onRoll}
    // Grows to share the row with whatever sits beside it (`Roll`, which
    // keeps its own fixed width) instead of shrinking to its own content —
    // the pair used to leave roughly a third of the row empty.
    className={cx(button({ variant: "secondary", size: "lg" }), css({ flex: "1 1 auto" }))}
  >
    <span aria-hidden className={css({ display: "flex", gap: "5px" })}>
      <span className={css({ w: "24px", h: "24px", borderRadius: "5px", bg: "text" })} />
      <span className={css({ w: "24px", h: "24px", borderRadius: "5px", bg: "text" })} />
    </span>
  </button>
)

/**
 * The control bar's two rows: the card rail alone, full width, then the dice
 * tray sharing a second row with whatever else can trigger a roll (`Roll`,
 * until plan 2's `rollButton: hidden` removes it) — `children`, so this stays
 * in `@mutation/ui` without reaching up for `RollButton`'s atoms, which live
 * in app-shell (the layer boundary only allows the other direction).
 *
 * One row was the original shape; sharing it with the dice tray and Roll
 * crushed every card under the 44px tap minimum (~26px at phone width) and
 * its name to nothing. This is composition only — the bar's own chrome
 * (sticky position, background, padding) stays with whatever places it, so a
 * future layout (the five-band one Task 9 adds) drops this in without
 * inheriting positioning it would have to undo.
 */
export const ControlBar = ({
  me,
  state,
  onPlay,
  cardsDisabled,
  onRoll,
  rollDisabled,
  children,
}: {
  readonly me: Player | undefined
  readonly state: MatchState
  readonly onPlay: (card: CardKind) => void
  readonly cardsDisabled: boolean
  readonly onRoll: () => void
  readonly rollDisabled: boolean
  readonly children?: ReactNode
}) => (
  <div className={css({ display: "flex", flexDirection: "column", gap: "6px", width: "100%" })}>
    <CardRail me={me} state={state} onPlay={onPlay} disabled={cardsDisabled} />
    <div className={css({ display: "flex", gap: "8px" })}>
      <DiceTray onRoll={onRoll} disabled={rollDisabled} />
      {children}
    </div>
  </div>
)

/**
 * A one-line key to the minefield. Hidden tiles, revealed counts, flags and
 * spent mines are all drawn on the board itself; this names them, and tells a
 * first-time player the one thing the board cannot: tapping flags a tile.
 */
const legendClass = css({
  alignSelf: "stretch",
  margin: 0,
  padding: "0.35rem 0.6rem",
  listStyle: "none",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem 0.9rem",
  fontSize: "0.75rem",
  color: "textDim",
  background: "rgba(8, 11, 16, 0.7)",
  backdropFilter: "blur(6px)",
  borderRadius: "10px",
  "& li": { display: "flex", alignItems: "center", gap: "0.35em", whiteSpace: "nowrap" },
})

const swatchClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.25rem",
  height: "1.25rem",
  borderRadius: "3px",
  fontWeight: 800,
  fontSize: "0.85rem",
  lineHeight: 1,
})

const hiddenSwatch = cx(
  swatchClass,
  css({
    background: "surfaceRaised",
    boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.12), inset -1px -1px 0 rgba(0, 0, 0, 0.45)",
  }),
)
const revealedSwatch = cx(swatchClass, css({ background: "revealed", boxShadow: "inset 1px 1px 0 rgba(0, 0, 0, 0.4)" }))
const flagSwatch = cx(swatchClass, css({ background: "surfaceRaised", color: "flag" }))
const mineSwatch = cx(swatchClass, css({ background: "rgba(217, 69, 95, 0.28)", color: "#9aa7ad" }))

export const MineLegend = () => (
  <ul className={legendClass} aria-label="Minefield key">
    <li>
      <span className={hiddenSwatch} />
      hidden
    </li>
    <li>
      <span className={revealedSwatch} style={{ color: countColour(2) }}>
        2
      </span>
      mines nearby
    </li>
    <li>
      <span className={flagSwatch}>
        <FlagIcon size={14} />
      </span>
      flag <span className={css({ color: "text" })}>(tap a hidden tile)</span>
    </li>
    <li>
      <span className={mineSwatch}>
        <MineIcon size={14} />
      </span>
      spent mine
    </li>
  </ul>
)
