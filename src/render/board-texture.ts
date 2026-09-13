import * as THREE from "three"
import { tileToCell } from "@/engine/board"
import type { Board, Tile } from "@/engine/types"
import { countColour, palette } from "./palette"

/**
 * The board face is drawn once into a 2D canvas and uploaded as a texture.
 *
 * Tile numbers and minesweeper counts are text, and text is the one thing a
 * WebGL scene is bad at: a hundred label meshes would cost more than the rest
 * of the scene put together. A canvas redrawn only when the board actually
 * changes costs nothing per frame.
 *
 * The minesweeper layer lives here too. Hidden tiles are drawn raised, like
 * unpressed keys; revealed tiles are sunken, lighter and warmer, so the swept
 * region reads as open ground even before you notice the numbers on it.
 */
export class BoardTexture {
  readonly texture: THREE.CanvasTexture
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly cell: number
  private signature = ""

  constructor(private readonly size: number, resolution = 1024) {
    this.canvas = document.createElement("canvas")
    this.canvas.width = resolution
    this.canvas.height = resolution
    const ctx = this.canvas.getContext("2d")
    if (!ctx) throw new Error("2d canvas context unavailable")
    this.ctx = ctx
    this.cell = resolution / size

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
  }

  /** Redraw only when something visible changed. */
  update(board: Board): void {
    const signature = board.tiles
      .map((t) => `${t.revealed ? 1 : 0}${t.flagged ? 1 : 0}${t.defused ? 1 : 0}`)
      .join("")
    if (signature === this.signature) return
    this.signature = signature
    this.draw(board)
    this.texture.needsUpdate = true
  }

  private draw(board: Board): void {
    const { ctx, cell, size } = this
    ctx.fillStyle = palette.boardEdge
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    for (let tile = 1; tile <= size * size; tile++) {
      const { row, col } = tileToCell(tile, size)
      // Canvas y grows downward while board rows grow upward.
      const x = col * cell
      const y = (size - 1 - row) * cell
      const t = board.tiles[tile]!
      const checker = (row + col) % 2 === 0

      if (t.revealed) this.drawSunkenTile(x, y)
      else this.drawRaisedTile(x, y, checker ? palette.boardDark : palette.boardLight)

      if (tile === size * size) this.tintTile(x, y, palette.finish, 0.28)
      else if (tile === 1) this.tintTile(x, y, palette.start, 0.22)

      const cx = x + cell / 2
      const cy = y + cell / 2

      if (t.flagged && !t.revealed) {
        this.tintTile(x, y, palette.flag, 0.1)
        this.drawTileNumber(tile, x, y, t.revealed)
        this.drawFlag(cx, cy)
        continue
      }

      this.drawTileNumber(tile, x, y, t.revealed)
      if (!t.revealed) continue

      if (t.mined) {
        this.tintTile(x, y, palette.mine, t.defused ? 0.1 : 0.2)
        this.drawMine(cx, cy, t)
        continue
      }

      if (t.adjacentMines > 0) this.drawCount(cx, cy, t.adjacentMines)
    }
  }

  /** A hidden tile: a raised slab with a light top-left and dark bottom-right
   *  edge, the way an unpressed minesweeper cell has always looked. */
  private drawRaisedTile(x: number, y: number, fill: string): void {
    const { ctx, cell } = this
    const gap = cell * 0.03
    const edge = cell * 0.035
    const x0 = x + gap
    const y0 = y + gap
    const w = cell - gap * 2

    ctx.fillStyle = fill
    ctx.fillRect(x0, y0, w, w)

    ctx.fillStyle = "rgba(255, 255, 255, 0.10)"
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x0 + w, y0)
    ctx.lineTo(x0 + w - edge, y0 + edge)
    ctx.lineTo(x0 + edge, y0 + edge)
    ctx.lineTo(x0 + edge, y0 + w - edge)
    ctx.lineTo(x0, y0 + w)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = "rgba(0, 0, 0, 0.34)"
    ctx.beginPath()
    ctx.moveTo(x0 + w, y0 + w)
    ctx.lineTo(x0, y0 + w)
    ctx.lineTo(x0 + edge, y0 + w - edge)
    ctx.lineTo(x0 + w - edge, y0 + w - edge)
    ctx.lineTo(x0 + w - edge, y0 + edge)
    ctx.lineTo(x0 + w, y0)
    ctx.closePath()
    ctx.fill()
  }

  /** A revealed tile: flat and sunken, with a shadow under its top-left lip. */
  private drawSunkenTile(x: number, y: number): void {
    const { ctx, cell } = this
    const gap = cell * 0.03
    const x0 = x + gap
    const y0 = y + gap
    const w = cell - gap * 2

    ctx.fillStyle = palette.revealed
    ctx.fillRect(x0, y0, w, w)

    const shade = ctx.createLinearGradient(x0, y0, x0 + w * 0.5, y0 + w * 0.5)
    shade.addColorStop(0, "rgba(0, 0, 0, 0.32)")
    shade.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = shade
    ctx.fillRect(x0, y0, w, w)

    ctx.strokeStyle = palette.revealedEdge
    ctx.lineWidth = cell * 0.02
    ctx.strokeRect(x0 + ctx.lineWidth / 2, y0 + ctx.lineWidth / 2, w - ctx.lineWidth, w - ctx.lineWidth)
  }

  private tintTile(x: number, y: number, colour: string, alpha: number): void {
    const { ctx, cell } = this
    const gap = cell * 0.03
    ctx.globalAlpha = alpha
    ctx.fillStyle = colour
    ctx.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2)
    ctx.globalAlpha = 1
  }

  /** Tile number, small and dim: it orients you without competing with the
   *  minesweeper count. */
  private drawTileNumber(tile: number, x: number, y: number, revealed: boolean): void {
    const { ctx, cell } = this
    ctx.fillStyle = revealed ? "#8fb0be" : palette.textDim
    ctx.font = `600 ${Math.round(cell * 0.19)}px ui-monospace, monospace`
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    ctx.fillText(String(tile), x + cell * 0.1, y + cell * 0.09)
  }

  /** The adjacency count: big, bold, colour-coded, and outlined so it stays
   *  legible where a snake or a ladder crosses the tile. */
  private drawCount(cx: number, cy: number, count: number): void {
    const { ctx, cell } = this
    ctx.font = `800 ${Math.round(cell * 0.52)}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "rgba(4, 10, 14, 0.85)"
    ctx.lineWidth = cell * 0.075
    ctx.strokeText(String(count), cx, cy + cell * 0.07)
    ctx.fillStyle = countColour(count)
    ctx.fillText(String(count), cx, cy + cell * 0.07)
  }

  private drawFlag(cx: number, cy: number): void {
    const { ctx, cell } = this
    const poleX = cx - cell * 0.08
    // Ground shadow so the flag sits on the tile rather than floating.
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)"
    ctx.beginPath()
    ctx.ellipse(cx, cy + cell * 0.27, cell * 0.2, cell * 0.06, 0, 0, Math.PI * 2)
    ctx.fill()
    // Pole with a base.
    ctx.strokeStyle = palette.text
    ctx.lineCap = "round"
    ctx.lineWidth = cell * 0.05
    ctx.beginPath()
    ctx.moveTo(poleX, cy - cell * 0.28)
    ctx.lineTo(poleX, cy + cell * 0.26)
    ctx.stroke()
    ctx.lineWidth = cell * 0.06
    ctx.beginPath()
    ctx.moveTo(poleX - cell * 0.12, cy + cell * 0.26)
    ctx.lineTo(poleX + cell * 0.12, cy + cell * 0.26)
    ctx.stroke()
    // Pennant.
    ctx.fillStyle = palette.flag
    ctx.beginPath()
    ctx.moveTo(poleX, cy - cell * 0.3)
    ctx.lineTo(poleX + cell * 0.34, cy - cell * 0.15)
    ctx.lineTo(poleX, cy + cell * 0.0)
    ctx.closePath()
    ctx.fill()
  }

  /** A mine: a dark sphere with spikes. A spent one (tripped or disarmed —
   *  every mine you can see is one or the other) is barred through so it
   *  reads as inert, not as a live threat. */
  private drawMine(cx: number, cy: number, tile: Tile): void {
    const { ctx, cell } = this
    const my = cy + cell * 0.05
    const r = cell * 0.17
    const live = !tile.defused

    ctx.strokeStyle = live ? palette.mine : "#6e7d86"
    ctx.lineCap = "round"
    ctx.lineWidth = cell * 0.045
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r * 0.8, my + Math.sin(a) * r * 0.8)
      ctx.lineTo(cx + Math.cos(a) * r * 1.5, my + Math.sin(a) * r * 1.5)
      ctx.stroke()
    }
    ctx.fillStyle = live ? palette.mine : "#5b6a73"
    ctx.beginPath()
    ctx.arc(cx, my, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)"
    ctx.beginPath()
    ctx.arc(cx - r * 0.35, my - r * 0.35, r * 0.25, 0, Math.PI * 2)
    ctx.fill()

    if (live) return
    ctx.lineWidth = cell * 0.1
    ctx.strokeStyle = palette.boardEdge
    ctx.beginPath()
    ctx.moveTo(cx - cell * 0.3, my - cell * 0.3)
    ctx.lineTo(cx + cell * 0.3, my + cell * 0.3)
    ctx.stroke()
    ctx.lineWidth = cell * 0.05
    ctx.strokeStyle = palette.text
    ctx.stroke()
  }

  dispose(): void {
    this.texture.dispose()
  }
}
