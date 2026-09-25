/**
 * The game's own nouns. Lucide has no venom, mine or ladder, so these are
 * drawn to its grid and stroke weight — a mismatch reads as two icon sets
 * rather than one (ADR 0021).
 */
import type { JSX } from "react"

interface IconProps {
  readonly size?: number
  readonly title?: string
}

const Svg = ({ size = 20, title, d }: IconProps & { readonly d: JSX.Element }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title ? <title>{title}</title> : null}
    {d}
  </svg>
)

export const VenomIcon = (p: IconProps) => (
  <Svg {...p} d={<><circle cx="12" cy="12" r="3" /><path d="M12 9V4M9.4 13.5 5.1 16M14.6 13.5l4.3 2.5" /></>} />
)
export const MineIcon = (p: IconProps) => (
  <Svg {...p} d={<><circle cx="12" cy="12" r="5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>} />
)
export const LadderIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10" /></>} />
)
export const SnakeIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M4 18c4 0 4-5 8-5s4 5 8 5" /><path d="M20 18v-2" /><circle cx="19" cy="14" r="1" /></>} />
)
export const FlagIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" /></>} />
)
export const MomentumIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="m5 7 5 5-5 5M13 7l5 5-5 5" /></>} />
)
export const AnchorIcon = (p: IconProps) => (
  <Svg {...p} d={<><circle cx="12" cy="5" r="2" /><path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11H5M19 11h-3" /></>} />
)
export const StunIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M4 8h7l-7 8h7M14 5h6l-6 7h6" /></>} />
)
