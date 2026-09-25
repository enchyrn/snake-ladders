import type { TimelineEvent } from "@mutation/engine/events"
import type { MatchState } from "@mutation/engine/types"
import { css, cx } from "styled-system/css"

/** Plain-language narration of a resolved round. */
const describe = (event: TimelineEvent, nameOf: (id: string) => string): string | null => {
  switch (event._tag) {
    case "Rolled":
      return `${nameOf(event.playerId)} rolled ${event.dice.join(" + ")}${
        event.momentumBonus > 0 ? ` (+${event.momentumBonus} momentum)` : ""
      }`
    case "Moved":
      return event.bounced
        ? `${nameOf(event.playerId)} overshot and bounced back to ${event.to}`
        : null
    case "TookLink":
      return event.reversed
        ? `${nameOf(event.playerId)} reversed the ${event.kind} to ${event.to}`
        : event.kind === "ladder"
          ? `${nameOf(event.playerId)} climbed to ${event.to}`
          : `${nameOf(event.playerId)} was bitten down to ${event.to}`
    case "LinkCollapsed":
      return `a ladder wore out and collapsed into a snake at ${event.from}`
    case "Knocked":
      return `${nameOf(event.byPlayerId)} knocked ${nameOf(event.playerId)} back to ${event.to}`
    case "MineTripped":
      return event.absorbed
        ? `${nameOf(event.playerId)} absorbed a mine on ${event.tile}`
        : `${nameOf(event.playerId)} hit a mine on ${event.tile}`
    case "MineDefused":
      return `${nameOf(event.playerId)} disarmed tile ${event.tile}`
    case "CardPlayed":
      return `${nameOf(event.playerId)} played ${event.card}`
    case "VenomGained":
      return `${nameOf(event.playerId)} gained ${event.amount} venom`
    case "Swapped":
      return `${nameOf(event.playerId)} swapped places with ${nameOf(event.withPlayerId)}`
    case "BoardBreathed":
      return `the board shifted (${event.movedLinkIds.length} moved)`
    case "Stunned":
      return `${nameOf(event.playerId)} sits out the next round`
    case "Finished":
      return `${nameOf(event.playerId)} finished in place ${event.place}`
    case "Revealed":
      return null // the board itself shows this
  }
}

/** The last two lines is the preview's whole budget (see the band layout);
 *  `full` is everything the current round narrated. */
const PREVIEW_LINES = 2

export const EventLog = ({
  state,
  mode = "full",
}: {
  readonly state: MatchState
  readonly mode?: "preview" | "full"
}) => {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id
  const allLines = state.timeline
    .map((event) => describe(event, nameOf))
    .filter((line): line is string => line !== null)
  const lines = mode === "preview" ? allLines.slice(-PREVIEW_LINES) : allLines

  // ADR 0020 rule 2: this list is how a screen-reader player receives a round
  // at all, so no mode may take it out of the tree — an empty round still
  // renders the live region, just with nothing in it yet.
  //
  // The `log` class carries no styling of its own — it is what
  // `scripts/drive-app.mjs` greps for (`.log li`) to confirm a round
  // narrated, so it stays as a hook even though the panel's look (background,
  // padding, radius, font-size) is the Panda classes right beside it.
  return (
    <ul
      className={cx(
        "log",
        css({
          margin: 0,
          padding: "0.5rem 0.75rem",
          listStyle: "none",
          background: "rgba(8, 11, 16, 0.7)",
          backdropFilter: "blur(6px)",
          borderRadius: "12px",
          fontSize: "0.85rem",
          "& li": { padding: "0.15em 0" },
        }),
      )}
      aria-live="polite"
    >
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ul>
  )
}
