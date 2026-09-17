# Chrome and layout — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-17
**Governed by:** [ADR 0020](../../adr/0020-a-boardgame-not-a-number-game.md)
(the board is the primary channel) and
[ADR 0021](../../adr/0021-panda-css-and-lucide.md)
(Panda CSS `1.12.1` and Lucide).

This is **spec B of two**. Spec A
(`2026-09-16-settings-and-input-design.md`) covers the settings subsystem —
storage, semantics, which settings exist. This one covers how every screen is
laid out and what it is built from. The two meet in one place: spec A defines
the settings overlay's contents and grouping, this one lays it out.

**It also supersedes two earlier specs in part.** `renderer-legibility`
§Chrome and `share-and-start-menu` §"The start menu" are absorbed here rather
than competed with; where they disagree with this document, this one wins for
layout and they keep everything else (`renderer-legibility` keeps the camera,
the layering contract, link tinting and token variety, all of which remain
unbuilt and out of scope here).

**Layout reference:** the match screen is drawn, not described —
<https://claude.ai/artifact/MXucAxxrRbVbr1uo8ZYAAR>, artboard
"A — CHOSEN: edges + progress rows", at 390×844 in the game's own palette.
Prose below states the rules; the canvas states the proportions.

## The survey this starts from

Run on 2026-09-17 with `nub run build && nub run verify:ui` — in that order,
because `verify:ui` does not build — plus one throwaway driver pass for the
join screen, which the standard run never visits.

**Functional, not cosmetic:**

- **The join screen's empty room list renders nothing at all.** No spinner, no
  "searching", no empty state: a gap between the intro paragraph and the
  disclosure. A guest whose discovery fails cannot tell the app from a dead
  page.
- **Two of five cards sit off-screen.** `.cards` is `overflow-x: auto` so they
  are *reachable* — this was checked before it was claimed, and it is not the
  functional break it looks like. But `.roll` is `flex: none; min-width: 6rem`,
  leaving roughly 294px for roughly 440px of cards, and the only hint that more
  exist is a half-clipped "Double". A horizontal scroller nested inside a
  vertically scrolling screen, with no fade and no affordance, is found by
  accident.
- **The PWA toast overlays content on every screen.** It sits on the lobby's
  module list and on the join screen in the survey shots.

**ADR 0020 violations that live in the chrome rather than the renderer:**

- `PlayerStrip` renders position as a bare digit — "● Mamba 5".
- The log box sits above the board with more visual weight than it.
- The minefield legend is permanent and two rows, naming four symbols of which
  one is typically on screen.
- `.progress-bar` renders as a ~40px stub at 5%, reading as a rendering
  artifact rather than an indicator.

**Structural:**

- **No assets.** No `public/`, no icons, no fonts. Every glyph is an emoji in a
  text node — `☣ » ⚓ 💤 ⚑ ✸ ⟲ ‹` — rendering in the platform emoji font: a
  different picture per OS, un-recolourable, un-alignable.
- **Eight independently styled button classes**, no shared component. Join's
  button is small and left-aligned; home's are full-width slabs.
- Colour tokens exist; **no spacing scale, no type scale**; one media query in
  784 lines.
- The module toggle's "On" green sits in the band `renderer-legibility`
  reserves for link tinting.

## The geometry that decides the match screen

**The board is square and the phone is 1:2.2.** At 390 CSS px wide, with a
12px gutter each side, the board can be at most **366×366 — about 43% of the
height, and only drawn flat.**

Tilting it for perspective makes it **shorter, not taller**: today's tilt costs
roughly 90px of board height, which is why the survey shot shows a board of
about 240px with dead space above and below.

This was found by drawing the mockups, and it reframes the problem. "Make the
board fill the screen" was never available. **The question is what the other
~430px does**, and the answer is the layout.

## The match screen

Top to bottom, at 390×844:

| Band | Height | Contents |
|---|---|---|
| Header | 52 | Whose turn, round-log button, settings button |
| Progress rows | 20 per player, 9 gap, 12 pad | One row per player: seat swatch, name, filled bar |
| Board | **366, fixed** | The WebGL canvas, at full width |
| Log preview | whatever remains | The last two lines of the round |
| Control bar | 130 | Card rail, then dice tray and Roll |

**The budget closes, and it closes by arithmetic.** `match.ts:195` caps a match
at six players, so the worst case is bounded rather than open:

| Players | Rows | Remainder for the log preview |
|---|---|---|
| 2 | 61 | 235 |
| 3 | 90 | 206 |
| 6 | 177 | **119** |

Two log lines cost about 44px. So **the board keeps its full 366 at every legal
player count** — it never has to shrink, and the spec can say that rather than
hope it.

**The progress rows are the ADR 0020 fix.** They replace both the bare digit in
`PlayerStrip` and the 40px stub: a player reads the race off the bars' relative
lengths, not off numerals. The acting player's swatch carries a ring; the rest
are dimmed. No tile number appears here at all — tile numbers are on the board,
which is where a boardgame keeps them.

**The card rail flexes instead of scrolling.** Five cards at `flex: 1 1 0`
across 366px is ~70px each, above the 44px tap minimum, so every card is
visible at once and the survey's discoverability problem disappears by
construction rather than by adding a fade. A card that cannot be played is
rendered **disabled and still present** — under ADR 0020 a card vanishing is a
state change the player is not shown.

**The dice tray is a real `<button>` beside Roll.** Spec A requires this and
the reason is load-bearing rather than aesthetic: `RollButton` is today the
only keyboard-reachable path to `Commit`, and `Scene.pick` raycasts the board
plane only, so a canvas-picked tray would not be reachable at all. The tray is
an input affordance; `Dice.show` renders the outcome. They are different
objects and stay that way — an input control inside the renderer is what
ADR 0007 exists to prevent.

**The log preview takes the slack.** Even with three progress rows and a
full-size board, roughly 150px remains. It holds the last two timeline lines,
fading upward, and tapping it (or the header button) opens the full log. This
is the one place ADR 0020 rule 2 positively wants text, so it is where the
space today wastes goes.

**What gives way, and in what order.** The table above says nothing has to at
390×844. The order exists for narrower devices (the 320–380 band) and for a
future that adds a band: the log preview shrinks to one line, then to none,
then the header's "whose turn" collapses to the ringed swatch alone. **The
board's 366 is never reduced** — it is the primary channel, and every other
band is negotiable before it is.

**The legend stops being permanent.** It appears only while the minesweeper
module is on *and* the player has not yet revealed a tile, then retires to the
round-log sheet. Its content is unchanged; its residency is.

## The other screens

### Home

Three full-width slabs of identical weight, the **disabled one first**, then a
paragraph explaining all three, then "The twists" — four headed prose blocks on
the front door.

- **One primary action: "Pass and play on this device."** It is the only one
  that works in every environment. "Join a game" is secondary; "Host on Wi-Fi"
  is secondary and, in a browser, disabled **with its reason on the button
  itself** rather than in a paragraph below all three.
- **"The twists" leaves the home screen.** Under ADR 0020 the twists are shown
  in the lobby, at the toggle that turns each one on, not narrated at someone
  who has not started a game. The home screen keeps one line of what the game
  is.

### Join

One state today; three are needed, and the missing one is the defect.

| State | What shows |
|---|---|
| Searching | A live indicator and the "looking on this Wi-Fi" line. **New — today this renders nothing.** |
| Rooms found | The list, each room a single tap |
| None found | The reason, and the address field **promoted out of the disclosure** |

The heading names the task ("Join a game") rather than the empty list ("Games
nearby"). The address field stays inside a disclosure only in the *found*
state, where it is genuinely the secondary route — `join-link.ts`'s arrival
path already opens it, and that behaviour is unchanged.

### Lobby

- **"Add a player" beside "Add player"** is one label too many: the field keeps
  the placeholder, the button becomes an icon button with an accessible name.
- **Module rows replace module cards.** Name, state, and the blurb on demand,
  so `Start` stops living below four paragraphs. This is where "The twists"
  from the home screen lands.
- **The "On" state changes colour.** Its current green is the band
  `renderer-legibility` reserves for link tinting, and spec A's colour palette
  already excludes that band for the same reason.

> **A collision that already exists, found while checking the player cap.**
> `seatColours` (`palette.ts:29`) has exactly six entries for a six-player cap,
> and entry 4 is `#4ee39b` — mint. That is inside the green family
> `renderer-legibility` reserves for link tinting, so the fifth player's token
> already fights the snakes today, before anybody is allowed to *pick* a
> colour. Spec A's rule ("the selectable palette must exclude the link band")
> therefore is not only a constraint on a future picker: it condemns a current
> default. Replacing `#4ee39b` is in scope here, because the seat swatch is
> chrome; re-tinting the links is not, and stays with `renderer-legibility`.
> Note also that `seatColour` indexes `seat % 6`, which with a hard cap of six
> never wraps — the modulo is defensive, not load-bearing, and a seventh seat
> would need a seventh colour rather than a reused one.
- **Player rows carry the colour swatch** spec A defines, which is where colour
  is picked.
- Room code and QR are the one part of the current lobby that works; they are
  preserved, including the QR's in-SVG quiet zone, which is not a style and
  must not become one.

### Settings

Spec A's four groups — You, Controls, Motion, Screen — as the **overlay** spec
A specifies, so the board keeps animating behind it. Group headings are
section labels, not tabs: four groups do not earn a tab bar.

## The system

**Tokens.** Spacing and type scales as Panda tokens; colour tokens **derived
from `packages/render/src/palette.ts` at codegen**, per ADR 0021, so the
"mirrors palette.ts" comment becomes a build fact.

**One button recipe** with variants (`primary`, `secondary`, `ghost`, `card`,
`toggle`) and sizes replaces the eight classes. Every variant meets 44px.

**Icons.** Lucide for the general vocabulary; the game's nouns — venom, mine,
ladder, snake, flag, momentum, anchor, stun — hand-drawn as inline SVG to
Lucide's stroke weight. No emoji survives this spec.

**The PWA toast stops floating.** It becomes an inline element in the flow of
the screen that raises it, so it can never cover a control.

**Breakpoints.** The app is phone-first and stays so. The single `380px` query
is replaced by tokens plus one `sm` breakpoint for the 320–380 band, where the
progress rows and card rail are tightest.

## Files

| Path | Change |
|---|---|
| `panda.config.ts`, `postcss.config.cjs` | New. Tokens, recipes, the palette-derived colours |
| `apps/game-web/project.json` | New codegen target, with `inputs` and `outputs` declared |
| `apps/game-web/styles.css` | Shrinks to resets and page basics; the rest becomes recipes |
| `packages/ui/src/icons/` | New. The hand-drawn game glyphs |
| `packages/ui/src/HUD.tsx` | `PlayerStrip` → progress rows; `CardRail` flexes; legend conditional |
| `packages/ui/src/EventLog.tsx` | Preview mode and full mode; the live region is unchanged |
| `packages/ui/src/BoardCanvas.tsx` | Fixed 366 board band; `⟲ Reset view` becomes an icon button |
| `packages/ui/src/PwaPrompt.tsx` | Inline, not floating |
| `packages/app-shell/src/routes/match.tsx` | The five bands; the dice tray |
| `packages/app-shell/src/routes/home.tsx` | One primary action; the twists move out |
| `packages/app-shell/src/routes/join.tsx` | Three states |
| `packages/app-shell/src/routes/lobby.tsx` | Module rows; add-player; swatches |

## Testing

Unit:

- The band budget is a pure function of player count: for 2 through 6 the
  board is exactly 366, every other band is ≥ its minimum, and the remainder
  is non-negative. Table-driven against the numbers above, so adding a band
  without a rule fails rather than silently squeezing the board.
- No seat colour falls inside the reserved link-tint band — a pure predicate
  over `seatColours`, which fails today on `#4ee39b`.
- Join's state selection: searching / found / none-found from roster and elapsed
  time, as a pure function. The state nobody wrote is the one being fixed.
- `EventLog` preview mode keeps the `aria-live` node (spec A's rule, here in a
  second consumer).

Behavioural, `nub run build && nub run verify:ui` — **in that order**:

- Every screen at 390×844 and at 320px with no horizontal overflow.
- All five cards visible at once at 390 without scrolling.
- The match screen with six players: board still 366.
- The join screen with no rooms shows something. A screenshot of the current
  build is the proof that it does not today.
- No emoji in any rendered screenshot.

Not testable here: whether the palette-derived tokens match the WebGL board by
eye, and whether the 366 board is legible on real hardware. Both wait on the
hardware run.

## Build order

1. **Install Panda `1.12.1` and build.** ADR 0021 requires this first:
   it is unverified against React 19.3, Vite 8.3, TS 6.0.3 and nub's
   non-hoisting linker. Nothing else starts until it does.
2. The Nx codegen target, with `inputs` and `outputs` declared, and a cache-hit
   test — a second run must restore `styled-system`, not skip it.
3. Tokens derived from `palette.ts`; the button recipe.
4. Icons: Lucide wired, the eight game glyphs drawn.
5. The match screen — the largest, and the one the canvas already specifies.
6. Lobby, join, home.
7. The settings overlay, laying out spec A's groups.
8. `styles.css` reduced to what is genuinely global.

## ADRs

**None new.** ADR 0021 was written for this spec and covers the tooling
adoption and its costs; ADR 0020 governs what the chrome is for. The geometry
finding above is a measurement, not a decision, so it belongs here.
