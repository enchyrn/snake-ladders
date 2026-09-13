import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { BoardScene } from "@/render/scene"
import type { MatchState } from "@/engine/types"
import { MineLegend } from "./HUD"

interface Props {
  readonly state: MatchState
  /** Called once a resolved round has finished animating. */
  readonly onSettled?: () => void
  readonly quality?: "high" | "low"
  /** Fired with the tile a tap landed on, if any. */
  readonly onPickTile?: (tile: number) => void
}

/** A press that travels further than this, or lasts longer, is a drag. */
const TAP_SLOP_PX = 8
const TAP_MAX_MS = 500

interface Press {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly at: number
  /** Set once a second finger joins: a pinch is never a tap. */
  multi: boolean
}

/**
 * Mounts the WebGL scene and feeds it state.
 *
 * The scene is created once and kept across renders: rebuilding it per React
 * render would drop the GL context on every roll. Timelines are replayed by
 * identity, so a re-render with the same round does not re-animate it.
 *
 * The canvas is also the orbit surface. A drag turns the board and a pinch
 * or wheel zooms it; only a press that neither moved nor lingered counts as a
 * tap on a tile, so orbiting never flags a mine by accident.
 */
export const BoardCanvas = ({ state, onSettled, quality, onPickTile }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<BoardScene | null>(null)
  const playedRef = useRef<unknown>(null)
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled
  const pressRef = useRef<Press | null>(null)
  const [viewMoved, setViewMoved] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new BoardScene(canvas, state.board.size, {
      quality: quality ?? "high",
      onViewChange: (isDefault) => setViewMoved(!isDefault),
    })
    sceneRef.current = scene
    scene.sync(state)
    scene.start()

    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
    // Board size and quality are structural; everything else streams in below.
  }, [state.board.size, quality])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.sync(state)

    // Replay a round exactly once, however many times React re-renders it.
    if (state.timeline.length > 0 && playedRef.current !== state.timeline) {
      playedRef.current = state.timeline
      scene.play(state.timeline, () => {
        scene.sync(state)
        settledRef.current?.()
      })
    }
  }, [state])

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const press = pressRef.current
    if (press) {
      // A second pointer while one is down: this gesture is a pinch.
      press.multi = true
      return
    }
    pressRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      multi: false,
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const press = pressRef.current
    if (!press || press.id !== event.pointerId) return
    pressRef.current = null
    if (press.multi) return
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y)
    if (moved > TAP_SLOP_PX || event.timeStamp - press.at > TAP_MAX_MS) return
    const tile = sceneRef.current?.pick(event.clientX, event.clientY)
    if (tile !== null && tile !== undefined) onPickTile?.(tile)
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pressRef.current?.id === event.pointerId) pressRef.current = null
  }

  const resetView = useCallback(() => sceneRef.current?.resetView(), [])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="board-canvas"
        onPointerDown={onPickTile ? handlePointerDown : undefined}
        onPointerUp={onPickTile ? handlePointerUp : undefined}
        onPointerCancel={onPickTile ? handlePointerCancel : undefined}
      />
      <div className="board-overlay">
        {viewMoved && (
          <button type="button" className="view-reset" onClick={resetView}>
            ⟲ Reset view
          </button>
        )}
        {onPickTile && <MineLegend />}
      </div>
    </>
  )
}
