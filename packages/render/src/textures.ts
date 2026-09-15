import * as THREE from "three"
import { palette } from "./palette"

/**
 * Small procedural textures, drawn once into 2D canvases at construction and
 * shared by every mesh that uses them. Nothing here is generated per frame,
 * and none of it is large: a few hundred kilobytes of texture memory buys
 * materials that read as wood and scale instead of flat plastic.
 */

/** Deterministic hash noise so the grain is the same on every device. */
const noise = (x: number, y: number, seed: number): number => {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
  return n - Math.floor(n)
}

const makeCanvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2d canvas context unavailable")
  return [canvas, ctx]
}

const upload = (canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  return texture
}

/** Wood grain running along V, so a rail's length axis carries the grain. */
export const woodTexture = (light = palette.ladder, dark = palette.ladderDark): THREE.CanvasTexture => {
  const w = 64
  const h = 256
  const [canvas, ctx] = makeCanvas(w, h)
  ctx.fillStyle = light
  ctx.fillRect(0, 0, w, h)
  // Long, slightly wavering streaks of the darker tone.
  ctx.strokeStyle = dark
  ctx.lineCap = "round"
  for (let i = 0; i < 26; i++) {
    const x = noise(i, 3, 1) * w
    const wobble = (noise(i, 7, 2) - 0.5) * 6
    ctx.globalAlpha = 0.18 + noise(i, 11, 3) * 0.3
    ctx.lineWidth = 0.6 + noise(i, 5, 4) * 1.8
    ctx.beginPath()
    ctx.moveTo(x, -4)
    ctx.bezierCurveTo(x + wobble, h * 0.33, x - wobble, h * 0.66, x + wobble * 0.5, h + 4)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  return upload(canvas, 1, 2)
}

/** A banded snake skin: a light dorsal line over darker diamonds. Runs along
 *  U so it wraps the body's length. */
export const snakeSkinTexture = (): THREE.CanvasTexture => {
  const w = 256
  const h = 32
  const [canvas, ctx] = makeCanvas(w, h)
  ctx.fillStyle = palette.snake
  ctx.fillRect(0, 0, w, h)
  // Belly (the bottom of the tube, v ~ 0.5) is paler.
  ctx.fillStyle = "#3aa068"
  ctx.fillRect(0, h * 0.35, w, h * 0.3)
  // Dark saddles along the back.
  ctx.fillStyle = palette.snakeDark
  const period = 24
  for (let x = 0; x < w; x += period) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + period * 0.45, h * 0.22)
    ctx.lineTo(x + period * 0.9, 0)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, h)
    ctx.lineTo(x + period * 0.45, h * 0.78)
    ctx.lineTo(x + period * 0.9, h)
    ctx.closePath()
    ctx.fill()
  }
  return upload(canvas, 6, 1)
}
