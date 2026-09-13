import * as THREE from "three"
import type { TimelineEvent } from "@/engine/events"
import type { Board, MatchState, Player } from "@/engine/types"
import { BoardTexture } from "./board-texture"
import { Dice } from "./dice"
import { buildLadder, easeInOutQuad, easeOutCubic, snakeCurve, tilePosition } from "./geometry"
import { palette, seatColour } from "./palette"

/** One step of choreography: a duration and a function of normalised time. */
interface Clip {
  readonly duration: number
  readonly update: (t: number) => void
  readonly done?: () => void
}

const TOKEN_Y = 0.24

export interface SceneOptions {
  /** Drop shadows and antialiasing off on weaker phones. */
  readonly quality?: "high" | "low"
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
  private readonly boardTexture: BoardTexture
  private readonly dice = new Dice()
  private readonly linkGroup = new THREE.Group()
  private readonly tokenGroup = new THREE.Group()
  private readonly tokens = new Map<string, THREE.Mesh>()
  private readonly clips: Clip[] = []

  private size: number
  private linkSignature = ""
  private clipElapsed = 0
  private frame = 0
  private lastTime = 0
  private disposed = false
  private onSettled: (() => void) | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    size: number,
    options: SceneOptions = {},
  ) {
    this.size = size
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
    this.camera.position.set(0, 12.5, 11.5)
    this.camera.lookAt(0, 0, 0.4)

    this.boardTexture = new BoardTexture(size)
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: this.boardTexture.texture,
        roughness: 0.92,
        metalness: 0.0,
      }),
    )
    board.rotation.x = -Math.PI / 2
    board.receiveShadow = highQuality
    this.scene.add(board)

    // A slim plinth so the board reads as an object rather than a decal.
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.5, 0.4, size + 0.5),
      new THREE.MeshStandardMaterial({ color: palette.boardEdge, roughness: 1 }),
    )
    plinth.position.y = -0.22
    plinth.receiveShadow = highQuality
    this.scene.add(plinth)

    this.scene.add(this.linkGroup, this.tokenGroup, this.dice.group)
    this.dice.group.position.set(0, 0, size / 2 + 1.6)

    this.scene.add(new THREE.HemisphereLight(0x9fd3e8, 0x101820, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(5, 12, 7)
    key.castShadow = highQuality
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 40
    const shadowExtent = size * 0.8
    Object.assign(key.shadow.camera, {
      left: -shadowExtent,
      right: shadowExtent,
      top: shadowExtent,
      bottom: -shadowExtent,
    })
    key.shadow.camera.updateProjectionMatrix()
    this.scene.add(key)

    this.resize()
  }

  /* ---------------------------------------------------------------- *
   * State sync
   * ---------------------------------------------------------------- */

  sync(state: MatchState): void {
    if (state.board.size !== this.size) {
      this.size = state.board.size
    }
    this.boardTexture.update(state.board)
    this.syncLinks(state.board)
    this.syncTokens(state.players)
  }

  /** Rebuild snakes and ladders, but only when the layout actually moved —
   *  the mutation module reshapes the board mid-match. */
  private syncLinks(board: Board): void {
    const signature = board.links.map((l) => `${l.id}:${l.kind}:${l.from}:${l.to}`).join("|")
    if (signature === this.linkSignature) return
    this.linkSignature = signature

    this.linkGroup.clear()
    const snakeBody = new THREE.MeshStandardMaterial({
      color: palette.snake,
      roughness: 0.42,
      metalness: 0.05,
    })
    const snakeHead = new THREE.MeshStandardMaterial({
      color: palette.snakeHead,
      roughness: 0.35,
    })
    const rail = new THREE.MeshStandardMaterial({ color: palette.ladder, roughness: 0.7 })
    const rung = new THREE.MeshStandardMaterial({ color: palette.ladderDark, roughness: 0.8 })

    for (const link of board.links) {
      const from = tilePosition(link.from, board.size)
      const to = tilePosition(link.to, board.size)
      if (link.kind === "snake") {
        const curve = snakeCurve(from, to)
        const body = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 44, 0.11, 7, false),
          snakeBody,
        )
        body.castShadow = true
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), snakeHead)
        head.position.copy(curve.getPoint(0))
        head.castShadow = true
        this.linkGroup.add(body, head)
      } else {
        this.linkGroup.add(buildLadder(from, to, rail, rung))
      }
    }
  }

  private syncTokens(players: ReadonlyArray<Player>): void {
    const seen = new Set<string>()
    for (const player of players) {
      seen.add(player.id)
      let token = this.tokens.get(player.id)
      if (!token) {
        token = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.17, 0.2, 4, 10),
          new THREE.MeshStandardMaterial({
            color: seatColour(player.seat),
            roughness: 0.3,
            metalness: 0.15,
            emissive: new THREE.Color(seatColour(player.seat)).multiplyScalar(0.18),
          }),
        )
        token.castShadow = true
        this.tokens.set(player.id, token)
        this.tokenGroup.add(token)
        token.position.copy(this.tileOf(player.position))
      }
      // Only snap when nothing is animating; mid-replay the clips own the token.
      if (this.clips.length === 0) token.position.copy(this.tileOf(player.position))
    }

    for (const [id, token] of this.tokens) {
      if (seen.has(id)) continue
      this.tokenGroup.remove(token)
      token.geometry.dispose()
      this.tokens.delete(id)
    }
    this.spreadOverlaps(players)
  }

  /** Nudge co-located tokens apart so a stack is still countable. */
  private spreadOverlaps(players: ReadonlyArray<Player>): void {
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
        if (!token || this.clips.length > 0) return
        const angle = (i / group.length) * Math.PI * 2
        token.position.x += Math.cos(angle) * 0.19
        token.position.z += Math.sin(angle) * 0.19
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

  /**
   * Convert a tap in canvas pixels to a board tile, or null if the tap missed
   * the board. Used for flagging suspected mines and for aiming `defuse`.
   */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, this.camera)

    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
      return null
    }
    const col = Math.round(hit.x + (this.size - 1) / 2)
    const row = Math.round((this.size - 1) / 2 - hit.z)
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return null
    // Undo the boustrophedon numbering to get back to a tile index.
    const offset = row % 2 === 0 ? col : this.size - 1 - col
    return row * this.size + offset + 1
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    // Pull back on tall, narrow phone screens so the board still fits.
    const portrait = height / width
    this.camera.position.set(0, 11 + portrait * 2.2, 9.5 + portrait * 3.2)
    this.camera.lookAt(0, 0, 0.4)
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.dice.dispose()
    this.boardTexture.dispose()
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
