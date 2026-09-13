# 0002. Each twist is a toggleable rule module over one engine

## Status

Accepted

## Context

The game ships four twists on classic Snakes & Ladders — mutation, simultaneous rolls, momentum, and a minesweeper overlay — with more planned. One way to build this is a separate game mode per twist, each with its own resolver. The alternative is one engine that every twist plugs into.

## Decision

Each twist is a flag in match config, implemented as a small module that the shared resolver composes at resolution time. A match can run any combination of twists, including none at all, which reduces to classic Snakes & Ladders with no special-casing required.

## Consequences

There is exactly one resolver to keep deterministic (see ADR 0001), rather than four-plus divergent ones. Combinations of twists become a testable matrix instead of a combinatorial explosion of hand-written modes, and a new twist is one more module rather than a new game to build and verify from scratch.

The cost is real, though. The resolver has to be written so modules compose in a fixed, well-defined order — an implicit or accidental order dependency between two modules is a bug waiting to surface only when both twists are on at once. Module interactions are a genuine source of defects, not a hypothetical one: a mine landing at the far end of a ladder had to be given an explicit rule to cancel momentum, because without it the two twists disagreed about where the token should end up. Every new twist added multiplies the number of pairwise (and eventually n-wise) interactions that need a decision and a test, and that surface grows faster than the twist count. The match config itself — which twists are on — also becomes part of the synced state, so getting it wrong or letting it drift between devices is now itself a desync risk on top of the action log.
