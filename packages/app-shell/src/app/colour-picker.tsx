import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"
import { seatColours } from "@mutation/render/palette"

// Matches the inline comments beside `seatColours` in palette.ts — a swatch's
// accessible name has to say the colour, and the hex alone does not.
const COLOUR_NAMES = ["Cyan", "Coral", "Amber", "Violet", "Teal", "Pink"] as const

const rowClass = css({ display: "flex", gap: "1", flexWrap: "wrap" })

const swatchBaseClass = css({
  width: "tap",
  height: "tap",
  borderRadius: "8px",
  border: "2px solid",
  borderColor: "transparent",
  padding: 0,
  cursor: "pointer",
})

const swatchSelectedClass = css({ borderColor: "text" })

/**
 * "By seat" plus the seat palette, and nothing else: the palette is the only
 * set already checked against the reserved link band, so a colour added here
 * without re-running that predicate could hide a token among the snakes.
 * `value` is `""` for "By seat", matching `Settings.colour`.
 */
export const ColourPicker = ({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (colour: string) => void
}) => (
  <div role="group" aria-label={label} className={rowClass}>
    <button
      type="button"
      aria-pressed={value === ""}
      className={button({ variant: value === "" ? "primary" : "toggle", size: "sm" })}
      onClick={() => onChange("")}
    >
      By seat
    </button>
    {seatColours.map((hex, i) => (
      <button
        key={hex}
        type="button"
        aria-label={COLOUR_NAMES[i]}
        aria-pressed={value === hex}
        className={cx(swatchBaseClass, value === hex ? swatchSelectedClass : undefined)}
        style={{ background: hex }}
        onClick={() => onChange(hex)}
      />
    ))}
  </div>
)
