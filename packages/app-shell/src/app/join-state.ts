/**
 * The join screen had one state and needed three. With none of these, an empty
 * roster rendered nothing at all, so a guest whose discovery failed could not
 * tell the app from a dead page.
 */
export const SEARCH_GRACE_MS = 4000

export type JoinState = "searching" | "found" | "none"

export const joinState = (rooms: ReadonlyArray<unknown>, elapsedMs: number): JoinState =>
  rooms.length > 0 ? "found" : elapsedMs < SEARCH_GRACE_MS ? "searching" : "none"

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
  state === "found" ? "disclosure" : hasArrival || state === "none" ? "promoted" : "hidden"
