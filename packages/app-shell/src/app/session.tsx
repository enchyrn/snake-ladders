import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { RegistryContext } from "@effect-atom/atom-react"
import { Effect } from "effect"
import { MatchClient } from "@mutation/app-shell/store/match-client"
import { isTauri } from "@mutation/net/lan"
import { makeTransport, type TransportKind } from "@mutation/net/factory"
import type { TransportService } from "@mutation/net/transport"
import { loadIdentity, saveIdentity, type LocalIdentity } from "@mutation/net/identity"
import { defaultConfig, type MatchConfig } from "@mutation/engine/types"
import type { Role } from "@mutation/app-shell/store/match-client"

export type { TransportKind }

interface SessionValue {
  readonly identity: LocalIdentity
  readonly rename: (name: string) => void
  readonly client: MatchClient | null
  /** True when this build can host a room: only the installed app can. */
  readonly canHost: boolean
  /** True when this build can reach other devices at all. */
  readonly canJoin: boolean
  readonly open: (opts: {
    role: Role
    seed: number
    kind: TransportKind
    config?: Partial<MatchConfig>
  }) => MatchClient
  readonly transport: (kind: TransportKind) => TransportService
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
  const transports = useRef(new Map<TransportKind, TransportService>())
  const native = useMemo(() => isTauri(), [])
  // The one registry every `useAtomValue` in the tree reads through — a
  // client built with any other registry would fold in a state room nobody
  // is watching.
  const registry = useContext(RegistryContext)

  const transport = (kind: TransportKind): TransportService => {
    const existing = transports.current.get(kind)
    if (existing) return existing
    const made = makeTransport(kind, native)
    transports.current.set(kind, made)
    return made
  }

  const value: SessionValue = {
    identity,
    canHost: native,
    canJoin: true,
    client,
    rename: (name) => {
      const next = { ...identity, name }
      setIdentity(next)
      saveIdentity(next)
    },
    transport,
    open: ({ role, seed, kind, config }) => {
      client?.dispose()
      const fresh = new MatchClient(
        transport(kind),
        { ...defaultConfig(seed), ...config },
        role,
        identity.playerId,
        registry,
      )
      setClient(fresh)
      return fresh
    },
    close: () => {
      client?.dispose()
      setClient(null)
      for (const active of transports.current.values()) {
        Effect.runPromise(active.leave).catch(() => undefined)
      }
      transports.current.clear()
    },
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = (): SessionValue => {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside a SessionProvider")
  return value
}
