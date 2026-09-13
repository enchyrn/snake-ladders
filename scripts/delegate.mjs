#!/usr/bin/env node
//
// Delegate a read-only task to OpenCode running a free OpenCode Zen model.
//
//   nub run delegate -- "where is the dice stream threaded through resolve?"
//   nub run delegate -- --agent review --file src/engine/resolve.ts "review this"
//
// This exists because `opencode run` fails in three quite different ways that
// all look alike from a script: the binary is missing, Zen is unreachable, or
// the account has no Zen access. Each needs a different fix, so each is
// checked for separately and reported as itself.
//
// Delegation is read-only by design. The agents in opencode.json have their
// write, edit, patch and bash tools switched off: a free model is a fine way
// to answer "where is X" or "does this diff break the determinism contract",
// and a poor way to edit an engine whose correctness rests on byte-identical
// state across devices.

import { spawn } from "node:child_process"
import { once } from "node:events"

const ZEN_HOST = "opencode.ai"
const DEFAULT_AGENT = "explore"

const argv = process.argv.slice(2)

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  console.log(`Usage: nub run delegate -- [--agent <name>] [--model <id>] [--file <path>] "<prompt>"

Agents (read-only, defined in opencode.json):
  explore   where something lives, how it is wired          [default]
  review    review a diff or file against CLAUDE.md's invariants

Any other 'opencode run' flag is passed straight through.`)
  process.exit(argv.length === 0 ? 1 : 0)
}

/** Resolve the binary, preferring the version mise pins over any global one. */
const resolveOpencode = async () => {
  for (const [cmd, args] of [
    ["mise", ["which", "opencode"]],
    ["opencode", ["--version"]],
  ]) {
    try {
      const probe = spawn(cmd, args, { stdio: "ignore" })
      const [code] = await once(probe, "close")
      // mise needs the binary named after `exec --`; a direct hit does not.
      if (code === 0) {
        return cmd === "mise"
          ? { cmd: "mise", prefix: ["exec", "--", "opencode"] }
          : { cmd: "opencode", prefix: [] }
      }
    } catch {
      // Not on PATH; try the next candidate.
    }
  }
  return null
}

/**
 * Zen is a hosted API, so delegation needs egress to it. Restricted
 * environments — a Claude Cloud container, for one — reach the npm registry
 * but refuse opencode.ai, and without this check that surfaces as an opaque
 * model error several seconds later.
 *
 * The probe has to go through the same proxy OpenCode itself uses. Node's
 * fetch ignores HTTPS_PROXY unless EnvHttpProxyAgent is switched on, and
 * probing around the proxy reports the sandbox's own refusal rather than the
 * policy — which reads as "blocked" for a host that is in fact allowed.
 */
const zenReachable = async () => {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy

  // With no proxy configured, fetch is already talking to the real network.
  if (!proxy) {
    try {
      const res = await fetch(`https://${ZEN_HOST}/`, {
        method: "HEAD",
        signal: AbortSignal.timeout(8000),
      })
      return res.status < 400
    } catch {
      return false
    }
  }

  // Ask the proxy to open a tunnel, which is exactly what it will be asked for
  // in earnest. A refused host answers the CONNECT with 403 rather than
  // failing to connect, so the status line is the answer.
  const { request } = await import("node:http")
  const target = new URL(proxy)

  return new Promise((resolve) => {
    const req = request({
      host: target.hostname,
      port: target.port || 80,
      method: "CONNECT",
      path: `${ZEN_HOST}:443`,
      timeout: 8000,
    })

    const settle = (value) => {
      req.destroy()
      resolve(value)
    }

    req.on("connect", (res, socket) => {
      socket.destroy()
      settle(res.statusCode === 200)
    })
    req.on("error", () => settle(false))
    req.on("timeout", () => settle(false))
    req.end()
  })
}

const bin = await resolveOpencode()
if (!bin) {
  console.error(`opencode is not installed.

  bash scripts/provision.sh

installs it, preferring mise and falling back to the npm package.`)
  process.exit(127)
}

if (!(await zenReachable())) {
  console.error(`Cannot reach ${ZEN_HOST}, so no Zen model can be called from here.

This is normally the environment's network policy rather than anything local —
a Claude Code on the web container blocks it, while a Codespace and a laptop do
not. Delegate from one of those instead.`)
  process.exit(69) // EX_UNAVAILABLE
}

// Only supply the default agent when the caller has not chosen one, so an
// explicit --agent still wins. Both spellings count: yargs accepts
// `--agent review` and `--agent=review`.
const choseAgent = argv.some((a) => a === "--agent" || a.startsWith("--agent="))
const args = ["run", ...(choseAgent ? [] : ["--agent", DEFAULT_AGENT]), ...argv]

const child = spawn(bin.cmd, [...bin.prefix, ...args], {
  stdio: "inherit",
})

const [code] = await once(child, "close")

// Zen rejects an unauthenticated caller at the model layer, which reads as a
// generic failure. Point at the fix rather than leaving the exit code bare.
if (code !== 0) {
  console.error(`
opencode exited ${code}. If it reported an authentication or access error, run:

  opencode auth login      # choose "OpenCode Zen"

Free Zen models still require an account, they just do not bill for tokens.`)
}

process.exit(code ?? 1)
