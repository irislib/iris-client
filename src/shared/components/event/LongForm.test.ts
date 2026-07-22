import {createElement} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"
import type {NDKEvent} from "@/lib/ndk"
import LongForm from "./LongForm"

vi.mock("@/navigation", () => ({useNavigate: () => vi.fn()}))
vi.mock("../ProxyImg", () => ({default: "img"}))

describe("LongForm", () => {
  it("strips executable HTML and URLs from untrusted markdown", () => {
    const content = `# Safe article

<a href="javascript:alert(1)" onclick="alert(2)">unsafe link</a>

<img src="javascript:alert(3)" onerror="alert(4)" srcdoc="<script>alert(5)</script>">

<span dangerouslySetInnerHTML={{"__html":"<img src=x onerror=alert(6)>"}} />

[unsafe markdown](javascript:alert(7))

![safe image](https://safe.example/image.png)`
    const event = {
      id: "0".repeat(64),
      content,
      tagValue: (name: string) => (name === "title" ? "Security test" : undefined),
    } as NDKEvent

    const html = renderToStaticMarkup(createElement(LongForm, {event, standalone: true}))

    expect(html).toContain("Safe article")
    expect(html).toContain("https://safe.example/image.png")
    expect(html).toContain("&lt;a href=&quot;javascript:")
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('onclick="')
    expect(html).not.toContain('onerror="')
    expect(html).not.toContain('srcdoc="')
    expect(html).not.toContain("<script")
    expect(html).not.toContain('<img src="x"')
  })
})
