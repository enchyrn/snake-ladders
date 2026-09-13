import { useNavigate } from "@tanstack/react-router"
import { Effect } from "effect"
import { useState } from "react"
import { useSession } from "@/app/session"
import { randomSeed } from "@/app/hooks"
import { allModules, moduleBlurbs, moduleLabels } from "@/engine/primitives"

export const HomeScreen = () => {
  const session = useSession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startHosting = async (networked: boolean) => {
    setBusy(networked ? "hosting" : "local")
    setError(null)
    const seed = randomSeed()
    try {
      if (networked) {
        await Effect.runPromise(
          session.transport().host({ seed, name: session.identity.name, capacity: 6 }),
        )
      }
      session.open({ role: networked ? "host" : "local", seed })
      await navigate({ to: "/lobby" })
    } catch (cause) {
      setError(String(cause))
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
          className="primary"
          disabled={busy !== null || !session.networked}
          onClick={() => void startHosting(true)}
        >
          {busy === "hosting" ? "Opening…" : "Host on Wi-Fi"}
        </button>
        <button
          type="button"
          disabled={busy !== null || !session.networked}
          onClick={() => void navigate({ to: "/join" })}
        >
          Join a game
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void startHosting(false)}
        >
          {busy === "local" ? "Starting…" : "Pass and play on this device"}
        </button>
      </div>

      {!session.networked && (
        <p className="hint">
          Wi-Fi play needs the installed app. In a browser tab only pass-and-play
          is available, because a web page cannot open the sockets other devices
          connect to.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <section className="rules">
        <h2>The twists</h2>
        <dl>
          {allModules.map((module) => (
            <div key={module}>
              <dt>{moduleLabels[module]}</dt>
              <dd>{moduleBlurbs[module]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}
