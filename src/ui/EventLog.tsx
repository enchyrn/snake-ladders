import type { TimelineEvent } from "@/engine/events"
import type { MatchState } from "@/engine/types"

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

export const EventLog = ({ state }: { readonly state: MatchState }) => {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id
  const lines = state.timeline
    .map((event) => describe(event, nameOf))
    .filter((line): line is string => line !== null)

  if (lines.length === 0) return null
  return (
    <ul className="log" aria-live="polite">
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ul>
  )
}
