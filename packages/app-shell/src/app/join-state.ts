/**
 * The join screen had one state and needed three. With none of these, an empty
 * roster rendered nothing at all, so a guest whose discovery failed could not
 * tell the app from a dead page.
 */
export const SEARCH_GRACE_MS = 4000

export type JoinState = "searching" | "found" | "none"

export const joinState = (rooms: ReadonlyArray<unknown>, elapsedMs: number): JoinState =>
  rooms.length > 0 ? "found" : elapsedMs < SEARCH_GRACE_MS ? "searching" : "none"
