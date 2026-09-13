# 0003. Momentum stays integer arithmetic, not physics

## Status

Accepted

## Context

The momentum twist wants a token to overshoot its landing tile and bounce back, giving movement some weight and unpredictability. The obvious way to build that is a physics solver driving token position directly.

## Decision

Landing tiles are computed with plain integer arithmetic inside the engine, following the same deterministic-reducer rules as the rest of the game (ADR 0001). Three.js is given the already-decided final tile and renders an overshooting arc as a visual flourish on top of it — the arc is decoration, not computation, and it never feeds a result back into game state.

## Consequences

Because the outcome is integer math inside the shared deterministic engine, every device agrees on the landing tile exactly, with none of the cross-platform floating-point drift a real physics solver would introduce (different devices' floating-point units, or even the same solver run in a different order, do not reliably produce bit-identical results).

The cost is that the motion is visibly less physically expressive than a genuine solver would produce — the bounce is a fixed, authored arc rather than an emergent one, so it can't react to variable mass, collisions between tokens, or surface irregularities the way real physics would. It also puts a standing burden on whoever touches the renderer: the temptation to let the animation influence timing-sensitive gameplay (for example, resolving the next action before the bounce animation finishes, or deriving a value from the animated position) has to be actively resisted, because doing so would reintroduce the exact non-determinism this decision exists to avoid.
