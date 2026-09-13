# 0008. Effect Atom for UI state, alongside TanStack

## Status

Accepted

## Context

The app already uses Effect TS for the engine (ADR 0001) and for the networking transport layer. UI state, however, started out as a hand-rolled class combined with a TanStack Store, which left the codebase with two separate state-management idioms and required manually wiring up and tearing down subscriptions between them.

## Decision

We adopted `@effect-atom/atom-react` for reactive UI state, so the UI layer speaks the same idiom as the engine and transport layers instead of a third one. TanStack is kept for the jobs it's already the best tool for: Router for navigation, and Query for polling LAN discovery results.

## Consequences

The app now has one state idiom running end to end, from the engine through the transport to the UI, and Effect's structured error handling and resource management (fibers, scopes, cleanup) reach all the way into UI code instead of stopping at the transport boundary and needing to be re-translated into ad hoc React state handling.

The cost is that Effect Atom is pre-1.0 — version 0.7.0 at the time of writing — so its API can and likely will move before a stable release, and any breaking change lands as unplanned migration work rather than a routine dependency bump. It is also one more concept a contributor has to learn on top of Effect itself: understanding Effect's core model (effects, fibers, layers) is already a barrier for newcomers, and Atom adds its own subscription and reactivity model on top of that, rather than reusing something contributors might already know from plain React or Redux.
