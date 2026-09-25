import { useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { roomCode } from "../app/hooks"
import { joinLink } from "../app/join-link"
import { useSession } from "../app/session"
import { allModules, moduleBlurbs, moduleLabels, type RuleModule } from "@mutation/engine/primitives"
import { QrCode } from "@mutation/ui/QrCode"
import { seatColour } from "@mutation/render/palette"
import { matchAtom, meAtom, phaseAtom, roleAtom, roomAtom } from "../store/atoms"
import { DesyncBanner, NoticeBanner } from "../app/banners"
import { button } from "styled-system/recipes"
import { css, cx } from "styled-system/css"

// Task 3's reserved-link-hue predicate covers seats, not chrome — checked by
// eye here. `seat.0` (cyan) sits well outside the green band the renderer
// reserves for snakes and ladders, unlike the `--snake-head` green the old
// `.module-toggle.is-active` rule used.
const onColour = css({ borderColor: "seat.0", color: "seat.0" })

export const LobbyScreen = () => {
  const session = useSession()
  const navigate = useNavigate()
  const client = session.client

  const match = useAtomValue(matchAtom)
  const phase = useAtomValue(phaseAtom)
  const role = useAtomValue(roleAtom)
  const me = useAtomValue(meAtom)
  const room = useAtomValue(roomAtom)
  const [guestName, setGuestName] = useState("")

  // A peer only ever proposes modules and a start through the host's Configure
  // and Start; on this device's own screen a peer just watches them happen.
  const canHost = role !== "peer"

  const joined = useRef(false)
  useEffect(() => {
    // No client means this route was reached directly (a reload, a stale
    // link) rather than through home/join, which is the only place a match
    // gets opened.
    if (!client) {
      void navigate({ to: "/" })
      return
    }
    if (joined.current) return
    joined.current = true
    const identities = role === "local"
      ? session.profiles
      : [{ id: session.identity.playerId, name: session.identity.name }]
    for (const identity of identities) {
      client.send({ _tag: "Join", playerId: identity.id, name: identity.name })
    }
  }, [client, navigate, role, session.identity.playerId, session.identity.name, session.profiles])

  useEffect(() => {
    if (phase !== "lobby") void navigate({ to: "/match" })
  }, [phase, navigate])

  if (!client) return null

  const toggleModule = (module: RuleModule) => {
    if (!canHost) return
    const modules = match.config.modules.includes(module)
      ? match.config.modules.filter((m) => m !== module)
      : [...match.config.modules, module]
    client.send({ _tag: "Configure", config: { ...match.config, modules } })
  }

  const leave = () => {
    session.close()
    void navigate({ to: "/" })
  }

  return (
    <main className="screen lobby">
      <header className="bar">
        <button type="button" onClick={leave}>
          ‹ Leave
        </button>
        <h2>Lobby</h2>
      </header>

      <NoticeBanner />
      <DesyncBanner />

      <section className="room-share">
        <span className="room-share-label">Room code</span>
        <span className="room-code-display">{roomCode(match.config.seed)}</span>
        {role === "host" && room && (
          <div className="join-invite">
            {room.address ? (
              <>
                <QrCode value={joinLink(room.address, room.port, roomCode(match.config.seed))} />
                <p className="hint">
                  Scan this to join from a phone or laptop — no install needed.
                  Or open <code>{room.address}:{room.port}</code> in a browser on
                  this Wi-Fi.
                </p>
              </>
            ) : (
              <p className="hint">
                This device has no Wi-Fi address, so browsers cannot reach it.
                Nearby installed apps can still join with the room code.
              </p>
            )}
            <p className="hint">
              Port {room.port}. Nearby devices find this automatically on the
              Join screen; if one doesn't see it, it can enter this device's own
              Wi-Fi address as{" "}
              <code>address:{room.port}@{roomCode(match.config.seed)}</code>.
            </p>
          </div>
        )}
        {role === "local" && (
          <p className="hint">Pass this device to the next player when it's their turn.</p>
        )}
      </section>

      <section className="roster">
        <h3>Players</h3>
        <ul className="players">
          {match.players.map((player) => (
            <li key={player.id} className={player.connected ? "" : "is-away"}>
              <span className="pip" style={{ background: seatColour(player.seat) }} />
              <span className="player-name">
                {player.name}
                {player.id === me ? " (you)" : ""}
              </span>
              {!player.connected && <span className="hint">away</span>}
              {role === "local" &&
                session.profiles.some((p) => p.id === player.id && p.kind === "guest") && (
                  <button
                    type="button"
                    className="remove-player"
                    aria-label={`Remove ${player.name}`}
                    onClick={() => {
                      session.removeGuest(player.id)
                      client.setSeats(client.state.seats.filter((seat) => seat !== player.id))
                      client.send({ _tag: "Leave", playerId: player.id })
                    }}
                  >
                    ×
                  </button>
                )}
            </li>
          ))}
          {match.players.length === 0 && <li className="hint">Waiting for players to join…</li>}
        </ul>
        {role === "local" && (
          <form
            className="add-player"
            onSubmit={(event) => {
              event.preventDefault()
              const name = guestName.trim()
              if (!name || match.players.length >= 6) return
              const guest = session.addGuest(name)
              client.setSeats([...client.state.seats, guest.id])
              client.send({ _tag: "Join", playerId: guest.id, name: guest.name })
              setGuestName("")
            }}
          >
            <input
              value={guestName}
              maxLength={14}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Add a player"
              aria-label="New player name"
            />
            <button
              type="submit"
              className={cx(button({ variant: "secondary", size: "md" }), css({ flex: "none", width: "tap", paddingInline: "0" }))}
              aria-label="Add player"
              disabled={!guestName.trim() || match.players.length >= 6}
            >
              <Plus size={18} aria-hidden />
            </button>
          </form>
        )}
      </section>

      <section className="rules">
        <h3>Rule modules</h3>
        <ul
          className={css({
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "2",
          })}
        >
          {allModules.map((module) => {
            const active = match.config.modules.includes(module)
            return (
              <li key={module}>
                <button
                  type="button"
                  className={cx(
                    button({ variant: "toggle", size: "md" }),
                    css({ width: "100%", justifyContent: "space-between" }),
                    active ? onColour : undefined,
                  )}
                  disabled={!canHost}
                  aria-pressed={active}
                  onClick={() => toggleModule(module)}
                >
                  <span>{moduleLabels[module]}</span>
                  <span className={active ? undefined : css({ color: "textDim" })}>
                    {active ? "On" : "Off"}
                  </span>
                </button>
                {/* Blurb on demand: the four paragraphs that used to sit here
                    permanently are what pushed Start below the fold. */}
                <details>
                  <summary className={css({ fontSize: "xs", color: "textDim", cursor: "pointer", paddingBlock: "1" })}>
                    What this does
                  </summary>
                  <p className="hint">{moduleBlurbs[module]}</p>
                </details>
              </li>
            )
          })}
        </ul>
      </section>

      {canHost ? (
        <button
          type="button"
          className="primary start"
          disabled={match.players.length < 1}
          onClick={() => {
            client.send({ _tag: "Start" })
            client.lock()
          }}
        >
          Start match
        </button>
      ) : (
        <p className="hint">Waiting for the host to start the match…</p>
      )}
    </main>
  )
}
