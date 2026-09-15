#!/usr/bin/env node
/**
 * LAN relay: the browser-reachable twin of `crates/lan-sync/src/host.rs`.
 *
 * It assigns sequence numbers and fans actions out. That is the whole job — it
 * holds no game state and knows no rules, because every device folds the same
 * numbered log through the one TypeScript engine (ADR 0004). The frames are
 * deliberately identical to the Rust host's, so a peer cannot tell which kind
 * of host it joined and the two remain interchangeable.
 *
 *   node apps/relay/lan-relay.mjs [--port 4455] [--room ABCD] [--capacity 6]
 */
import { WebSocketServer } from "ws"
import { networkInterfaces } from "node:os"

export const PROTOCOL_VERSION = 1

/** Same alphabet as `lan_sync::room_code` — no 0/O or 1/I/L to misread. */
const ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

/**
 * The room code IS the match seed: every device derives the same board from
 * it, so no board is ever sent over the wire.
 */
export const roomCode = (seed) => {
  let n = seed >>> 0
  let out = ""
  for (let i = 0; i < 4; i++) {
    out += ROOM_ALPHABET[n % ROOM_ALPHABET.length]
    n = Math.floor(n / ROOM_ALPHABET.length)
  }
  return out
}

export const randomRoom = () =>
  roomCode(Math.floor(Math.random() * ROOM_ALPHABET.length ** 4))

/**
 * The sequencer, with no transport attached so it can be tested directly.
 * `send` is how a client is written to; the relay never inspects actions.
 */
export class Sequencer {
  #log = []
  #clients = new Map()
  #capacity
  #room
  #locked = false

  constructor({ room = "LOCAL", capacity = 6 } = {}) {
    this.#room = room
    this.#capacity = capacity
  }

  get room() {
    return this.#room
  }

  get log() {
    return [...this.#log]
  }

  lock() {
    this.#locked = true
  }

  get locked() {
    return this.#locked
  }

  roster() {
    return [...this.#clients.entries()]
      .map(([playerId, c]) => ({
        player_id: playerId,
        name: c.name,
        connected: c.connected,
      }))
      // Stable order so an idle lobby list does not reshuffle itself.
      .sort((a, b) => a.player_id.localeCompare(b.player_id))
  }

  /**
   * Admit a client. Returns `{ ok: false, reason }` when refused; the caller
   * is expected to close the socket after relaying the refusal.
   */
  join({ playerId, name, send }) {
    const returning = this.#clients.has(playerId)
    // A locked room still readmits someone who dropped mid-match: their seat
    // and their actions are already in the log.
    if (!returning && this.#locked) {
      return { ok: false, reason: "match already started" }
    }
    if (!returning && this.#clients.size >= this.#capacity) {
      return { ok: false, reason: "room is full" }
    }

    // playerId is client-supplied and reused on reconnect, so it is not enough
    // to tell "the socket I just registered" from "whatever is in the map by
    // now" — a token identifies this registration so a later exit can check
    // it still owns the seat before touching it.
    const token = Symbol(playerId)
    this.#clients.set(playerId, { name, send, connected: true, token })
    try {
      send({ t: "welcome", player_id: playerId, room: this.#room, log: this.log })
    } catch {
      // The socket died between connecting and being welcomed. Drop the seat
      // rather than leaving a client in the roster that can never be written
      // to — and never let it take the rest of the room down with it. But
      // only if nothing has since reconnected onto this same playerId; a
      // losing race here must not delete a live entry it no longer owns.
      if (this.#clients.get(playerId)?.token === token) this.#clients.delete(playerId)
      return { ok: false, reason: "could not reach client" }
    }
    this.#broadcast({ t: "roster", peers: this.roster() })
    return { ok: true, token }
  }

  /** Number an action, append it, and fan it out. */
  submit(action) {
    const entry = { seq: this.#log.length, action }
    this.#log.push(entry)
    this.#broadcast({ t: "commit", ...entry })
    return entry
  }

  leave(playerId, token) {
    const client = this.#clients.get(playerId)
    if (!client) return
    // A reconnect has taken this seat; the socket closing now is the old one,
    // and disabling the live client would cut it out of every broadcast.
    if (token !== undefined && client.token !== token) return
    client.connected = false
    this.#broadcast({ t: "roster", peers: this.roster() })
  }

  #broadcast(frame) {
    for (const client of this.#clients.values()) {
      if (!client.connected) continue
      // One unwritable socket must not stop the others from being told.
      try {
        client.send(frame)
      } catch {
        client.connected = false
      }
    }
  }
}

/** Every non-loopback IPv4 address, so the host can be told what to type in. */
export const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address)

export const startRelay = ({ port = 4455, room = "LOCAL", capacity = 6 } = {}) => {
  const sequencer = new Sequencer({ room, capacity })
  const wss = new WebSocketServer({ port })

  wss.on("connection", (socket) => {
    let playerId = null
    let token
    const send = (frame) => socket.send(JSON.stringify(frame))

    socket.on("message", (raw) => {
      let frame
      try {
        frame = JSON.parse(raw.toString())
      } catch {
        return // Ignore junk rather than dropping a player over one bad frame.
      }

      if (frame.t === "hello") {
        if (playerId !== null) return
        const result = sequencer.join({
          playerId: frame.player_id,
          name: frame.name,
          send,
        })
        if (!result.ok) {
          send({ t: "rejected", reason: result.reason })
          socket.close()
          return
        }
        playerId = frame.player_id
        token = result.token
        return
      }

      // Nothing but a handshake is accepted before one has happened.
      if (playerId === null) return

      if (frame.t === "submit") sequencer.submit(frame.action)
      else if (frame.t === "ping") send({ t: "pong" })
    })

    socket.on("close", () => {
      if (playerId !== null) sequencer.leave(playerId, token)
    })
    socket.on("error", () => {
      if (playerId !== null) sequencer.leave(playerId, token)
    })
  })

  // `port: 0` hands the bind to the OS; the real number only exists once the
  // socket has actually bound, one tick after `listen()` returns, so a caller
  // that needs it (tests, mainly, to dodge picking colliding fixed ports)
  // awaits `listening` before reading `.port`.
  const listening = new Promise((resolve, reject) => {
    if (wss.address()) resolve()
    else {
      wss.once("listening", resolve)
      wss.once("error", reject)
    }
  })

  return {
    wss,
    sequencer,
    listening,
    get port() {
      return wss.address()?.port ?? port
    },
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())
if (isMain) {
  const arg = (flag, fallback) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
  }
  const port = Number(arg("--port", 4455))
  const room = String(arg("--room", randomRoom())).toUpperCase()
  const capacity = Number(arg("--capacity", 6))

  startRelay({ port, room, capacity })
  const addresses = lanAddresses()
  console.log(`\nRoom ${room} — up to ${capacity} players, listening on port ${port}.\n`)
  if (addresses.length === 0) {
    console.log("No LAN address found. Is this machine on a network?")
  } else {
    console.log("On each other device, open the game and paste this into")
    console.log("\"Join by address\":\n")
    for (const address of addresses) console.log(`  ${address}:${port}@${room}`)
  }
  console.log("\nKeep this process running for the length of the match.")
}
