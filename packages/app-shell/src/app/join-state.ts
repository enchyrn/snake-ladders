/**
 * The join screen had one state and needed three. With none of these, an empty
 * roster rendered nothing at all, so a guest whose discovery failed could not
 * tell the app from a dead page.
 */
export const SEARCH_GRACE_MS = 4000

/** `unavailable` is a browser: discovery needs UDP, which no page can open,
 *  so there is no search to wait out and nothing it could have failed at. */
export type JoinState = "searching" | "found" | "none" | "unavailable"

export const joinState = (
  rooms: ReadonlyArray<unknown>,
  canDiscover: boolean,
  elapsedMs: number,
): JoinState =>
  !canDiscover
    ? "unavailable"
    : rooms.length > 0
      ? "found"
      : elapsedMs < SEARCH_GRACE_MS
        ? "searching"
        : "none"

export type ManualPlacement = "hidden" | "promoted" | "disclosure"

/**
 * Where the address field appears. A scanned QR code already carries the
 * address, so hiding the field while discovery is still running would leave
 * a guest who arrived with one nowhere to use it for the whole grace window —
 * the same dead end a pre-filled field behind a collapsed disclosure already
 * was. Without an arrival there is nothing to lose by waiting: the field only
 * promotes once the search has given up.
 */
export const manualPlacement = (state: JoinState, hasArrival: boolean): ManualPlacement =>
  state === "found" ? "disclosure" : hasArrival || state !== "searching" ? "promoted" : "hidden"

/**
 * The line above a promoted address field. With a scanned code the field is
 * promoted before the search has finished, so while it is still running the
 * copy cannot claim the room failed to appear — it sits right under
 * "Looking for games…".
 */
export const promotedHint = (state: JoinState, hasArrival: boolean): string => {
  if (state === "unavailable") {
    return hasArrival
      ? "Read from the code you scanned. Check the room, then tap Join."
      : "Enter the address shown on the host's screen — a browser can't search the Wi-Fi for games on its own."
  }
  return hasArrival
    ? state === "searching"
      ? "Read from the code you scanned — tap Join, or wait a moment for the game to be found."
      : "The code didn't show up automatically. Check the address below, then tap Join."
    : "No games showed up on this Wi-Fi. Enter the address shown on the host's screen, or check that both devices are on the same network."
}
