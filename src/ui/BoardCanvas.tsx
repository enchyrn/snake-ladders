import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"
import { BoardScene } from "@/render/scene"
import type { MatchState } from "@/engine/types"

interface Props {
  readonly state: MatchState
  /** Called once a resolved round has finished animating. */
  readonly onSettled?: () => void
  readonly quality?: "high" | "low"
  /** Fired with the tile a tap landed on, if any. */
  readonly onPickTile?: (tile: number) => void
}

/**
 * Mounts the WebGL scene and feeds it state.
 *
 * The scene is created once and kept across renders: rebuilding it per React
 * render would drop the GL context on every roll. Timelines are replayed by
 * identity, so a re-render with the same round does not re-animate it.
 */
export const BoardCanvas = ({ state, onSettled, quality, onPickTile }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<BoardScene | null>(null)
  const playedRef = useRef<unknown>(null)
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new BoardScene(canvas, state.board.size, { quality: quality ?? "high" })
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

  const handlePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const tile = sceneRef.current?.pick(event.clientX, event.clientY)
    if (tile !== null && tile !== undefined) onPickTile?.(tile)
  }

  return (
    <canvas
      ref={canvasRef}
      className="board-canvas"
      onPointerUp={onPickTile ? handlePointer : undefined}
    />
  )
}
