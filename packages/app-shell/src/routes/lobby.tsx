import { useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, Plus } from "lucide-react"
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
import {
  barClass,
  codeClass,
  headingClass,
  hintClass,
  paragraphClass,
  screenClass,
  textInputClass,
} from "@mutation/ui/layout/screen"

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
  const [expandedModules, setExpandedModules] = useState<ReadonlySet<RuleModule>>(() => new Set())

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

  const toggleExpanded = (module: RuleModule) => {
    setExpandedModules((prev) => {
      const next = new Set(prev)
      if (next.has(module)) next.delete(module)
      else next.add(module)
      return next
    })
  }

  const roomShareClass = css({
    border: "1px solid",
    borderColor: "border",
    borderRadius: "12px",
    padding: "4",
    background: "surface",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  })
  const roomShareLabelClass = css({ color: "textDim", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em" })
  const roomCodeDisplayClass = css({ fontSize: { base: "1.8rem", sm: "2.2rem" }, fontWeight: 700, letterSpacing: "0.12em" })
  const joinInviteClass = css({ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem" })
  const playersClass = css({ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: "0.15rem" })
  const playerRowClass = css({ display: "flex", alignItems: "center", gap: "0.5em", padding: "0.3rem 0" })
  const pipClass = css({ width: "0.7em", height: "0.7em", borderRadius: "50%", flex: "none" })
  const removePlayerClass = css({
    flex: "none",
    padding: "0.1em 0.5em",
    fontSize: "1rem",
    lineHeight: 1.4,
    background: "transparent",
    border: "1px solid #2a3b4d",
    borderRadius: "0.4em",
    color: "inherit",
    opacity: 0.7,
    _hover: { opacity: 1 },
  })
  const addPlayerClass = css({ display: "flex", gap: "2", marginTop: "0.6rem" })

  return (
    <main className={screenClass}>
      <header className={barClass}>
        <button type="button" className={button({ size: "md" })} onClick={leave}>
          <ChevronLeft size={16} aria-hidden="true" /> Leave
        </button>
        <h2 className={headingClass}>Lobby</h2>
      </header>

      <NoticeBanner />
      <DesyncBanner />

      <section className={roomShareClass}>
        <span className={roomShareLabelClass}>Room code</span>
        <span className={roomCodeDisplayClass}>{roomCode(match.config.seed)}</span>
        {role === "host" && room && (
          <div className={joinInviteClass}>
            {room.address ? (
              <>
                <QrCode value={joinLink(room.address, room.port, roomCode(match.config.seed))} />
                <p className={cx(paragraphClass, hintClass)}>
                  Scan this to join from a phone or laptop — no install needed.
                  Or open <code className={codeClass}>{room.address}:{room.port}</code> in a browser on
                  this Wi-Fi.
                </p>
              </>
            ) : (
              <p className={cx(paragraphClass, hintClass)}>
                This device has no Wi-Fi address, so browsers cannot reach it.
                Nearby installed apps can still join with the room code.
              </p>
            )}
            <p className={cx(paragraphClass, hintClass)}>
              Port {room.port}. Nearby devices find this automatically on the
              Join screen; if one doesn't see it, it can enter this device's own
              Wi-Fi address as{" "}
              <code className={codeClass}>address:{room.port}@{roomCode(match.config.seed)}</code>.
            </p>
          </div>
        )}
        {role === "local" && (
          <p className={cx(paragraphClass, hintClass)}>Pass this device to the next player when it's their turn.</p>
        )}
      </section>

      <section>
        <h3 className={headingClass}>Players</h3>
        <ul className={playersClass}>
          {match.players.map((player) => (
            <li key={player.id} className={playerRowClass}>
              <span className={pipClass} style={{ background: seatColour(player.seat) }} />
              <span className={css({ flex: 1 })}>
                {player.name}
                {player.id === me ? " (you)" : ""}
              </span>
              {!player.connected && <span className={hintClass}>away</span>}
              {role === "local" &&
                session.profiles.some((p) => p.id === player.id && p.kind === "guest") && (
                  <button
                    type="button"
                    className={removePlayerClass}
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
          {match.players.length === 0 && <li className={hintClass}>Waiting for players to join…</li>}
        </ul>
        {role === "local" && (
          <form
            className={addPlayerClass}
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
              className={cx(textInputClass, css({ flex: 1, minWidth: 0 }))}
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

      <section>
        <h3 className={headingClass}>Rule modules</h3>
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
            const expanded = expandedModules.has(module)
            return (
              <li key={module}>
                {/* The state toggle and the blurb disclosure are two
                    different actions, so they're two tap targets in one
                    44px-tall row rather than one stacked on the other — a
                    permanent second row per module (even a small one) is
                    what pushed Start below the fold before. */}
                <div className={css({ display: "flex", gap: "1" })}>
                  <button
                    type="button"
                    className={cx(
                      button({ variant: "toggle", size: "md" }),
                      css({ flex: 1, justifyContent: "space-between" }),
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
                  <button
                    type="button"
                    className={cx(button({ variant: "ghost", size: "md" }), css({ flex: "none", width: "tap", paddingInline: "0" }))}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} what ${moduleLabels[module]} does`}
                    onClick={() => toggleExpanded(module)}
                  >
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className={css({ transition: "transform 0.15s" })}
                      style={{ transform: expanded ? "rotate(180deg)" : undefined }}
                    />
                  </button>
                </div>
                {expanded && <p className={cx(paragraphClass, hintClass)}>{moduleBlurbs[module]}</p>}
              </li>
            )
          })}
        </ul>
      </section>

      {canHost ? (
        <button
          type="button"
          className={cx(button({ variant: "primary", size: "md" }), css({ width: "100%" }))}
          disabled={match.players.length < 1}
          onClick={() => {
            client.send({ _tag: "Start" })
            client.lock()
          }}
        >
          Start match
        </button>
      ) : (
        <p className={cx(paragraphClass, hintClass)}>Waiting for the host to start the match…</p>
      )}
    </main>
  )
}
