import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Effect, Either } from "effect"
import { useEffect, useMemo, useRef, useState } from "react"
import { roomCode, seedFromRoom } from "../app/hooks"
import { joinArrival } from "../app/join-link"
import { onceAtATime } from "../app/once-at-a-time"
import { useSession } from "../app/session"
import { unexpected, type RoomView } from "@mutation/net/transport"

export const JoinScreen = () => {
  const session = useSession()
  const navigate = useNavigate()
  // Read once, at mount: this is the URL the player arrived on, and re-reading
  // it on a later render would overwrite a field they have since edited.
  const [arrival] = useState(() =>
    typeof window === "undefined" ? null : joinArrival(window.location.hash),
  )
  const [manual, setManual] = useState(() =>
    arrival ? `${arrival.addr}@${roomCode(arrival.seed)}` : "",
  )
  // Scanning a code should not drop the player into a live match — the room
  // is filled in and shown, and they press Join. But a pre-filled field
  // inside a collapsed `<details>` is the same dead end as no field at all,
  // so arriving from a link opens it.
  const [byAddress, setByAddress] = useState(arrival !== null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  // Kick discovery off once; the query below just reads what it has found.
  useEffect(() => {
    Effect.runPromise(Effect.either(session.transport("network").browse))
      .then((browsing) => {
        if (Either.isLeft(browsing)) setError(browsing.left.reason)
      })
      .catch(() => setError(unexpected))
  }, [session])

  const rooms = useQuery({
    queryKey: ["lan-rooms"],
    queryFn: () => Effect.runPromise(session.transport("network").rooms),
    // Beacons land about once a second; matching that keeps the list live
    // without spinning the radio harder than the host is already using it.
    refetchInterval: 1000,
    initialData: [] as ReadonlyArray<RoomView>,
  })

  const runEnter = async (addr: string, seed: number) => {
    setError(null)
    // Held so the teardown paths below can only reach *this* join's client: a
    // slow handshake can settle long after the player has tapped another room.
    const mine = session.open({ role: "peer", seed, kind: "network" })
    let joined
    try {
      joined = await Effect.runPromise(
        Effect.either(
          session.transport("network").join(addr, {
            player_id: session.identity.playerId,
            name: session.identity.name,
          }),
        ),
      )
    } catch {
      // `closeIf` reports whether this join still owned the session: a
      // second tap can start another join before this one settles, and once
      // that one has torn this client down and moved on, this continuation
      // must not write its failure into a screen the player has left.
      if (session.closeIf(mine)) setError(unexpected)
      return
    }
    // The reason, not the failure: a refused join says why — the room is
    // full, the code is wrong, the page may not open an insecure socket —
    // and every one of those is something the player can act on.
    if (Either.isLeft(joined)) {
      if (session.closeIf(mine)) setError(joined.left.reason)
      return
    }
    await navigate({ to: "/lobby" })
  }

  // Held across renders on purpose: the room list refetches about once a
  // second, and a wrapper rebuilt each render would start every tap with a
  // fresh `busy` flag and so guard nothing at all.
  const latest = useRef(runEnter)
  latest.current = runEnter
  const enter = useMemo(
    () => onceAtATime((addr: string, seed: number) => latest.current(addr, seed), setJoining),
    [],
  )
  // This guard is instance-scoped, not global: Back is deliberately left
  // enabled while joining, so tap-room -> Back -> Join remounts JoinScreen
  // with a fresh `busy === false` wrapper, and a second join can start while
  // the first is still awaiting its handshake. That's fine only because
  // session.closeIf / client-slot.ts's clearIf stays the one authority on who
  // owns the session — don't read "only one join runs now" as license to
  // remove that machinery, it's the fix for a defect an earlier session hit.

  const enterManually = () => {
    const [addr, code] = manual.split("@")
    const seed = code ? seedFromRoom(code) : null
    if (!addr || seed === null) {
      setError("Enter it as address@CODE, for example 192.168.1.24:5000@7QF2")
      return
    }
    void enter(addr.trim(), seed)
  }

  return (
    <main className="screen">
      <header className="bar">
        <button type="button" onClick={() => void navigate({ to: "/" })}>
          ‹ Back
        </button>
        <h2>Games nearby</h2>
      </header>

      {rooms.data.length === 0 && (
        <p className="hint">
          Looking for rooms on this Wi-Fi. Both devices need to be on the same
          network — a phone hotspot works, and neither device needs internet.
        </p>
      )}

      <ul className="rooms">
        {rooms.data.map((room) => (
          <li key={room.room}>
            <button
              type="button"
              disabled={joining || room.locked || room.players >= room.capacity}
              onClick={() => void enter(room.addr, room.seed)}
            >
              <span className="room-code">{room.room}</span>
              <span className="room-host">{room.host}</span>
              <span className="room-count">
                {room.players}/{room.capacity}
                {room.locked ? " · in progress" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <details
        className="manual"
        open={byAddress}
        onToggle={(e) => setByAddress(e.currentTarget.open)}
      >
        <summary>Join by address</summary>
        <p className="hint">
          {arrival
            ? "Read from the code you scanned. Check the room, then tap Join."
            : "Use this when the network blocks discovery broadcasts, or on an iPhone that has not been granted the local-network permission. The host screen shows both parts."}
        </p>
        <input
          value={manual}
          placeholder="192.168.1.24:5000@7QF2"
          autoCapitalize="characters"
          onChange={(e) => setManual(e.target.value)}
        />
        <button type="button" disabled={joining} onClick={enterManually}>
          Join
        </button>
      </details>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
