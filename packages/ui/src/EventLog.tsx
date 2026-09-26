import type { TimelineEvent } from "@mutation/engine/events"
import type { MatchState } from "@mutation/engine/types"
import { css, cx } from "styled-system/css"
import { LOG_LINE_PX } from "./layout/bands"

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

/** The list's own vertical padding. A line is LOG_LINE_PX — the item's
 *  line-height plus its padding — which is what layout/bands.ts reserves. */
const LIST_PAD_PX = 8

const listClass = css({
  margin: 0,
  listStyle: "none",
  background: "rgba(8, 11, 16, 0.7)",
  backdropFilter: "blur(6px)",
  borderRadius: "12px",
  fontSize: "0.85rem",
  paddingInline: "0.75rem",
  "& li": { paddingBlock: "2px", lineHeight: "18px" },
})

/** Shows the newest two lines and clips the rest off the top — but keeps them
 *  in the tree, because this list is the live region and a screen-reader
 *  player must hear the whole round, not the last two lines of it. The fade
 *  is the "older lines slide away upward" cue, drawn rather than said. */
const previewClass = css({
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  overflow: "hidden",
  // The band gives way first on a short screen: two lines, one, then none —
  // never a sliver of a line. Transparent rather than `display: none`, which
  // would take the live region out of the accessibility tree. The container
  // is the band match.tsx places this in; 30px is one line plus padding.
  "@container (max-height: 29.9px)": { opacity: 0 },
})

/** Only once there is an older line to fade: masking a lone line would dim
 *  the newest thing the player has to read. */
const fadeClass = css({ maskImage: "linear-gradient(to bottom, rgba(0, 0, 0, 0.35), black 50%)" })

export const EventLog = ({
  state,
  mode = "full",
}: {
  readonly state: MatchState
  readonly mode?: "preview" | "full"
}) => {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id
  const lines = state.timeline
    .map((event) => describe(event, nameOf))
    .filter((line): line is string => line !== null)
  const preview = mode === "preview"

  // ADR 0020 rule 2: the preview is how a screen-reader player receives a
  // round at all, so it is the one live region and it is never unmounted —
  // an empty round still renders it, just with nothing in it yet. The full
  // log is a second copy of the same lines for reading back; were it live
  // too, opening it would announce every line twice.
  //
  // The `log` class carries no styling of its own — it is what
  // `scripts/drive-app.mjs` greps for (`.log li`) to confirm a round
  // narrated, so it stays as a hook even though the panel's look (background,
  // padding, radius, font-size) is the Panda classes right beside it.
  return (
    <ul
      className={cx("log", listClass, preview && previewClass, preview && lines.length > 1 && fadeClass)}
      style={{
        paddingBlock: `${LIST_PAD_PX / 2}px`,
        // Two lines, or less if the band has given its room away (the log is
        // the first band to shrink on a short screen).
        maxHeight: preview ? `min(${2 * LOG_LINE_PX + LIST_PAD_PX}px, 100%)` : undefined,
      }}
      aria-live={preview ? "polite" : undefined}
    >
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ul>
  )
}
