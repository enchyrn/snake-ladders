import { nextInt, shuffle, type RngState } from "./rng"
import type { Board, Link, MatchConfig, Tile } from "./types"

/* ---------------------------------------------------------------- *
 * Boustrophedon geometry: tile 1 is bottom-left, rows alternate
 * direction. Everything the renderer and the minesweeper overlay need
 * comes from these two helpers.
 * ---------------------------------------------------------------- */

export interface Cell {
  readonly row: number
  readonly col: number
}

export const tileToCell = (tile: number, size: number): Cell => {
  const i = tile - 1
  const row = Math.floor(i / size)
  const offset = i % size
  return { row, col: row % 2 === 0 ? offset : size - 1 - offset }
}

export const cellToTile = (cell: Cell, size: number): number => {
  const offset = cell.row % 2 === 0 ? cell.col : size - 1 - cell.col
  return cell.row * size + offset + 1
}

/** The 8 grid-adjacent tiles — minesweeper adjacency, not board adjacency. */
export const neighbours = (tile: number, size: number): number[] => {
  const { row, col } = tileToCell(tile, size)
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const r = row + dr
      const c = col + dc
      if (r < 0 || c < 0 || r >= size || c >= size) continue
      out.push(cellToTile({ row: r, col: c }, size))
    }
  }
  return out
}

export const lastTile = (size: number): number => size * size

/* ---------------------------------------------------------------- *
 * Generation
 * ---------------------------------------------------------------- */

/**
 * Links never chain: a link's landing tile is never another link's mouth.
 * Without that rule a single roll could cascade forever, and the resolver
 * would need a loop guard that differs subtly between devices.
 */
const pickLinks = (
  size: number,
  rng: RngState,
): readonly [Link[], RngState] => {
  const n = lastTile(size)
  const count = Math.max(2, Math.round(size * 0.9))
  const candidates: number[] = []
  for (let t = 2; t < n; t++) candidates.push(t)

  const [pool, afterShuffle] = shuffle(rng, candidates)
  let cur = afterShuffle

  const links: Link[] = []
  const taken = new Set<number>([1, n])
  let cursor = 0

  const claim = (): number | null => {
    while (cursor < pool.length) {
      const t = pool[cursor++]!
      if (!taken.has(t)) return t
    }
    return null
  }

  for (let i = 0; i < count * 2 && links.length < count * 2; i++) {
    const a = claim()
    if (a === null) break
    // Pair it with a partner far enough away to matter but not board-spanning.
    const [span, s1] = nextInt(cur, Math.max(2, Math.floor(n / 3)))
    cur = s1
    const distance = span + size - Math.floor(size / 2)
    const wantsLadder = links.filter((l) => l.kind === "ladder").length <= links.length / 2
    const b = wantsLadder ? a + distance : a - distance
    if (b <= 1 || b >= n || taken.has(b)) continue

    const kind = wantsLadder ? "ladder" : "snake"
    taken.add(a)
    taken.add(b)
    links.push({
      id: `${kind[0]}${links.length}`,
      kind,
      from: wantsLadder ? a : a,
      to: b,
      uses: 0,
      // Ladders wear out; snakes are forever.
      maxUses: kind === "ladder" ? 2 : Number.MAX_SAFE_INTEGER,
    })
  }
  return [links, cur] as const
}

const placeMines = (
  size: number,
  count: number,
  links: ReadonlyArray<Link>,
  rng: RngState,
): readonly [Set<number>, RngState] => {
  const n = lastTile(size)
  const blocked = new Set<number>([1, n])
  for (const l of links) {
    blocked.add(l.from)
    blocked.add(l.to)
  }
  const candidates: number[] = []
  for (let t = 2; t < n; t++) if (!blocked.has(t)) candidates.push(t)
  const [pool, cur] = shuffle(rng, candidates)
  return [new Set(pool.slice(0, Math.min(count, pool.length))), cur] as const
}

export const buildTiles = (
  size: number,
  mines: ReadonlySet<number>,
): Tile[] => {
  const n = lastTile(size)
  const tiles: Tile[] = []
  // Index 0 is the start pad: off the grid, never mined, never linked.
  tiles.push({ index: 0, mined: false, adjacentMines: 0, revealed: true, flagged: false, defused: false })
  for (let t = 1; t <= n; t++) {
    const adjacentMines = neighbours(t, size).filter((x) => mines.has(x)).length
    tiles.push({
      index: t,
      mined: mines.has(t),
      adjacentMines,
      revealed: false,
      flagged: false,
      defused: false,
    })
  }
  return tiles
}

export const generateBoard = (
  config: MatchConfig,
  rng: RngState,
): readonly [Board, RngState] => {
  const [links, afterLinks] = pickLinks(config.size, rng)
  const wantsMines = config.modules.includes("minesweeper")
  const [mines, afterMines] = wantsMines
    ? placeMines(config.size, config.mineCount, links, afterLinks)
    : ([new Set<number>(), afterLinks] as const)
  const board: Board = {
    size: config.size,
    tiles: buildTiles(config.size, mines),
    links,
  }
  return [board, afterMines] as const
}

/* ---------------------------------------------------------------- *
 * Queries
 * ---------------------------------------------------------------- */

export const linkAt = (board: Board, tile: number): Link | undefined =>
  board.links.find((l) => l.from === tile)

export const tileAt = (board: Board, tile: number): Tile => {
  const t = board.tiles[tile]
  if (!t) throw new Error(`tile ${tile} out of range for size ${board.size}`)
  return t
}

/** Classic minesweeper flood fill: a zero-count tile opens its neighbours. */
export const revealFrom = (board: Board, tile: number): readonly [Board, number[]] => {
  if (tile <= 0) return [board, []] as const
  const opened: number[] = []
  const queue = [tile]
  const seen = new Set<number>()
  const tiles = board.tiles.slice()

  while (queue.length > 0) {
    const t = queue.shift()!
    if (seen.has(t)) continue
    seen.add(t)
    const cur = tiles[t]
    if (!cur || cur.revealed) continue
    tiles[t] = { ...cur, revealed: true }
    opened.push(t)
    // Only a blank tile cascades, and a mine never does.
    if (cur.adjacentMines === 0 && !cur.mined) {
      for (const nb of neighbours(t, board.size)) if (!seen.has(nb)) queue.push(nb)
    }
  }
  return [{ ...board, tiles }, opened] as const
}
