import { useNavigate } from "@tanstack/react-router"
import { Effect, Either } from "effect"
import { useState } from "react"
import { unexpected } from "@mutation/net/transport"
import { useSession } from "../app/session"
import { randomSeed } from "../app/hooks"
import { button } from "styled-system/recipes"
import { css, cx } from "styled-system/css"

export const HomeScreen = () => {
  const session = useSession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Pass-and-play and Wi-Fi hosting differ in the transport they need, not
   * just in whether a room is opened. Sending pass-and-play through the LAN
   * transport left every action submitted to a room that was never opened.
   */
  const startMatch = async (kind: "local" | "network") => {
    setBusy(kind)
    setError(null)
    const seed = randomSeed()
    try {
      if (kind === "network") {
        const hosted = await Effect.runPromise(
          Effect.either(
            session
              .transport("network")
              .host({ seed, name: session.identity.name, capacity: 6 }),
          ),
        )
        if (Either.isLeft(hosted)) {
          setError(hosted.left.reason)
          return
        }
        // The client is created after hosting resolves, so the room it is
        // stamped with always matches the seed it was actually opened with.
        session.open({ role: "host", seed, kind }).setRoom(hosted.right)
      } else {
        session.open({ role: "local", seed, kind })
      }
      await navigate({ to: "/lobby" })
    } catch {
      // A defect, not a TransportError. Effect renders one as its own cause
      // dump, which in a production bundle is a minified stack trace — worse
      // for the player than admitting there is nothing useful to say.
      setError(unexpected)
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="screen home">
      <header className="brand">
        <h1>
          Snakes &amp; Ladders
          <span className="brand-sub">Mutation</span>
        </h1>
        <p className="tagline">
          The board fights back. No internet, no accounts — just the phones in the room.
        </p>
      </header>

      <label className="field">
        <span>Your name</span>
        <input
          value={session.identity.name}
          maxLength={14}
          onChange={(e) => session.rename(e.target.value)}
          placeholder="Adder"
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className={button({ variant: "primary", size: "lg" })}
          disabled={busy !== null}
          onClick={() => void startMatch("local")}
        >
          {busy === "local" ? "Starting…" : "Pass and play on this device"}
        </button>
        <button
          type="button"
          className={button({ variant: "secondary", size: "md" })}
          disabled={busy !== null || !session.canJoin}
          onClick={() => void navigate({ to: "/join" })}
        >
          Join a game
        </button>
        <button
          type="button"
          className={cx(
            button({ variant: "secondary", size: "md" }),
            css({ flexDirection: "column", gap: "1", paddingBlock: "2" }),
          )}
          disabled={busy !== null || !session.canHost}
          title={!session.canHost ? "Browsers can't open the socket other devices connect to" : undefined}
          onClick={() => void startMatch("network")}
        >
          <span>{busy === "network" ? "Opening…" : "Host on Wi-Fi"}</span>
          {!session.canHost && (
            <span className={css({ fontSize: "xs", fontWeight: 400, color: "textDim" })}>
              Needs the installed app — browsers can't host
            </span>
          )}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
