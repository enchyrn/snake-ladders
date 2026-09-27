/**
 * Types for the parts of `drive-app.mjs` the suite imports. The script is
 * plain JavaScript because it runs under bare `node` in CI and locally, so
 * nothing else of it is declared here.
 */

export interface ServedDist {
  // https.Server extends tls.Server, not http.Server, so the https: true
  // path in drive-app.mjs (createTlsServer) returns a value the http-only
  // type would reject.
  readonly server: import("node:http").Server | import("node:https").Server
  readonly port: number
  readonly origin: string
}

export declare const serveDist: (options: {
  dist: string
  base?: string
  port?: number
  https?: boolean
}) => Promise<ServedDist>

export declare const clippedControls: (
  controls: ReadonlyArray<{ name: string; left: number; right: number; width: number }>,
  viewportWidth: number,
) => ReadonlyArray<string>

/** The page events the gate reads, as Playwright's `Page` emits them. */
export interface ProblemSource {
  on(event: "pageerror", listener: (error: Error) => void): unknown
  on(event: "response", listener: (response: { status(): number; url(): string }) => void): unknown
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): unknown
}

export declare const recordProblems: (page: ProblemSource, problems: string[], label?: string) => void
