import { useEffect, useId, useRef, type ReactNode } from "react"
import { useAtom } from "@effect-atom/atom-react"
import { X } from "lucide-react"
import { css, cx } from "styled-system/css"
import { button } from "styled-system/recipes"
import { seatColours } from "@mutation/render/palette"
import { headingClass, textInputClass } from "@mutation/ui/layout/screen"
import { useSession } from "./session"
import { hasHaptics, hasWakeLock } from "./capabilities"
import { saveSettings, settingsAtom, type Settings } from "../store/settings"

// Matches the inline comments beside `seatColours` in palette.ts — a swatch's
// accessible name has to say the colour, and the hex alone does not.
const COLOUR_NAMES = ["Cyan", "Coral", "Amber", "Violet", "Teal", "Pink"] as const

const panelClass = css({
  position: "fixed",
  inset: 0,
  // Above RoundLogSheet (6): the header that opens either sheet is inert
  // while one is open, so the two never actually stack, but a settings panel
  // that lost a z-index race would be unreachable rather than merely ugly.
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  gap: "3",
  paddingTop: "max(16px, env(safe-area-inset-top))",
  paddingRight: "gutterR",
  paddingBottom: "max(16px, env(safe-area-inset-bottom))",
  paddingLeft: "gutterL",
  background: "rgba(8, 11, 16, 0.92)",
})

const headerRowClass = css({
  flex: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
})

const closeClass = cx(button({ variant: "ghost", size: "sm" }), css({ width: "tap", paddingInline: "0" }))

const sectionsClass = css({ display: "flex", flexDirection: "column", gap: "5", flex: "1 1 auto", overflowY: "auto" })

const stackClass = css({ display: "flex", flexDirection: "column", gap: "3" })

const fieldLabelClass = css({ fontSize: "sm", fontWeight: 600 })

const groupRowClass = css({ display: "flex", gap: "1" })

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

/** A mutually-exclusive row of options, styled like the module toggle it
 *  reuses the look of (lobby.tsx) — one selected at a time via `aria-pressed`,
 *  matching the seat switcher's own convention rather than a radio role. */
const SegmentedRow = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: T
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  readonly onChange: (value: T) => void
}) => (
  <div className={stackClass}>
    <span className={fieldLabelClass}>{label}</span>
    <div role="group" aria-label={label} className={groupRowClass}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          className={cx(
            button({ variant: value === opt.value ? "primary" : "toggle", size: "sm" }),
            css({ flex: "1 1 0" }),
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
)

/** A single on/off setting. Text carries the state rather than colour alone
 *  (lobby.tsx's module row does the same) so it reads on a dim phone too. */
const ToggleRow = ({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: boolean
  readonly onChange: (value: boolean) => void
}) => (
  <button
    type="button"
    aria-pressed={value}
    className={cx(button({ variant: "toggle", size: "md" }), css({ width: "100%", justifyContent: "space-between" }))}
    onClick={() => onChange(!value)}
  >
    <span>{label}</span>
    <span className={value ? undefined : css({ color: "textDim" })}>{value ? "On" : "Off"}</span>
  </button>
)

const Section = ({ heading, children }: { readonly heading: string; readonly children: ReactNode }) => (
  <section>
    <h2 className={headingClass}>{heading}</h2>
    <div className={stackClass}>{children}</div>
  </section>
)

const rollButtonOptions = [
  { value: "hidden", label: "Hidden" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
] as const

const speedOptions = [
  { value: "calm", label: "Calm" },
  { value: "brisk", label: "Brisk" },
  { value: "quick", label: "Quick" },
] as const

const reducedMotionOptions = [
  { value: "system", label: "Follow system" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
] as const

const qualityOptions = [
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
] as const

/**
 * An overlay, not a route — `apps/game-web/main.tsx` never registers
 * `/settings`, because a route replaces whatever screen is current, and the
 * match screen's `BoardCanvas` tears down `BoardScene` on unmount, discarding
 * a round's clip queue mid-replay. This sits above the current screen instead,
 * and the caller (match.tsx, home.tsx) keeps that screen mounted underneath.
 *
 * The `{ open, onClose }` interface has no slot for a restore-focus target
 * (RoundLogSheet takes one), so the opener is captured from
 * `document.activeElement` at open time instead — the effect below is what
 * RoundLogSheet does with that one difference.
 */
export const SettingsPanel = ({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) => {
  const session = useSession()
  const [settings, setSettings] = useAtom(settingsAtom)
  const headingId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      opener?.focus()
    }
  }, [open])

  if (!open) return null

  const setField = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }

  // Capability probes, never platform checks: a disabled control still
  // claims the capability exists, so an unavailable one is left out entirely.
  const canHaptics = hasHaptics(navigator)
  const canKeepAwake = hasWakeLock(navigator, globalThis.isSecureContext ?? false)

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={headingId} className={panelClass}>
      <div className={headerRowClass}>
        <h1 id={headingId} className={css({ margin: 0, fontSize: "lg", fontWeight: 600 })}>
          Settings
        </h1>
        <button type="button" ref={closeRef} aria-label="Close settings" className={closeClass} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className={sectionsClass}>
        <Section heading="You">
          <label className={css({ display: "flex", flexDirection: "column", gap: "0.35em" })}>
            <span className={fieldLabelClass}>Name</span>
            <input
              className={textInputClass}
              value={session.identity.name}
              maxLength={14}
              onChange={(e) => session.rename(e.target.value)}
              placeholder="Adder"
            />
          </label>

          <div className={stackClass}>
            <span className={fieldLabelClass}>Colour</span>
            <div role="group" aria-label="Colour" className={cx(groupRowClass, css({ flexWrap: "wrap" }))}>
              <button
                type="button"
                aria-pressed={settings.colour === ""}
                className={button({ variant: settings.colour === "" ? "primary" : "toggle", size: "sm" })}
                onClick={() => setField("colour", "")}
              >
                By seat
              </button>
              {seatColours.map((hex, i) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={COLOUR_NAMES[i]}
                  aria-pressed={settings.colour === hex}
                  className={cx(swatchBaseClass, settings.colour === hex ? swatchSelectedClass : undefined)}
                  style={{ background: hex }}
                  onClick={() => setField("colour", hex)}
                />
              ))}
            </div>
          </div>
        </Section>

        <Section heading="Controls">
          <SegmentedRow
            label="Roll button"
            value={settings.rollButton}
            options={rollButtonOptions}
            onChange={(v) => setField("rollButton", v)}
          />
          <ToggleRow
            label="Confirm before rolling"
            value={settings.confirmRoll}
            onChange={(v) => setField("confirmRoll", v)}
          />
          {canHaptics && (
            <ToggleRow label="Haptics" value={settings.haptics} onChange={(v) => setField("haptics", v)} />
          )}
        </Section>

        <Section heading="Motion">
          <SegmentedRow
            label="Animation speed"
            value={settings.speed}
            options={speedOptions}
            onChange={(v) => setField("speed", v)}
          />
          <SegmentedRow
            label="Reduce motion"
            value={settings.reducedMotion}
            options={reducedMotionOptions}
            onChange={(v) => setField("reducedMotion", v)}
          />
          <SegmentedRow
            label="Graphics quality"
            value={settings.quality}
            options={qualityOptions}
            onChange={(v) => setField("quality", v)}
          />
        </Section>

        <Section heading="Screen">
          <ToggleRow
            label="Tile numbers"
            value={settings.tileNumbers}
            onChange={(v) => setField("tileNumbers", v)}
          />
          <ToggleRow label="Round log" value={settings.roundLog} onChange={(v) => setField("roundLog", v)} />
          {canKeepAwake && (
            <ToggleRow
              label="Keep screen awake"
              value={settings.keepAwake}
              onChange={(v) => setField("keepAwake", v)}
            />
          )}
        </Section>
      </div>
    </div>
  )
}
