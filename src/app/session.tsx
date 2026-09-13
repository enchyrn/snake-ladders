import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { Effect } from "effect"
import { MatchClient } from "@/store/match-client"
import { isTauri, makeLanTransport } from "@/net/lan"
import { makeLocalTransport } from "@/net/local"
import type { TransportService } from "@/net/transport"
import { loadIdentity, saveIdentity, type LocalIdentity } from "@/net/identity"
import { defaultConfig, type MatchConfig } from "@/engine/types"
import type { Role } from "@/store/match-client"

interface SessionValue {
  readonly identity: LocalIdentity
  readonly rename: (name: string) => void
  readonly client: MatchClient | null
  /** True when running inside Tauri, where LAN play is available. */
  readonly networked: boolean
  readonly open: (opts: {
    role: Role
    seed: number
    config?: Partial<MatchConfig>
  }) => MatchClient
  readonly transport: () => TransportService
  readonly close: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

/**
 * Owns the one transport and the one match client for the app.
 *
 * There is deliberately no global singleton: leaving a room disposes the
 * client and its subscriptions, so a second match cannot inherit a stale
 * fold position from the first.
 */
export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [identity, setIdentity] = useState<LocalIdentity>(() => loadIdentity())
  const [client, setClient] = useState<MatchClient | null>(null)
  const transportRef = useRef<TransportService | null>(null)
  const networked = useMemo(() => isTauri(), [])

  const transport = (): TransportService => {
    if (!transportRef.current) {
      transportRef.current = networked ? makeLanTransport() : makeLocalTransport()
    }
    return transportRef.current
  }

  const value: SessionValue = {
    identity,
    networked,
    client,
    rename: (name) => {
      const next = { ...identity, name }
      setIdentity(next)
      saveIdentity(next)
    },
    transport,
    open: ({ role, seed, config }) => {
      client?.dispose()
      const fresh = new MatchClient(
        transport(),
        { ...defaultConfig(seed), ...config },
        role,
        identity.playerId,
      )
      setClient(fresh)
      return fresh
    },
    close: () => {
      client?.dispose()
      setClient(null)
      const active = transportRef.current
      if (active) Effect.runPromise(active.leave).catch(() => undefined)
      transportRef.current = null
    },
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = (): SessionValue => {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside a SessionProvider")
  return value
}
