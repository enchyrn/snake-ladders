import * as THREE from "three"
import { tileToCell } from "@/engine/board"
import type { Board } from "@/engine/types"
import { countColour, palette } from "./palette"

/**
 * The board face is drawn once into a 2D canvas and uploaded as a texture.
 *
 * Tile numbers and minesweeper counts are text, and text is the one thing a
 * WebGL scene is bad at: a hundred label meshes would cost more than the rest
 * of the scene put together. A canvas redrawn only when the board actually
 * changes costs nothing per frame.
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

      ctx.fillStyle = t.revealed
        ? palette.revealed
        : checker
          ? palette.boardDark
          : palette.boardLight
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4)

      if (tile === size * size) {
        ctx.fillStyle = palette.finish
        ctx.globalAlpha = 0.22
        ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4)
        ctx.globalAlpha = 1
      }

      // Tile number, small and dim: it orients you without competing with the
      // minesweeper count.
      ctx.fillStyle = palette.textDim
      ctx.font = `${Math.round(cell * 0.2)}px ui-monospace, monospace`
      ctx.textAlign = "left"
      ctx.textBaseline = "top"
      ctx.fillText(String(tile), x + cell * 0.1, y + cell * 0.08)

      const cx = x + cell / 2
      const cy = y + cell / 2

      if (t.flagged && !t.revealed) {
        this.drawFlag(cx, cy)
        continue
      }
      if (!t.revealed) continue

      if (t.mined) {
        ctx.beginPath()
        ctx.arc(cx, cy + cell * 0.05, cell * 0.2, 0, Math.PI * 2)
        ctx.fillStyle = t.defused ? palette.textDim : palette.mine
        ctx.fill()
        if (t.defused) {
          // A spent or disarmed mine reads as struck through, not live.
          ctx.strokeStyle = palette.revealedEdge
          ctx.lineWidth = cell * 0.06
          ctx.beginPath()
          ctx.moveTo(cx - cell * 0.22, cy - cell * 0.17)
          ctx.lineTo(cx + cell * 0.22, cy + cell * 0.27)
          ctx.stroke()
        }
        continue
      }

      if (t.adjacentMines > 0) {
        ctx.fillStyle = countColour(t.adjacentMines)
        ctx.font = `700 ${Math.round(cell * 0.42)}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(String(t.adjacentMines), cx, cy + cell * 0.06)
      }
    }
  }

  private drawFlag(cx: number, cy: number): void {
    const { ctx, cell } = this
    ctx.strokeStyle = palette.text
    ctx.lineWidth = cell * 0.05
    ctx.beginPath()
    ctx.moveTo(cx - cell * 0.02, cy - cell * 0.22)
    ctx.lineTo(cx - cell * 0.02, cy + cell * 0.22)
    ctx.stroke()
    ctx.fillStyle = palette.flag
    ctx.beginPath()
    ctx.moveTo(cx, cy - cell * 0.22)
    ctx.lineTo(cx + cell * 0.24, cy - cell * 0.1)
    ctx.lineTo(cx, cy + cell * 0.02)
    ctx.closePath()
    ctx.fill()
  }

  dispose(): void {
    this.texture.dispose()
  }
}
