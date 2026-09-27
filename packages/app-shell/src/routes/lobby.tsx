import { useAtom, useAtomValue } from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { Fragment, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, Minus, Plus, X } from "lucide-react"
import { ColourPicker } from "../app/colour-picker"
import { roomCode } from "../app/hooks"
import { joinLink } from "../app/join-link"
import { useSession } from "../app/session"
import { allModules, moduleBlurbs, moduleLabels, type RuleModule } from "@mutation/engine/primitives"
import type { Action } from "@mutation/engine/actions"
import type { MatchConfig } from "@mutation/engine/types"
import { QrCode } from "@mutation/ui/QrCode"
import { playerColours, seatColour } from "@mutation/render/palette"
import { matchAtom, meAtom, phaseAtom, roleAtom, roomAtom } from "../store/atoms"
import { loadLastSetup, saveLastSetup, saveSettings, settingsAtom } from "../store/settings"
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

const settingsListClass = css({ display: "flex", flexDirection: "column", gap: "2" })
const settingRowClass = css({ display: "flex", alignItems: "center", gap: "2", minHeight: "tap" })
const settingLabelClass = css({ flex: 1 })
const stepperControlsClass = css({ display: "flex", alignItems: "center", gap: "1" })
const stepperButtonClass = cx(button({ variant: "toggle", size: "md" }), css({ flex: "none", width: "tap", paddingInline: "0" }))
const stepperValueClass = css({ minWidth: "2.5em", textAlign: "center", fontWeight: 600 })

/** A -/+ pair either side of the value, rather than a segmented row of every
 *  possible value (mineCount alone has 41) or a bare `<input type="range">`,
 *  which reads its value to nobody unless it is also labelled. Each button is
 *  its own 44px tap target, matching every other control on this screen. */
const Stepper = ({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly disabled: boolean
  readonly onChange: (value: number) => void
}) => (
  <div className={settingRowClass}>
    <span className={settingLabelClass}>{label}</span>
    <div role="group" aria-label={label} className={stepperControlsClass}>
      <button
        type="button"
        className={stepperButtonClass}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus size={18} aria-hidden="true" />
      </button>
      <span className={stepperValueClass} aria-live="polite">{value}</span>
      <button
        type="button"
        className={stepperButtonClass}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  </div>
)

/** Same row shape as `Stepper`, for the one boolean left in `MatchConfig`. */
const ToggleSetting = ({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: boolean
  readonly disabled: boolean
  readonly onChange: (value: boolean) => void
}) => (
  <div className={settingRowClass}>
    <span className={settingLabelClass}>{label}</span>
    <button
      type="button"
      aria-pressed={value}
      className={cx(button({ variant: "toggle", size: "md" }), css({ flex: "none" }), value ? onColour : undefined)}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      {value ? "On" : "Off"}
    </button>
  </div>
)

/** `""` means "By seat", which the wire says by leaving the field out: an older
 *  build then decodes the same Join it always did. */
const join = (playerId: string, name: string, colour: string): Action =>
  colour === "" ? { _tag: "Join", playerId, name } : { _tag: "Join", playerId, name, colour }

export const LobbyScreen = () => {
  const session = useSession()
  const navigate = useNavigate()
  const client = session.client

  const match = useAtomValue(matchAtom)
  const phase = useAtomValue(phaseAtom)
  const role = useAtomValue(roleAtom)
  const me = useAtomValue(meAtom)
  const room = useAtomValue(roomAtom)
  const [settings, setSettings] = useAtom(settingsAtom)
  // One picker open at a time, keyed by player id — a second open palette
  // would be the lobby's fourth disclosure competing for the fold.
  const [pickingFor, setPickingFor] = useState<string | null>(null)
  const [guestName, setGuestName] = useState("")
  const [expandedModules, setExpandedModules] = useState<ReadonlySet<RuleModule>>(() => new Set())
  // Collapsed by default: with every module on (defaultConfig), four permanent
  // rows here pushed Start below the fold at 390x844 — the same trap the
  // module-row comment below already names. A one-line summary stays visible
  // either way, so a peer reads the current values without expanding anything.
  const [settingsExpanded, setSettingsExpanded] = useState(false)

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
    // Only the owner's colour is remembered; a guest profile is whoever is
    // holding the phone this time, so it starts on its seat colour.
    for (const identity of identities) {
      const colour = identity.id === session.identity.playerId ? settings.colour : ""
      client.send(join(identity.id, identity.name, colour))
    }
  }, [client, navigate, role, session.identity.playerId, session.identity.name, session.profiles, settings.colour])

  useEffect(() => {
    if (phase !== "lobby") void navigate({ to: "/match" })
  }, [phase, navigate])

  // Same one-shot shape as the Join effect above: applied once, and only
  // once — a later Configure (a module toggle, a stepper tap) must not be
  // clobbered by a stale lastSetup on some later re-render. `{ ...match.config,
  // ...lastSetup }` spreads onto the *live* config, never a bare defaultConfig,
  // so `seed` — the room code — always survives even though lastSetup omits it.
  const appliedLastSetup = useRef(false)
  useEffect(() => {
    if (!client || !canHost || phase !== "lobby" || appliedLastSetup.current) return
    appliedLastSetup.current = true
    const lastSetup = loadLastSetup()
    if (Object.keys(lastSetup).length === 0) return
    client.send({ _tag: "Configure", config: { ...match.config, ...lastSetup } })
  }, [client, canHost, phase, match.config])

  if (!client) return null

  // A UI gate only (Step 6 / ADR 0009): the engine's Configure case checks
  // phase, not who sent it, so a peer that sent one would still be applied
  // everywhere. This just keeps a peer's own screen from proposing changes
  // nobody there expects to see take effect.
  const setConfig = (patch: Partial<MatchConfig>) => {
    if (!canHost) return
    client.send({ _tag: "Configure", config: { ...match.config, ...patch } })
  }

  const toggleModule = (module: RuleModule) => {
    const modules = match.config.modules.includes(module)
      ? match.config.modules.filter((m) => m !== module)
      : [...match.config.modules, module]
    setConfig({ modules })
  }

  // The swatches this device may change: its own seat, or in pass-and-play
  // every profile on it. A peer's colour is theirs to pick on their phone.
  const owns = (playerId: string) =>
    role === "local" ? session.profiles.some((p) => p.id === playerId) : playerId === session.identity.playerId

  // A pick is a re-Join, which the reducer treats as a reconnect: same seat,
  // same name, new colour. Sent, never applied locally — the pip changes when
  // the log comes back, like every other action.
  const pickColour = (playerId: string, name: string, colour: string) => {
    client.send(join(playerId, name, colour))
    if (playerId === session.identity.playerId) {
      // Same shape as the settings panel's setField: next from this render's
      // value, saved as a sibling statement rather than inside an updater.
      const next = { ...settings, colour }
      setSettings(next)
      saveSettings(next)
    }
    setPickingFor(null)
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
  // An owned row already stands a tap target tall on its pip button, so it
  // drops the padding a text-only row needs; padding on top of 44px is what
  // pushed Start toward the fold in pass-and-play.
  const ownedRowClass = css({ display: "flex", alignItems: "center", gap: "0.5em", paddingBlock: "0" })
  const pipClass = css({ width: "0.7em", height: "0.7em", borderRadius: "50%", flex: "none" })
  // The pip itself is the control, rather than a separate "Colour" button the
  // row has no width for; the dot grows only enough to read as pressable.
  const pipButtonClass = cx(
    button({ variant: "ghost", size: "sm" }),
    // Pulls the dot back to where an unowned row's pip starts.
    css({ flex: "none", width: "tap", paddingInline: "0", marginLeft: "-13px" }),
  )
  const ownedPipClass = css({ width: "1.1rem", height: "1.1rem", borderRadius: "50%", flex: "none" })
  const colours = playerColours(match.players)
  const removePlayerClass = cx(
    button({ variant: "ghost", size: "sm" }),
    css({ flex: "none", width: "tap", paddingInline: "0" }),
  )
  const addPlayerClass = css({ display: "flex", gap: "2", marginTop: "0.6rem" })

  // Always visible, even collapsed — a peer (or the host, before expanding)
  // can still read what the match is set to.
  const settingsSummary = [
    `${match.config.size}×${match.config.size} board`,
    match.config.modules.includes("minesweeper") ? `${match.config.mineCount} mines` : null,
    match.config.modules.includes("mutation") ? `breathes every ${match.config.mutationInterval}` : null,
    match.config.exactFinish ? "exact finish" : "any finish",
  ]
    .filter((part): part is string => part !== null)
    .join(" · ")

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
          {match.players.map((player) => {
            const colour = colours.get(player.id) ?? seatColour(player.seat)
            const picking = pickingFor === player.id
            return (
              <Fragment key={player.id}>
                <li className={owns(player.id) ? ownedRowClass : playerRowClass}>
                  {owns(player.id) ? (
                    <button
                      type="button"
                      className={pipButtonClass}
                      aria-expanded={picking}
                      aria-label={`Colour for ${player.name}`}
                      onClick={() => setPickingFor(picking ? null : player.id)}
                    >
                      <span className={ownedPipClass} style={{ background: colour }} />
                    </button>
                  ) : (
                    <span className={pipClass} style={{ background: colour }} />
                  )}
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
                        <X size={18} aria-hidden="true" />
                      </button>
                    )}
                </li>
                {picking && (
                  <li>
                    {/* Pressed shows what was asked for; the pip above shows
                        what was granted, which differs only when someone
                        earlier in the lobby already holds that colour. */}
                    <ColourPicker
                      label={`Colour for ${player.name}`}
                      value={player.colour ?? ""}
                      onChange={(hex) => pickColour(player.id, player.name, hex)}
                    />
                  </li>
                )}
              </Fragment>
            )
          })}
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

      <section>
        {/* One disclosure for the whole section, not a per-row one like the
            modules below: unlike a module's blurb, these rows are controls
            themselves, not read-only prose — leaving them permanently open
            is what pushed Start off screen at 390x844 in the first pass.
            The summary paragraph carries the current values whether or not
            this is expanded, so collapsing it costs nobody a reading. */}
        <button
          type="button"
          className={cx(button({ variant: "ghost", size: "md" }), css({ width: "100%", justifyContent: "space-between", paddingInline: "0" }))}
          aria-expanded={settingsExpanded}
          onClick={() => setSettingsExpanded((v) => !v)}
        >
          {/* The `ghost` variant dims its own text (`color: textDim`) for an
              icon-only button elsewhere; here the button wraps a heading, and
              inheriting that dimming is what would make this the one section
              title on the screen that doesn't read as one. */}
          <h3 className={cx(headingClass, css({ margin: 0, color: "text" }))}>Match settings</h3>
          <ChevronDown
            size={18}
            aria-hidden
            className={css({ transition: "transform 0.15s", flex: "none" })}
            style={{ transform: settingsExpanded ? "rotate(180deg)" : undefined }}
          />
        </button>
        <p className={cx(paragraphClass, hintClass)}>{settingsSummary}</p>
        {settingsExpanded && (
          <div className={settingsListClass}>
            <Stepper
              label="Board size"
              value={match.config.size}
              min={5}
              max={12}
              disabled={!canHost}
              onChange={(size) => setConfig({ size })}
            />
            {match.config.modules.includes("minesweeper") && (
              <Stepper
                label="Mines"
                value={match.config.mineCount}
                min={0}
                max={40}
                disabled={!canHost}
                onChange={(mineCount) => setConfig({ mineCount })}
              />
            )}
            {match.config.modules.includes("mutation") && (
              <Stepper
                label="Board breathes every"
                value={match.config.mutationInterval}
                min={1}
                max={50}
                disabled={!canHost}
                onChange={(mutationInterval) => setConfig({ mutationInterval })}
              />
            )}
            <ToggleSetting
              label="Exact finish"
              value={match.config.exactFinish}
              disabled={!canHost}
              onChange={(exactFinish) => setConfig({ exactFinish })}
            />
          </div>
        )}
      </section>

      {canHost ? (
        <button
          type="button"
          className={cx(button({ variant: "primary", size: "md" }), css({ width: "100%" }))}
          disabled={match.players.length < 1}
          onClick={() => {
            saveLastSetup(match.config)
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
