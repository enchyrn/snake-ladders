import { seedFromRoom } from "./hooks"

/** What a scanned join link carries: where the room is, and which board it is. */
export interface JoinArrival {
  readonly addr: string
  readonly seed: number
}

/**
 * The URL the host's lobby shows as a QR.
 *
 * Rooted at the origin, not at Vite's `BASE_URL`: this addresses the *host's*
 * own server, and `lan_sync::assets::request_path` answers `/` with
 * index.html. Only the native app can host, and it builds with the default
 * base, so the page the guest is served always sits at the root.
 *
 * Room and address ride in the fragment because browsers never send it, so
 * the host learns nothing about its own room from the request line and the
 * never-touches-the-internet promise holds for the link too.
 */
export const joinLink = (address: string, port: number, room: string): string => {
  const at = `${address}:${port}`
  return `http://${at}/#/join?room=${room}&at=${at}`
}

/**
 * What `joinLink` wrote, read back off a hash-routed URL, or `null` when the
 * player opened the join screen by hand.
 */
export const joinArrival = (hash: string): JoinArrival | null => {
  const query = hash.indexOf("?")
  if (query < 0) return null
  const params = new URLSearchParams(hash.slice(query + 1))
  const room = params.get("room")
  const addr = params.get("at")
  // Either half alone is useless: an address with no code cannot name a
  // board, and a code with no address has nowhere to send it.
  if (!room || !addr) return null
  // The code is the seed, so a code that decodes anyway would build a
  // different board in silence — every frame still parses.
  const seed = seedFromRoom(room)
  if (seed === null) return null
  return { addr, seed }
}
