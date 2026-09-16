import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { QrCode } from "../QrCode"

describe("QrCode", () => {
  it("renders an svg that scales to its box", () => {
    const html = renderToStaticMarkup(<QrCode value="http://192.168.1.5:41595/" />)

    expect(html).toContain("<svg")
    expect(html).toContain("viewBox")
  })

  it("encodes more modules for a longer value", () => {
    const short = renderToStaticMarkup(<QrCode value="http://a/" />)
    const long = renderToStaticMarkup(
      <QrCode value={`http://192.168.1.5:41595/#/join?room=W3SZ&x=${"y".repeat(200)}`} />,
    )
    const modules = (s: string) => Number(/viewBox="0 0 (\d+)/.exec(s)?.[1] ?? 0)

    expect(modules(long)).toBeGreaterThan(modules(short))
  })

  it("surrounds the code with the quiet zone a scanner needs", () => {
    // Four modules each side, inside the SVG so no stylesheet can remove it.
    const html = renderToStaticMarkup(<QrCode value="http://192.168.1.5:41595/" />)
    const extent = Number(/viewBox="0 0 (\d+)/.exec(html)?.[1] ?? 0)
    const firstDark = /M(\d+),(\d+)h1v1h-1z/.exec(html)

    expect(firstDark?.[1]).toBe("4")
    expect(firstDark?.[2]).toBe("4")
    // A version-2 code is 25 modules, so 25 + 4 + 4.
    expect(extent).toBe(33)
  })

  it("renders nothing for an empty value rather than throwing", () => {
    expect(renderToStaticMarkup(<QrCode value="" />)).toBe("")
  })
})
