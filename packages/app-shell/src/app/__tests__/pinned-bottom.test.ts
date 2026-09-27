import { afterEach, describe, expect, it, vi } from "vitest"
import { reservePinnedBottom } from "../pinned-bottom"

/** Just enough of the DOM for the helper, in a node test environment. */
const setup = (height: number) => {
  const style = new Map<string, string>()
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => void style.set(name, value),
        removeProperty: (name: string) => void style.delete(name),
      },
    },
  })
  const observers: Array<{ fire: () => void; observed: unknown[]; options: unknown[]; disconnected: boolean }> = []
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observed: unknown[] = []
      options: unknown[] = []
      disconnected = false
      fire: () => void
      constructor(callback: () => void) {
        this.fire = callback
        observers.push(this)
      }
      observe(el: unknown, options?: unknown) {
        this.observed.push(el)
        this.options.push(options)
      }
      disconnect() {
        this.disconnected = true
      }
    },
  )
  const row = { getBoundingClientRect: () => ({ height }) } as unknown as HTMLElement
  return { style, observers, row }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("reservePinnedBottom", () => {
  it("reserves the row's measured height at the bottom of the document scroller", () => {
    const { style, observers, row } = setup(68.6)
    reservePinnedBottom(row)
    observers[0]?.fire()
    // Rounded up: a fractional pixel short would leave a focused control's
    // last row of pixels under the row.
    expect(style.get("--pinned-bottom")).toBe("69px")
    // Plus a few pixels: the focus ring is drawn outside the control's box,
    // and flush against the row its bottom edge would sit under it.
    expect(style.get("scroll-padding-bottom")).toBe("calc(var(--pinned-bottom) + 4px)")
  })

  it("watches the border box, which is where a safe-area padding change shows", () => {
    const { observers, row } = setup(69)
    reservePinnedBottom(row)
    expect(observers[0]?.observed).toEqual([row])
    expect(observers[0]?.options).toEqual([{ box: "border-box" }])
  })

  it("leaves nothing behind for the next screen once the row unmounts", () => {
    const { style, observers, row } = setup(69)
    const release = reservePinnedBottom(row)
    observers[0]?.fire()
    release?.()
    expect(style.size).toBe(0)
    expect(observers[0]?.disconnected).toBe(true)
  })

  it("does nothing without a row", () => {
    const { style, observers } = setup(69)
    expect(reservePinnedBottom(null)).toBeUndefined()
    expect(observers).toHaveLength(0)
    expect(style.size).toBe(0)
  })
})
