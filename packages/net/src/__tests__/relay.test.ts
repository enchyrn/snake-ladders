import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { Sequencer, startRelay, type RelayHandle } from "@mutation/relay"

interface Frame {
  t: string
  seq?: number
  action?: unknown
  log?: Array<{ seq: number; action: unknown }>
  peers?: Array<{ player_id: string; connected: boolean }>
  reason?: string
}

const servers: RelayHandle[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const s of sockets) s.close()
  sockets.length = 0
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.wss.close(() => r()))),
  )
})

// `port: 0` asks the OS for a free port, so two relays never fight over one
// a previous test hasn't released yet.
const relay = async (opts: { port?: number; room?: string; capacity?: number } = {}) => {
  const started = startRelay({ port: 0, ...opts })
  await started.listening
  servers.push(started)
  return started
}

/** Connect, collecting every frame the relay sends. */
const connect = (port: number) =>
  new Promise<{ socket: WebSocket; frames: Frame[] }>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`)
    sockets.push(socket)
    const frames: Frame[] = []
    socket.on("message", (raw) => frames.push(JSON.parse(raw.toString()) as Frame))
    socket.on("open", () => resolve({ socket, frames }))
    socket.on("error", reject)
  })

const send = (socket: WebSocket, frame: unknown) => socket.send(JSON.stringify(frame))

const hello = (socket: WebSocket, id: string) =>
  send(socket, { t: "hello", player_id: id, name: id })

/** Wait until `predicate` holds, or fail the test by timing out. */
const until = async (predicate: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error("condition never became true")
}

const commits = (frames: Frame[]) => frames.filter((f) => f.t === "commit")

describe("Sequencer", () => {
  it("numbers actions from zero without gaps", () => {
    const seq = new Sequencer()
    const sent: Frame[] = []
    seq.join({ playerId: "a", name: "A", send: (f: Frame) => sent.push(f) })

    for (let i = 0; i < 5; i++) seq.submit({ n: i })

    expect(commits(sent).map((f) => f.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it("hands a late joiner the log so far", () => {
    const seq = new Sequencer()
    seq.join({ playerId: "a", name: "A", send: () => {} })
    seq.submit({ n: 0 })
    seq.submit({ n: 1 })

    const late: Frame[] = []
    seq.join({ playerId: "b", name: "B", send: (f: Frame) => late.push(f) })

    const welcome = late.find((f) => f.t === "welcome")!
    expect(welcome.log).toHaveLength(2)
    expect(welcome.log!.map((e) => e.seq)).toEqual([0, 1])
  })

  it("turns away a newcomer once locked, but readmits a dropout", () => {
    const seq = new Sequencer()
    seq.join({ playerId: "a", name: "A", send: () => {} })
    seq.lock()

    expect(seq.join({ playerId: "stranger", name: "S", send: () => {} })).toMatchObject({
      ok: false,
    })
    // Someone whose phone left Wi-Fi still owns their seat.
    expect(seq.join({ playerId: "a", name: "A", send: () => {} })).toMatchObject({ ok: true })
  })

  it("refuses a player beyond capacity", () => {
    const seq = new Sequencer({ capacity: 2 })
    seq.join({ playerId: "a", name: "A", send: () => {} })
    seq.join({ playerId: "b", name: "B", send: () => {} })
    expect(seq.join({ playerId: "c", name: "C", send: () => {} })).toMatchObject({ ok: false })
  })

  it("drops a client whose socket dies before it can be welcomed", () => {
    const seq = new Sequencer()
    const result = seq.join({
      playerId: "broken",
      name: "B",
      send: () => {
        throw new Error("socket gone")
      },
    })
    expect(result).toMatchObject({ ok: false })
    // It must not linger in the roster as a seat nothing can ever write to.
    expect(seq.roster()).toHaveLength(0)
  })

  it("a reconnect is not disconnected by the old socket's close", () => {
    const seq = new Sequencer()
    const firstFrames: Frame[] = []
    const secondFrames: Frame[] = []

    const first = seq.join({ playerId: "p1", name: "Ada", send: (f: Frame) => firstFrames.push(f) })
    expect(first).toMatchObject({ ok: true })

    const second = seq.join({ playerId: "p1", name: "Ada", send: (f: Frame) => secondFrames.push(f) })
    expect(second).toMatchObject({ ok: true })

    // The old socket's close arrives after the reconnect has already taken
    // the seat — it must not be able to disable an entry it no longer owns.
    seq.leave("p1", first.ok ? first.token : undefined)

    secondFrames.length = 0
    seq.submit({ n: 0 })
    expect(commits(secondFrames)).toHaveLength(1)
  })

  it("keeps broadcasting when a client's socket dies later", () => {
    const seq = new Sequencer()
    const good: Frame[] = []
    let alive = true
    seq.join({
      playerId: "flaky",
      name: "F",
      send: () => {
        if (!alive) throw new Error("socket gone")
      },
    })
    seq.join({ playerId: "good", name: "G", send: (f: Frame) => good.push(f) })

    alive = false
    seq.submit({ n: 1 })
    seq.submit({ n: 2 })

    // One unwritable socket must not cost the others their commits.
    expect(commits(good).map((f) => f.seq)).toEqual([0, 1])
    const flaky = seq.roster().find((p) => p.player_id === "flaky")!
    expect(flaky.connected).toBe(false)
  })
})

describe("relay over a real socket", () => {
  it("gives every client the same ordered log", async () => {
    const { port } = await relay()
    const a = await connect(port)
    const b = await connect(port)
    hello(a.socket, "a")
    hello(b.socket, "b")
    await until(() => a.frames.some((f) => f.t === "welcome"))
    await until(() => b.frames.some((f) => f.t === "welcome"))

    send(a.socket, { t: "submit", action: { _tag: "Start" } })
    send(b.socket, { t: "submit", action: { _tag: "Commit", playerId: "b" } })

    await until(() => commits(a.frames).length === 2 && commits(b.frames).length === 2)
    // The whole design rests on this: identical order, identical content.
    expect(commits(a.frames)).toEqual(commits(b.frames))
    expect(commits(a.frames).map((f) => f.seq)).toEqual([0, 1])
  })

  it("announces the roster as players arrive", async () => {
    const { port } = await relay()
    const a = await connect(port)
    hello(a.socket, "a")
    await until(() => a.frames.some((f) => f.t === "welcome"))

    const b = await connect(port)
    hello(b.socket, "b")
    await until(() =>
      a.frames.some((f) => f.t === "roster" && (f.peers?.length ?? 0) === 2),
    )
    const roster = a.frames.filter((f) => f.t === "roster").at(-1)!
    expect(roster.peers!.map((p) => p.player_id)).toEqual(["a", "b"])
  })

  it("tells a refused client why before closing", async () => {
    const { port, sequencer } = await relay()
    const a = await connect(port)
    hello(a.socket, "a")
    await until(() => a.frames.some((f) => f.t === "welcome"))
    sequencer.lock()

    const late = await connect(port)
    hello(late.socket, "late")
    await until(() => late.frames.some((f) => f.t === "rejected"))
    expect(late.frames.find((f) => f.t === "rejected")!.reason).toMatch(/already started/)
  })

  it("ignores junk and unauthenticated submits", async () => {
    const { port } = await relay()
    const a = await connect(port)
    hello(a.socket, "a")
    await until(() => a.frames.some((f) => f.t === "welcome"))

    // A second socket that never says hello must not be able to write history.
    const silent = await connect(port)
    send(silent.socket, { t: "submit", action: { forged: true } })
    silent.socket.send("this is not json")

    send(a.socket, { t: "submit", action: { n: 1 } })
    await until(() => commits(a.frames).length === 1)
    await new Promise((r) => setTimeout(r, 120))
    expect(commits(a.frames)).toHaveLength(1)
    expect(commits(a.frames)[0]!.action).toEqual({ n: 1 })
  })

  it("locks the room when the host sends a lock frame", async () => {
    const { port, sequencer } = await relay()
    const host = await connect(port)
    hello(host.socket, "p1")
    await until(() => host.frames.some((f) => f.t === "welcome"))

    const peer = await connect(port)
    hello(peer.socket, "p2")
    await until(() => peer.frames.some((f) => f.t === "welcome"))

    send(host.socket, { t: "lock" })
    await until(() => sequencer.locked)

    const late = await connect(port)
    hello(late.socket, "p3")
    await until(() => late.frames.some((f) => f.t === "rejected"))
    expect(late.frames.find((f) => f.t === "rejected")!.reason).toMatch(/already started/)
  })

  it("ignores a lock frame from a player who is not the host", async () => {
    const { port, sequencer } = await relay()
    const host = await connect(port)
    hello(host.socket, "p1")
    await until(() => host.frames.some((f) => f.t === "welcome"))

    const peer = await connect(port)
    hello(peer.socket, "p2")
    await until(() => peer.frames.some((f) => f.t === "welcome"))

    send(peer.socket, { t: "lock" })
    await new Promise((r) => setTimeout(r, 120))
    expect(sequencer.locked).toBe(false)

    // The room can still be locked, by the host — proving the frame itself
    // works and the peer's attempt was refused for being the wrong player,
    // not because the relay drops "lock" frames altogether.
    send(host.socket, { t: "lock" })
    await until(() => sequencer.locked)
  })

  it("marks a peer disconnected when its socket drops", async () => {
    const { port } = await relay()
    const a = await connect(port)
    hello(a.socket, "a")
    const b = await connect(port)
    hello(b.socket, "b")
    await until(() => a.frames.some((f) => f.t === "roster" && f.peers?.length === 2))

    b.socket.close()
    await until(() =>
      a.frames.some(
        (f) => f.t === "roster" && f.peers?.some((p) => p.player_id === "b" && !p.connected),
      ),
    )
  })
})
