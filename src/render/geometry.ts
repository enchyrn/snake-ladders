import * as THREE from "three"
import { tileToCell } from "@/engine/board"

/**
 * Board space: one unit per tile, centred on the origin, lying in the XZ
 * plane. Tile 1 sits at the near-left corner and numbering snakes back and
 * forth, so a token's path across the board is a continuous walk.
 */
export const tilePosition = (tile: number, size: number, y = 0): THREE.Vector3 => {
  if (tile <= 0) {
    // The start pad sits just off the near-left corner.
    return new THREE.Vector3(-(size / 2) - 0.85, y, size / 2 - 0.5)
  }
  const { row, col } = tileToCell(tile, size)
  return new THREE.Vector3(col - (size - 1) / 2, y, (size - 1) / 2 - row)
}

/** A snake drawn as a curve that sags between its mouth and its tail. */
export const snakeCurve = (
  from: THREE.Vector3,
  to: THREE.Vector3,
): THREE.CatmullRomCurve3 => {
  const span = from.distanceTo(to)
  const points: THREE.Vector3[] = []
  const steps = 6
  // A perpendicular offset makes the body wind rather than run straight.
  const axis = new THREE.Vector3().subVectors(to, from).normalize()
  const side = new THREE.Vector3(-axis.z, 0, axis.x)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const base = new THREE.Vector3().lerpVectors(from, to, t)
    const wiggle = Math.sin(t * Math.PI * 2.2) * Math.min(0.9, span * 0.09)
    base.addScaledVector(side, wiggle)
    base.y += 0.16 + Math.sin(t * Math.PI) * 0.1
    points.push(base)
  }
  return new THREE.CatmullRomCurve3(points)
}

/** Rails and rungs for a ladder, as a single merged-ish group. */
export const buildLadder = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  railMaterial: THREE.Material,
  rungMaterial: THREE.Material,
): THREE.Group => {
  const group = new THREE.Group()
  const span = new THREE.Vector3().subVectors(to, from)
  const length = span.length()
  const axis = span.clone().normalize()
  const side = new THREE.Vector3(-axis.z, 0, axis.x).multiplyScalar(0.17)

  const railGeometry = new THREE.CylinderGeometry(0.035, 0.035, length, 6)
  for (const sign of [1, -1]) {
    const rail = new THREE.Mesh(railGeometry, railMaterial)
    rail.position.copy(from).addScaledVector(span, 0.5).addScaledVector(side, sign)
    rail.position.y += 0.22
    // Cylinders stand along +Y; rotate that onto the from -> to axis.
    rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
    group.add(rail)
  }

  const rungCount = Math.max(2, Math.round(length / 0.85))
  const rungGeometry = new THREE.CylinderGeometry(0.028, 0.028, 0.34, 5)
  for (let i = 0; i <= rungCount; i++) {
    const t = i / rungCount
    const rung = new THREE.Mesh(rungGeometry, rungMaterial)
    rung.position.copy(from).addScaledVector(span, t)
    rung.position.y += 0.22
    rung.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      side.clone().normalize(),
    )
    group.add(rung)
  }
  return group
}

/** Ease used for every token hop: quick off the mark, soft on landing. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
