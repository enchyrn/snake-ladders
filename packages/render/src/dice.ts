import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { palette } from "./palette"

const FACE_ORDER = [1, 6, 2, 5, 3, 4] as const // +X, -X, +Y, -Y, +Z, -Z

const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
}

const faceTexture = (value: number): THREE.CanvasTexture => {
  const s = 128
  const canvas = document.createElement("canvas")
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#f4efe4"
  ctx.fillRect(0, 0, s, s)
  for (const [px, py] of PIPS[value] ?? []) {
    // A recessed pip: a soft dark rim under the dot so it reads as drilled.
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)"
    ctx.beginPath()
    ctx.arc(px * s, py * s + s * 0.012, s * 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = value === 1 ? palette.mine : "#1a1f24"
    ctx.beginPath()
    ctx.arc(px * s, py * s, s * 0.085, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Rotations that bring each face value to point at the camera. Precomputed so
 * a settled die always reads the value the engine actually rolled — the dice
 * are a readout of a decided result, never the source of it.
 */
const RESTING: Record<number, THREE.Euler> = {
  1: new THREE.Euler(0, -Math.PI / 2, 0),
  2: new THREE.Euler(Math.PI / 2, 0, 0),
  3: new THREE.Euler(0, 0, 0),
  4: new THREE.Euler(0, Math.PI, 0),
  5: new THREE.Euler(-Math.PI / 2, 0, 0),
  6: new THREE.Euler(0, Math.PI / 2, 0),
}

export class Dice {
  readonly group = new THREE.Group()
  private readonly cubes: THREE.Mesh[] = []
  private readonly materials: THREE.MeshStandardMaterial[]

  constructor() {
    this.materials = FACE_ORDER.map(
      (value) =>
        new THREE.MeshStandardMaterial({
          map: faceTexture(value),
          roughness: 0.4,
          metalness: 0.02,
        }),
    )
    // Rounded corners catch the key light on the edges; a sharp cube reads
    // as a texture-mapped primitive.
    const geometry = new RoundedBoxGeometry(0.62, 0.62, 0.62, 3, 0.07)
    for (let i = 0; i < 2; i++) {
      const cube = new THREE.Mesh(geometry, this.materials)
      cube.castShadow = true
      cube.visible = false
      cube.position.x = i === 0 ? -0.42 : 0.42
      this.cubes.push(cube)
      this.group.add(cube)
    }
    this.group.visible = false
  }

  /** Show `values` tumbling; `t` runs 0 -> 1 across the roll animation. */
  show(values: ReadonlyArray<number>, t: number): void {
    this.group.visible = true
    this.cubes.forEach((cube, i) => {
      const value = values[i]
      if (value === undefined) {
        cube.visible = false
        return
      }
      cube.visible = true
      if (t < 0.72) {
        // Tumble: fast, and different per die so a pair does not look welded.
        const spin = (1 - t) * 14
        cube.rotation.x = t * spin * (i === 0 ? 1 : -1.3) * Math.PI
        cube.rotation.y = t * spin * 1.7 * Math.PI
        cube.position.y = 0.7 + Math.sin(t * Math.PI * 1.4) * 0.55
      } else {
        // Settle onto the rolled face.
        const k = Math.min(1, (t - 0.72) / 0.28)
        const rest = RESTING[value] ?? RESTING[1]!
        cube.rotation.x += (rest.x - cube.rotation.x) * k
        cube.rotation.y += (rest.y - cube.rotation.y) * k
        cube.rotation.z += (rest.z - cube.rotation.z) * k
        cube.position.y = 0.7 + (0.33 - 0.7) * k
      }
    })
  }

  hide(): void {
    this.group.visible = false
  }

  dispose(): void {
    for (const material of this.materials) {
      material.map?.dispose()
      material.dispose()
    }
    for (const cube of this.cubes) cube.geometry.dispose()
  }
}
