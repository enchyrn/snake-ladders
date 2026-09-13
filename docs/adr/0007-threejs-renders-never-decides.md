# 0007. Three.js renders; it never decides

## Status

Accepted

## Context

The board is rendered as an animated 3D scene — snakes, ladders, dice, and tokens — and it has to run acceptably on phone hardware, which is far more constrained than a desktop GPU.

## Decision

The scene is written as a pure function of match state plus a replayed timeline of events that the engine has already produced; the renderer consumes decisions, it does not make them. Board text — tile numbers, minesweeper adjacency counts — is drawn once into a single 2D canvas and uploaded as one texture, rather than being built as a hundred individual label meshes. The pixel ratio the renderer draws at is capped at 2, regardless of the device's actual native pixel ratio.

## Consequences

Because the scene only consumes already-decided outcomes, an animation that stutters, gets skipped under load, or is interrupted partway through cannot change what actually happened in the match — the renderer is structurally kept off the correctness path established in ADR 0001. Text rendered this way is effectively free at draw time and only needs to be redrawn when the underlying board state that produced it actually changes, instead of on every frame.

The cost is twofold. First, the single canvas texture has to be invalidated deliberately whenever the board state it depicts changes — there's no automatic dirty-tracking, so a code path that mutates state without triggering that invalidation will leave stale text on screen. Second, the renderer ends up duplicating a small piece of board-geometry knowledge that also lives in the engine: the boustrophedon (back-and-forth) numbering of tiles has to be known by the renderer to lay out text and token positions correctly, and by the engine to compute movement. That's a second place the same fact can go stale or diverge if the board layout ever changes, and nothing currently enforces that the two stay in sync beyond developer discipline and tests.
