import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { SettingsPanel } from "../settings-panel"
import { SessionProvider } from "../session"

// Controller ruling R5: the panel reads `useSession()` for the name field, so
// this render needs a `SessionProvider` ancestor even outside a full app tree
// — a minimal wrapper the panel legitimately needs, not a change to what the
// three assertions below check.
const renderPanel = (props: { open: boolean; onClose: () => void }) =>
  renderToStaticMarkup(
    <SessionProvider>
      <SettingsPanel {...props} />
    </SessionProvider>,
  )

describe("SettingsPanel", () => {
  it("groups the settings under the four headings", () => {
    const html = renderPanel({ open: true, onClose: () => {} })
    for (const heading of ["You", "Controls", "Motion", "Screen"]) {
      expect(html, heading).toContain(heading)
    }
  })

  it("is a dialog, so it sits over the screen it was opened from", () => {
    const html = renderPanel({ open: true, onClose: () => {} })
    expect(html).toContain('role="dialog"')
    expect(html).toContain("aria-modal")
  })

  it("renders nothing when closed", () => {
    expect(renderPanel({ open: false, onClose: () => {} })).toBe("")
  })
})
