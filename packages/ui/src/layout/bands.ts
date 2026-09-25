/**
 * The match screen is five vertical bands. The board is square while the phone
 * is 1:2.2, so the board can never fill the height — at 390 wide it maxes out
 * at 366, about 43%. The design question is what the rest does, and this is
 * the answer in numbers. Spec: 2026-09-17-chrome-and-layout-design.md.
 */
export const BOARD_PX = 366
export const HEADER_PX = 52
// Measured from the built app at 390×844 (Task 9): the card rail (44px) plus
// its 6px gap plus the dice-tray/Roll row (64px, the recipe's `lg` size)
// plus the bar's own vertical padding and border-top comes to 138.5625px,
// not the 130 this constant first carried — driving the app is what caught
// it, reading the recipe would not have. Rounded up so the log's budget
// never assumes more room than the bar actually leaves it.
export const CONTROLS_PX = 139
export const ROW_PX = 20
export const ROW_GAP_PX = 9
export const ROWS_PAD_PX = 12
export const LOG_LINE_PX = 22
// The simultaneous-mode seat switcher: one row of tap-sized buttons that flex
// to share it (as the card rail does), plus the band's padding below them.
export const SWITCHER_ROW_PX = 44
export const SWITCHER_GAP_PX = 8
export const SWITCHER_PAD_PX = 8

export interface Bands {
  readonly header: number
  readonly rows: number
  readonly switcher: number
  readonly board: number
  readonly log: number
  readonly controls: number
}

const rowsHeight = (players: number): number =>
  players <= 0 ? 0 : players * ROW_PX + (players - 1) * ROW_GAP_PX + ROWS_PAD_PX

const switcherHeight = (rows: number): number =>
  rows <= 0 ? 0 : rows * SWITCHER_ROW_PX + (rows - 1) * SWITCHER_GAP_PX + SWITCHER_PAD_PX

/**
 * The layout itself is plain flex — the log is the one band that grows and
 * shrinks — so this is not read at runtime. It is the arithmetic the tests
 * hold the layout to: with every fixed band at its budgeted height, the board
 * keeps its 366 and the log is what gives way.
 */
export const bands = (players: number, viewportPx: number, switcherRows = 0): Bands => {
  const rows = rowsHeight(players)
  const switcher = switcherHeight(switcherRows)
  // The board is the primary channel (ADR 0020): it is subtracted, never
  // squeezed, and the log absorbs whatever is left over or missing.
  const log = Math.max(0, viewportPx - HEADER_PX - rows - switcher - BOARD_PX - CONTROLS_PX)
  return { header: HEADER_PX, rows, switcher, board: BOARD_PX, log, controls: CONTROLS_PX }
}
