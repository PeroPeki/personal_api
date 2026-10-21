import { describe, it, expect } from "vitest";
import { parseFeed, inWindDownWindow } from "../src/lib/feeds";
describe("reading source boundary", () => {
  it("keeps safe source links and strips markup from descriptions", () => {
    const xml =
      "<rss><channel><item><title>A story</title><link>https://daily.jstor.org/story/</link><description><![CDATA[<p>A <b>real</b> story.</p>]]></description></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item><item><title>Other</title><link>https://example.com/</link></item></channel></rss>";
    const rows = parseFeed(xml, "JSTOR Daily");
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("A real story.");
    expect(rows[0].url).toBe("https://daily.jstor.org/story/");
  });
  it("rejects entity declarations and oversized XML", () => {
    expect(() =>
      parseFeed('<!DOCTYPE rss [<!ENTITY x "secret">]><rss/>', "NASA"),
    ).toThrow();
    expect(() => parseFeed("a".repeat(2_000_001), "NASA")).toThrow();
  });
  it("supports midnight-spanning wind down without notifications hours late", () => {
    expect(inWindDownWindow("00:10", "23:50")).toBe(true);
    expect(inWindDownWindow("01:00", "00:35")).toBe(true);
    expect(inWindDownWindow("01:00", "09:30")).toBe(false);
    expect(inWindDownWindow("01:00", "01:00")).toBe(false);
  });
});
