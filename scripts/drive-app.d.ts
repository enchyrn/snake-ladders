/**
 * Types for the `serveDist` half of `drive-app.mjs`. The script is plain
 * JavaScript because it runs under bare `node` in CI and locally; only the
 * part the suite imports is declared here.
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
