# 0004. Rust relay orders actions and nothing else

## Status

Accepted

## Context

With no server, something still has to decide the single order in which player actions apply — two phones tapping "roll" within milliseconds of each other need one agreed sequence, not two. Three shapes were considered: a fully authoritative server implemented in Rust that runs the rules and tells clients the outcome; a peer-to-peer consensus protocol where devices agree on order among themselves; or a pure sequencer that does nothing but assign order.

## Decision

We chose the pure sequencer. One device acts as host for the match and does exactly one job: assign each incoming action a sequence number and fan the numbered log back out to every device, itself included. The host holds no game state and knows no rules — actions pass through it as opaque JSON. Every device, host included, folds the same numbered log through the same TypeScript engine described in ADR 0001 to arrive at match state.

## Consequences

There is exactly one implementation of the rules in the whole system — the TypeScript engine — so there is no way for a Rust ruleset and a TypeScript ruleset to quietly disagree, because a second ruleset never exists. The Rust crate that does the sequencing stays small enough to read in full and reason about, which matters because it is the one piece of shared trust in an otherwise fully replicated system.

The cost is that the host device is a single point of failure for the match: if it disconnects or crashes, sequencing stops and the match cannot progress until a new host is established (host migration is out of scope for this decision). It also means a desync between the host's accepted order and what a given peer computes can only be detected after the fact by that peer re-deriving state — the sequencer itself has no way to know the rules well enough to catch a problem early. This is why an action the host accepted but a peer's engine rejects is treated as a loud, visible failure rather than silently dropped or ignored — silently skipping it would hide exactly the class of bug this architecture is otherwise designed to make impossible.
