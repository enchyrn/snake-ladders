import qrcode from "qrcode-generator"

/**
 * The margin a scanner needs to find the code's edges, in modules. Drawn into
 * the SVG rather than left to CSS padding: padding is a fixed number of pixels
 * against a module size that changes with the encoded length, and at 180px a
 * longer URL had shrunk it to roughly one module — a quarter of what the
 * format asks for, on a code that has to be read off a screen.
 */
const QUIET_ZONE = 4

/**
 * A QR as one SVG path rather than a canvas: it scales to any size without
 * blurring, needs no ref or effect, and renders identically server-side, which
 * is what makes it testable without a browser.
 */
export const QrCode = ({ value, size = 180 }: { readonly value: string; readonly size?: number }) => {
  if (!value) return null

  // Type 0 lets the library pick the smallest version that fits. "M" corrects
  // ~15% damage, which is the usual trade for a code read off a screen.
  const qr = qrcode(0, "M")
  qr.addData(value)
  qr.make()

  const count = qr.getModuleCount()
  const path: string[] = []
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      // Offset by the quiet zone, so the modules sit inside it.
      if (qr.isDark(row, col)) path.push(`M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`)
    }
  }
  const extent = count + QUIET_ZONE * 2

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Scan to join this room"
    >
      <rect width={extent} height={extent} fill="#fff" />
      <path d={path.join("")} fill="#000" />
    </svg>
  )
}
