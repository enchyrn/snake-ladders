/**
 * Types for `lan-relay.mjs`, which is plain JavaScript and stays that way: it
 * is the one file a player may be asked to run with bare `node`, so it has no
 * build step.
 *
 * `tsconfig.json` points `@mutation/relay` at this file rather than at the
 * `.mjs`, because a `paths` entry naming a concrete `.mjs` resolves that file
 * and, with `allowJs` off, reads it as untyped however the declaration beside
 * it is named. The vitest alias still points at the `.mjs` — that one resolves
 * the code that actually runs.
 */

export declare const PROTOCOL_VERSION: number

export declare const roomCode: (seed: number) => string

export declare const randomRoom: () => string

export interface RosterEntry {
  readonly player_id: string
  readonly name: string
  readonly connected: boolean
}

export interface SequencedEntry {
  readonly seq: number
  readonly action: unknown
}

export type JoinResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** Every frame `Sequencer` itself sends. `startRelay`'s own `rejected` and
 * `pong` frames go straight to the socket, not through here. */
export type SequencerFrame =
  | { readonly t: "welcome"; readonly player_id: string; readonly room: string; readonly log: SequencedEntry[] }
  | { readonly t: "roster"; readonly peers: RosterEntry[] }
  | { readonly t: "commit"; readonly seq: number; readonly action: unknown }

export declare class Sequencer {
  constructor(options?: { room?: string; capacity?: number })
  get room(): string
  get log(): SequencedEntry[]
  get locked(): boolean
  lock(): void
  roster(): RosterEntry[]
  join(client: {
    playerId: string
    name: string
    send: (frame: SequencerFrame) => void
  }): JoinResult
  submit(action: unknown): SequencedEntry
  leave(playerId: string): void
}

export declare const lanAddresses: () => string[]

export interface RelayHandle {
  readonly wss: { close: (cb?: () => void) => void }
  readonly sequencer: Sequencer
  /** Resolves once the socket has bound, which is when `port` is real. */
  readonly listening: Promise<void>
  /** The bound port — the OS's choice, when `port: 0` was asked for. */
  readonly port: number
}

export declare const startRelay: (options?: {
  port?: number
  room?: string
  capacity?: number
}) => RelayHandle
