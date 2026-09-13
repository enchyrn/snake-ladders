import * as THREE from "three"
import { tileToCell } from "@/engine/board"

/**
 * Board space: one unit per tile, centred on the origin, lying in the XZ
 * plane. Tile 1 sits at the near-left corner and numbering snakes back and
 * forth, so a token's path across the board is a continuous walk.
 */
export const tilePosition = (tile: number, size: number, y = 0): THREE.Vector3 => {
  if (tile <= 0) {
    // The start pad sits just in front of tile 1, inside the camera's fit.
    return new THREE.Vector3(-(size - 1) / 2, y, size / 2 + 0.85)
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

/**
 * A tube whose radius follows `radiusAt(t)`. TubeGeometry is constant-radius,
 * and a snake that does not taper to its tail reads as a hose. UVs run along
 * the length in U (scaled by length so the skin's bands stay evenly spaced)
 * and around the body in V.
 */
export const taperedTube = (
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  radiusAt: (t: number) => number,
): THREE.BufferGeometry => {
  const frames = curve.computeFrenetFrames(segments, false)
  const length = curve.getLength()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, point)
    const N = frames.normals[i]!
    const B = frames.binormals[i]!
    const r = radiusAt(t)
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2
      const sin = Math.sin(v)
      const cos = -Math.cos(v)
      normal.set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize()
      normals.push(normal.x, normal.y, normal.z)
      positions.push(point.x + r * normal.x, point.y + r * normal.y, point.z + r * normal.z)
      uvs.push(t * length, j / radial)
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = (radial + 1) * i + j
      const b = (radial + 1) * (i + 1) + j
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

/** Body radius: fattest a little behind the head, tapering to a point. */
export const snakeRadius = (t: number): number =>
  0.04 + 0.11 * Math.sin((0.15 + 0.85 * t) * Math.PI) ** 0.7

/**
 * A snake's head as a group: a flattened wedge with two eyes, oriented along
 * the curve's start tangent so it looks where the body goes.
 */
export const buildSnakeHead = (
  curve: THREE.Curve<THREE.Vector3>,
  headGeometry: THREE.BufferGeometry,
  eyeGeometry: THREE.BufferGeometry,
  headMaterial: THREE.Material,
  eyeMaterial: THREE.Material,
): THREE.Group => {
  const group = new THREE.Group()
  const tip = curve.getPointAt(0)
  const forward = curve.getTangentAt(0).negate()
  group.position.copy(tip).addScaledVector(forward, 0.1)
  // Orient +Z along the head's forward direction, keeping the head level.
  const flat = new THREE.Vector3(forward.x, 0, forward.z).normalize()
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flat)

  const head = new THREE.Mesh(headGeometry, headMaterial)
  head.castShadow = true
  group.add(head)
  for (const sign of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial)
    eye.position.set(sign * 0.1, 0.075, 0.07)
    group.add(eye)
  }
  return group
}

/** Snake head profile: a squashed ellipsoid, wider than it is tall. */
export const snakeHeadGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.SphereGeometry(0.19, 14, 10)
  geometry.scale(1, 0.62, 1.25)
  return geometry
}

/** Rails and rungs for a ladder, as a single merged-ish group. */
export const buildLadder = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  railGeometry: THREE.BufferGeometry,
  rungGeometry: THREE.BufferGeometry,
  railMaterial: THREE.Material,
  rungMaterial: THREE.Material,
): THREE.Group => {
  const group = new THREE.Group()
  const span = new THREE.Vector3().subVectors(to, from)
  const length = span.length()
  const axis = span.clone().normalize()
  const sideUnit = new THREE.Vector3(-axis.z, 0, axis.x)
  const side = sideUnit.clone().multiplyScalar(0.19)
  const up = new THREE.Vector3(0, 1, 0)
  const railRotation = new THREE.Quaternion().setFromUnitVectors(up, axis)

  for (const sign of [1, -1]) {
    const rail = new THREE.Mesh(railGeometry, railMaterial)
    rail.position.copy(from).addScaledVector(span, 0.5).addScaledVector(side, sign)
    rail.position.y += 0.2
    // Rails stand along +Y; rotate that onto the from -> to axis, then scale
    // the unit-length geometry out to the ladder's length.
    rail.quaternion.copy(railRotation)
    rail.scale.y = length
    rail.castShadow = true
    group.add(rail)
  }

  const rungCount = Math.max(2, Math.round(length / 0.8))
  const rungRotation = new THREE.Quaternion().setFromUnitVectors(up, sideUnit)
  // Rungs stop short of the ends so the rails visibly overhang them.
  const inset = 0.12 / length
  for (let i = 0; i <= rungCount; i++) {
    const t = inset + (i / rungCount) * (1 - inset * 2)
    const rung = new THREE.Mesh(rungGeometry, rungMaterial)
    rung.position.copy(from).addScaledVector(span, t)
    rung.position.y += 0.2
    rung.quaternion.copy(rungRotation)
    rung.castShadow = true
    group.add(rung)
  }
  return group
}

/** A rail of unit length (scaled per ladder) with a rectangular section. */
export const railGeometry = (): THREE.BufferGeometry =>
  new THREE.BoxGeometry(0.075, 1, 0.05)

export const rungGeometry = (): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6)

/**
 * A token as a small pawn: a base disc, a waist, and a head. Read from above
 * on a phone the flare of the base and the bright head make it a game piece
 * rather than a blob, and the profile is one lathe shared by every token.
 */
export const pawnGeometry = (): THREE.BufferGeometry => {
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.2, 0),
    new THREE.Vector2(0.21, 0.04),
    new THREE.Vector2(0.17, 0.09),
    new THREE.Vector2(0.11, 0.13),
    new THREE.Vector2(0.085, 0.22),
    new THREE.Vector2(0.085, 0.3),
    new THREE.Vector2(0.135, 0.33),
    new THREE.Vector2(0.125, 0.36),
    new THREE.Vector2(0.16, 0.42),
    new THREE.Vector2(0.155, 0.5),
    new THREE.Vector2(0.11, 0.57),
    new THREE.Vector2(0.04, 0.605),
    new THREE.Vector2(0, 0.61),
  ]
  return new THREE.LatheGeometry(profile, 18)
}

/** Ease used for every token hop: quick off the mark, soft on landing. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
