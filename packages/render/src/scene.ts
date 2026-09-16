import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import type { TimelineEvent } from "@mutation/engine/events"
import type { Board, MatchState, Player } from "@mutation/engine/types"
import { BoardTexture } from "./board-texture"
import { Dice } from "./dice"
import {
  buildLadder,
  buildSnakeHead,
  easeInOutQuad,
  easeOutCubic,
  pawnGeometry,
  railGeometry,
  rungGeometry,
  snakeCurve,
  snakeHeadGeometry,
  snakeRadius,
  taperedTube,
  tilePosition,
} from "./geometry"
import { palette, seatColour } from "./palette"
import { snakeSkinTexture, woodTexture } from "./textures"

/** One step of choreography: a duration and a function of normalised time. */
interface Clip {
  readonly duration: number
  readonly update: (t: number) => void
  readonly done?: () => void
}

/** Tokens are pawns standing on the face, so their origin is their base. */
const TOKEN_Y = 0.01
/** The default view looks down at the board from this far above horizontal. */
const TILT = THREE.MathUtils.degToRad(56)
/** How far the plinth extends past the board face on each side. */
const PLINTH_BORDER = 0.32
/** How far the start tray reaches past the plinth's near edge. */
const PAD_DEPTH = 0.9

export interface SceneOptions {
  /** Drop shadows and antialiasing off on weaker phones. */
  readonly quality?: "high" | "low"
  /** Fired when the camera leaves or returns to the default framing. */
  readonly onViewChange?: (isDefault: boolean) => void
}

/**
 * The 3D view. It renders state and replays timelines; it never decides
 * anything. Every value it animates was already computed by the engine on
 * every device, so an animation that stutters or is skipped cannot change the
 * outcome of the match.
 */
export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly boardTexture: BoardTexture
  private readonly dice = new Dice()
  private readonly linkGroup = new THREE.Group()
  private readonly tokenGroup = new THREE.Group()
  private readonly tokens = new Map<string, THREE.Mesh>()
  private readonly clips: Clip[] = []

  // Shared geometry and materials: one of each, however many links or tokens.
  private readonly pawn = pawnGeometry()
  private readonly snakeHead = snakeHeadGeometry()
  private readonly snakeEye = new THREE.SphereGeometry(0.035, 8, 6)
  private readonly rail = railGeometry()
  private readonly rung = rungGeometry()
  private readonly skin = snakeSkinTexture()
  private readonly wood = woodTexture()
  private readonly snakeBodyMaterial: THREE.MeshStandardMaterial
  private readonly snakeHeadMaterial: THREE.MeshStandardMaterial
  private readonly snakeEyeMaterial: THREE.MeshStandardMaterial
  private readonly railMaterial: THREE.MeshStandardMaterial
  private readonly rungMaterial: THREE.MeshStandardMaterial
  /** Per-snake tube geometry, disposed when the layout is rebuilt. */
  private snakeBodies: THREE.BufferGeometry[] = []

  // Picking scratch, allocated once.
  private readonly raycaster = new THREE.Raycaster()
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly pickNdc = new THREE.Vector2()
  private readonly pickHit = new THREE.Vector3()

  private size: number
  private fitDistance = 20
  private viewIsDefault = true
  private linkSignature = ""
  private clipElapsed = 0
  private frame = 0
  private lastTime = 0
  private disposed = false
  private onSettled: (() => void) | null = null
  private readonly onViewChange: ((isDefault: boolean) => void) | undefined

  constructor(
    private readonly canvas: HTMLCanvasElement,
    size: number,
    options: SceneOptions = {},
  ) {
    this.size = size
    this.onViewChange = options.onViewChange
    const highQuality = options.quality !== "low"

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: highQuality,
      alpha: false,
      powerPreference: "high-performance",
    })
    // Cap the pixel ratio: a 3x phone display triples the fragment cost for a
    // difference nobody can see on a board made of flat tiles.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, highQuality ? 2 : 1.5))
    this.renderer.shadowMap.enabled = highQuality
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene.background = new THREE.Color(palette.void)
    this.scene.fog = new THREE.Fog(palette.void, 16, 34)

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100)

    /* Materials ---------------------------------------------------- */

    this.snakeBodyMaterial = new THREE.MeshStandardMaterial({
      map: this.skin,
      roughness: 0.48,
      metalness: 0.02,
    })
    this.snakeHeadMaterial = new THREE.MeshStandardMaterial({
      color: palette.snakeHead,
      roughness: 0.42,
    })
    this.snakeEyeMaterial = new THREE.MeshStandardMaterial({
      color: "#0d1210",
      roughness: 0.15,
      metalness: 0.1,
    })
    this.railMaterial = new THREE.MeshStandardMaterial({
      map: this.wood,
      roughness: 0.72,
    })
    this.rungMaterial = new THREE.MeshStandardMaterial({
      map: this.wood,
      color: "#cdb37e",
      roughness: 0.78,
    })

    /* The board as an object ---------------------------------------- */

    this.boardTexture = new BoardTexture(size)
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: this.boardTexture.texture,
        roughness: 0.82,
        metalness: 0.0,
      }),
    )
    face.rotation.x = -Math.PI / 2
    face.receiveShadow = highQuality
    this.scene.add(face)

    // A plinth with softened edges: the highlight the key light leaves along
    // its rim is what makes the board read as a thing on a table.
    const frameMaterial = new THREE.MeshStandardMaterial({
      map: this.wood,
      color: "#3b2a1c",
      roughness: 0.68,
    })
    const plinth = new THREE.Mesh(
      new RoundedBoxGeometry(size + PLINTH_BORDER * 2, 0.5, size + PLINTH_BORDER * 2, 3, 0.08),
      frameMaterial,
    )
    plinth.position.y = -0.27
    plinth.receiveShadow = highQuality
    plinth.castShadow = highQuality
    this.scene.add(plinth)

    // A slim lip standing proud of the face, like a picture frame.
    const lipWidth = PLINTH_BORDER - 0.05
    const lipGeometry = new THREE.BoxGeometry(size + lipWidth * 2, 0.09, lipWidth)
    const lipGeometrySide = new THREE.BoxGeometry(lipWidth, 0.09, size)
    for (const [geometry, x, z] of [
      [lipGeometry, 0, size / 2 + lipWidth / 2],
      [lipGeometry, 0, -(size / 2 + lipWidth / 2)],
      [lipGeometrySide, size / 2 + lipWidth / 2, 0],
      [lipGeometrySide, -(size / 2 + lipWidth / 2), 0],
    ] as const) {
      const lip = new THREE.Mesh(geometry, frameMaterial)
      lip.position.set(x, 0.025, z)
      lip.castShadow = highQuality
      lip.receiveShadow = highQuality
      this.scene.add(lip)
    }

    // The start pad: a short tray growing out of the frame under tile 1,
    // with an inset disc a waiting token stands on. Part of the same object,
    // so it never reads as something dropped beside the board.
    const padCentre = tilePosition(0, size)
    const tray = new THREE.Mesh(
      new RoundedBoxGeometry(1.1, 0.5, PAD_DEPTH + 0.3, 2, 0.08),
      frameMaterial,
    )
    // Overlaps the plinth's near edge so the two merge into one silhouette.
    tray.position.set(padCentre.x, -0.27, padCentre.z - 0.15)
    tray.castShadow = highQuality
    tray.receiveShadow = highQuality
    this.scene.add(tray)
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.05, 20),
      new THREE.MeshStandardMaterial({ color: palette.start, roughness: 0.85 }),
    )
    pad.position.set(padCentre.x, -0.015, padCentre.z)
    pad.receiveShadow = highQuality
    this.scene.add(pad)

    // A table under everything, fading into the fog: the plinth's shadow on
    // it is what anchors the board in space once the camera starts orbiting.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: "#0c1117", roughness: 1 }),
    )
    table.rotation.x = -Math.PI / 2
    table.position.y = -0.52
    table.receiveShadow = highQuality
    this.scene.add(table)

    this.scene.add(this.linkGroup, this.tokenGroup, this.dice.group)
    this.dice.group.position.set(0, 0, size / 2 + 1.6)

    /* Lighting ------------------------------------------------------ */

    // Cool sky, warm ground bounce; a warm key from the upper right with the
    // only shadow; a cool, shadowless fill from the opposite side so the
    // shadowed faces of ladders and tokens keep some shape.
    this.scene.add(new THREE.HemisphereLight(0x9ccbe0, 0x2a1d13, 1.15))
    const key = new THREE.DirectionalLight(0xffe9cf, 2.1)
    key.position.set(6, 13, 5)
    key.castShadow = highQuality
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 40
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.02
    const shadowExtent = size * 0.85
    Object.assign(key.shadow.camera, {
      left: -shadowExtent,
      right: shadowExtent,
      top: shadowExtent,
      bottom: -shadowExtent,
    })
    key.shadow.camera.updateProjectionMatrix()
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x9cc3de, 0.5)
    fill.position.set(-7, 6, -4)
    this.scene.add(fill)

    /* Camera controls ----------------------------------------------- */

    // Orbit and zoom only. Panning is off and the polar angle is clamped so
    // the board can never leave the screen or be seen from underneath; the
    // zoom range is set relative to the fit distance in `resize`.
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.7
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(10)
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(68)
    this.controls.target.set(0, 0, 0)
    this.controls.addEventListener("change", () => this.noteViewChange())

    this.resize()
  }

  /* ---------------------------------------------------------------- *
   * State sync
   * ---------------------------------------------------------------- */

  /** `snapTokens: false` leaves token positions alone: the caller is about to
   *  `play` a round, and the state it is handing over is that round's outcome
   *  rather than where the tokens should stand while it plays. */
  sync(state: MatchState, options: { readonly snapTokens?: boolean } = {}): void {
    if (state.board.size !== this.size) {
      this.size = state.board.size
    }
    this.boardTexture.update(state.board)
    this.syncLinks(state.board)
    this.syncTokens(state.players, options.snapTokens ?? true)
  }

  /** Rebuild snakes and ladders, but only when the layout actually moved —
   *  the mutation module reshapes the board mid-match. */
  private syncLinks(board: Board): void {
    const signature = board.links.map((l) => `${l.id}:${l.kind}:${l.from}:${l.to}`).join("|")
    if (signature === this.linkSignature) return
    this.linkSignature = signature

    this.linkGroup.clear()
    for (const geometry of this.snakeBodies) geometry.dispose()
    this.snakeBodies = []

    for (const link of board.links) {
      const from = tilePosition(link.from, board.size)
      const to = tilePosition(link.to, board.size)
      if (link.kind === "snake") {
        const curve = snakeCurve(from, to)
        const geometry = taperedTube(curve, 48, 8, snakeRadius)
        this.snakeBodies.push(geometry)
        const body = new THREE.Mesh(geometry, this.snakeBodyMaterial)
        body.castShadow = true
        const head = buildSnakeHead(
          curve,
          this.snakeHead,
          this.snakeEye,
          this.snakeHeadMaterial,
          this.snakeEyeMaterial,
        )
        this.linkGroup.add(body, head)
      } else {
        this.linkGroup.add(
          buildLadder(from, to, this.rail, this.rung, this.railMaterial, this.rungMaterial),
        )
      }
    }
  }

  private syncTokens(players: ReadonlyArray<Player>, snap: boolean): void {
    const seen = new Set<string>()
    for (const player of players) {
      seen.add(player.id)
      let token = this.tokens.get(player.id)
      if (!token) {
        const colour = new THREE.Color(seatColour(player.seat))
        token = new THREE.Mesh(
          this.pawn,
          new THREE.MeshStandardMaterial({
            color: colour,
            roughness: 0.32,
            metalness: 0.08,
            emissive: colour.clone().multiplyScalar(0.12),
          }),
        )
        token.castShadow = true
        this.tokens.set(player.id, token)
        this.tokenGroup.add(token)
        token.position.copy(this.tileOf(player.position))
      }
      // Only snap when nothing is animating and no round is waiting to play:
      // between the two the clips own the token, and `clips` alone cannot see
      // the second case — it is empty right up until `play` fills it.
      if (snap && this.clips.length === 0) token.position.copy(this.tileOf(player.position))
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue
      this.tokenGroup.remove(token)
      // Geometry is shared; only the seat-coloured material belongs to it.
      ;(token.material as THREE.Material).dispose()
      this.tokens.delete(id)
    }
    this.spreadOverlaps(players, snap)
  }

  /** Nudge co-located tokens apart so a stack is still countable. */
  private spreadOverlaps(players: ReadonlyArray<Player>, snap: boolean): void {
    const byTile = new Map<number, Player[]>()
    for (const player of players) {
      const list = byTile.get(player.position) ?? []
      list.push(player)
      byTile.set(player.position, list)
    }
    for (const group of byTile.values()) {
      if (group.length < 2) continue
      group.forEach((player, i) => {
        const token = this.tokens.get(player.id)
        if (!token || !snap || this.clips.length > 0) return
        const angle = (i / group.length) * Math.PI * 2
        token.position.x += Math.cos(angle) * 0.21
        token.position.z += Math.sin(angle) * 0.21
      })
    }
  }

  private tileOf(tile: number): THREE.Vector3 {
    return tilePosition(tile, this.size, TOKEN_Y)
  }

  /* ---------------------------------------------------------------- *
   * Choreography
   * ---------------------------------------------------------------- */

  /** Turn a resolved round into animation. Returns immediately; `onDone`
   *  fires once the whole timeline has played out. */
  play(timeline: ReadonlyArray<TimelineEvent>, onDone?: () => void): void {
    this.clips.length = 0
    this.clipElapsed = 0
    this.onSettled = onDone ?? null

    for (const event of timeline) {
      switch (event._tag) {
        case "Rolled": {
          const dice = [...event.dice]
          this.clips.push({
            duration: 700,
            update: (t) => this.dice.show(dice, t),
          })
          break
        }
        case "Moved": {
          const token = this.tokens.get(event.playerId)
          if (!token) break
          const steps = Math.abs(event.to - event.from)
          const path = Array.from({ length: steps + 1 }, (_, i) =>
            this.tileOf(event.from + Math.sign(event.to - event.from) * i),
          )
          this.clips.push({
            duration: Math.min(1100, 130 + steps * 95),
            update: (t) => this.walk(token, path, t),
            done: () => this.dice.hide(),
          })
          break
        }
        case "TookLink": {
          const token = this.tokens.get(event.playerId)
          if (!token) break
          const from = this.tileOf(event.from)
          const to = this.tileOf(event.to)
          const climbing = event.to > event.from
          this.clips.push({
            duration: 620,
            update: (t) => {
              const k = easeInOutQuad(t)
              token.position.lerpVectors(from, to, k)
              // A climb rises over the rails; a bite hugs the board.
              token.position.y = TOKEN_Y + (climbing ? Math.sin(k * Math.PI) * 0.45 : 0.05)
            },
          })
          break
        }
        case "Knocked": {
          const token = this.tokens.get(event.playerId)
          if (!token) break
          const from = this.tileOf(event.from)
          const to = this.tileOf(event.to)
          this.clips.push({
            duration: 520,
            update: (t) => {
              const k = easeOutCubic(t)
              token.position.lerpVectors(from, to, k)
              token.position.y = TOKEN_Y + Math.sin(k * Math.PI) * 0.8
            },
          })
          break
        }
        case "MineTripped": {
          const token = this.tokens.get(event.playerId)
          if (!token) break
          const from = this.tileOf(event.tile)
          const to = this.tileOf(event.to)
          this.clips.push({
            duration: event.absorbed ? 320 : 640,
            update: (t) => {
              if (event.absorbed) {
                // Absorbed: a shudder in place, no displacement.
                token.position.copy(from)
                token.position.y = TOKEN_Y + Math.abs(Math.sin(t * Math.PI * 4)) * 0.12
                return
              }
              const k = easeOutCubic(t)
              token.position.lerpVectors(from, to, k)
              token.position.y = TOKEN_Y + Math.sin(k * Math.PI) * 1.1
            },
          })
          break
        }
        case "Swapped": {
          const a = this.tokens.get(event.playerId)
          const b = this.tokens.get(event.withPlayerId)
          if (!a || !b) break
          const aFrom = a.position.clone()
          const bFrom = b.position.clone()
          this.clips.push({
            duration: 520,
            update: (t) => {
              const k = easeInOutQuad(t)
              a.position.lerpVectors(aFrom, bFrom, k)
              b.position.lerpVectors(bFrom, aFrom, k)
              const lift = Math.sin(k * Math.PI) * 0.6
              a.position.y = TOKEN_Y + lift
              b.position.y = TOKEN_Y - lift * 0.3
            },
          })
          break
        }
        // Board-level events need no token motion; `sync` picks them up.
        default:
          break
      }
    }
  }

  /** Hop a token along a path of tile centres. */
  private walk(token: THREE.Mesh, path: ReadonlyArray<THREE.Vector3>, t: number): void {
    if (path.length < 2) {
      const only = path[0]
      if (only) token.position.copy(only)
      return
    }
    const legs = path.length - 1
    const scaled = Math.min(t * legs, legs - 0.0001)
    const index = Math.floor(scaled)
    const local = scaled - index
    token.position.lerpVectors(path[index]!, path[index + 1]!, easeOutCubic(local))
    token.position.y = TOKEN_Y + Math.sin(local * Math.PI) * 0.28
  }

  get isAnimating(): boolean {
    return this.clips.length > 0
  }

  /* ---------------------------------------------------------------- *
   * Loop
   * ---------------------------------------------------------------- */

  start(): void {
    const tick = (time: number) => {
      if (this.disposed) return
      this.frame = requestAnimationFrame(tick)
      const delta = this.lastTime === 0 ? 16 : Math.min(time - this.lastTime, 64)
      this.lastTime = time
      this.step(delta)
      // Damped controls keep easing after the finger lifts.
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.frame = requestAnimationFrame(tick)
  }

  private step(delta: number): void {
    const clip = this.clips[0]
    if (!clip) return
    this.clipElapsed += delta
    const t = Math.min(1, this.clipElapsed / clip.duration)
    clip.update(t)
    if (t < 1) return

    clip.done?.()
    this.clips.shift()
    this.clipElapsed = 0
    if (this.clips.length === 0) {
      this.dice.hide()
      const settled = this.onSettled
      this.onSettled = null
      settled?.()
    }
  }

  /* ---------------------------------------------------------------- *
   * Camera
   * ---------------------------------------------------------------- */

  /**
   * Convert a tap in canvas pixels to a board tile, or null if the tap missed
   * the board. Used for flagging suspected mines and for aiming `defuse`.
   * Works from any orbit angle: it is a ray against the board plane.
   */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect()
    this.pickNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pickNdc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, this.pickHit)) return null

    const hit = this.pickHit
    const col = Math.round(hit.x + (this.size - 1) / 2)
    const row = Math.round((this.size - 1) / 2 - hit.z)
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return null
    // Undo the boustrophedon numbering to get back to a tile index.
    const offset = row % 2 === 0 ? col : this.size - 1 - col
    return row * this.size + offset + 1
  }

  /** Put the camera back on the default framing that fits the whole board. */
  resetView(): void {
    const d = this.fitDistance
    this.camera.position.set(0, Math.sin(TILT) * d, Math.cos(TILT) * d)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.noteViewChange()
  }

  private noteViewChange(): void {
    const d = this.fitDistance
    const isDefault =
      Math.abs(this.camera.position.x) < 0.02 &&
      Math.abs(this.camera.position.y - Math.sin(TILT) * d) < 0.02 &&
      Math.abs(this.camera.position.z - Math.cos(TILT) * d) < 0.02
    if (isDefault === this.viewIsDefault) return
    this.viewIsDefault = isDefault
    this.onViewChange?.(isDefault)
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height

    // Fit the board in BOTH axes. On a tall phone the binding constraint is
    // the *horizontal* field of view, which is the narrow one; sizing from the
    // vertical axis alone sliced the left and right columns off the board.
    //
    // Seen from above at TILT, a point at board-space (x, z) sits at camera
    // depth d - cos(TILT) * z and offset (x, sin(TILT) * z) from the axis, so
    // the near edge of the board projects wider than the far one. Each
    // extreme of the object — frame corners, the start pad, the dice — is
    // checked in both axes, and the camera backs off to the largest distance
    // any of them needs. Nothing on the plinth can be clipped at the default.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov)
    const tanV = Math.tan(vFov / 2)
    const tanH = tanV * this.camera.aspect
    const half = this.size / 2 + PLINTH_BORDER
    const extremes: ReadonlyArray<readonly [number, number]> = [
      [half, half], // near frame corners
      [half, -half], // far frame corners
      [(this.size - 1) / 2 + 0.55, half + PAD_DEPTH], // start tray
      [0.75, this.size / 2 + 1.6 + 0.35], // dice
    ]
    let distance = 0
    for (const [x, z] of extremes) {
      const forWidth = x / tanH + Math.cos(TILT) * z
      const forDepth = (Math.sin(TILT) * Math.abs(z)) / tanV + Math.cos(TILT) * z
      distance = Math.max(distance, forWidth, forDepth)
    }
    distance *= 1.02 // a little air

    const wasDefault = this.viewIsDefault
    this.fitDistance = distance
    this.controls.minDistance = distance * 0.5
    this.controls.maxDistance = distance * 1.35
    this.camera.far = distance * 4
    this.camera.updateProjectionMatrix()

    // Fog has to track the camera: fixed distances tuned for one viewport
    // swallow the whole board on another. It starts beyond the farthest the
    // board can be zoomed out to, so only the table ever fades.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.controls.maxDistance * 1.15
      this.scene.fog.far = this.controls.maxDistance * 2.6
    }

    // A camera the player has not touched keeps fitting the board as the
    // viewport changes; one they have orbited stays put (re-clamped).
    if (wasDefault) this.resetView()
    else this.controls.update()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.controls.dispose()
    this.dice.dispose()
    this.boardTexture.dispose()
    this.skin.dispose()
    this.wood.dispose()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
    })
    this.renderer.dispose()
  }
}
