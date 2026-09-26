import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { BoardScene } from "@mutation/render/scene"
import type { MatchState } from "@mutation/engine/types"
import type { TimelineEvent } from "@mutation/engine/events"
import { showRound } from "./round-playback"
import { MineLegend } from "./HUD"
import { RotateCcw } from "lucide-react"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"

const canvasClass = css({
  display: "block",
  width: "100%",
  height: "100%",
  // The board handles its own drag-to-look and tap-to-pick; the page must
  // not also try to scroll or zoom underneath a finger on it.
  touchAction: "none",
})

// Overlays that belong to the board itself: the reset-view button and the
// minefield key. They sit inside the board's own wrapper, so they never
// cover the roster or the control bar, and they let pointer events through
// to the canvas everywhere but on their own controls.
const overlayClass = css({
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  alignItems: "flex-end",
  gap: "2",
  paddingRight: "gutterR",
  paddingBottom: "0.5rem",
  paddingLeft: "gutterL",
  pointerEvents: "none",
})

const viewResetClass = cx(
  button({ variant: "secondary", size: "sm" }),
  css({
    pointerEvents: "auto",
    padding: "0.3em 0.75em",
    fontSize: "0.85rem",
    background: "rgba(8, 11, 16, 0.75)",
    backdropFilter: "blur(6px)",
    borderColor: "revealedEdge",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  }),
)

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
  const playedRef = useRef<ReadonlyArray<TimelineEvent> | null>(null)
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled
  const pressRef = useRef<Press | null>(null)
  const [viewMoved, setViewMoved] = useState(false)
  // Tile 0 is the start pad and is always revealed (board.ts), so it is
  // excluded — this asks whether the *player* has revealed anything yet.
  const hasRevealedTile = state.board.tiles.slice(1).some((tile) => tile.revealed)

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
    // Replays a round exactly once however many times React re-renders it,
    // and holds the tokens still while one is pending — see round-playback.ts.
    playedRef.current = showRound(scene, state, playedRef.current, () => settledRef.current?.())
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
        className={canvasClass}
        onPointerDown={onPickTile ? handlePointerDown : undefined}
        onPointerUp={onPickTile ? handlePointerUp : undefined}
        onPointerCancel={onPickTile ? handlePointerCancel : undefined}
      />
      <div className={overlayClass}>
        {viewMoved && (
          <button type="button" className={viewResetClass} onClick={resetView}>
            <RotateCcw size={14} aria-hidden="true" /> Reset view
          </button>
        )}
        {/* Retires once a tile is revealed: the board then shows what the
         * legend explains, so a permanent key would just be narrating the
         * board back at the player (ADR 0020). Index 0 is the start pad and
         * is always revealed, so it is excluded from the check. */}
        {onPickTile && !hasRevealedTile && <MineLegend />}
      </div>
    </>
  )
}
