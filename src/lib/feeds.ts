import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export const FEEDS = [
  { name: "JSTOR Daily", url: "https://daily.jstor.org/feed/" },
  { name: "NASA", url: "https://www.nasa.gov/feed/" },
] as const;
export interface FeedArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string;
  minutes: number;
  publishedAt: Date;
}
function text(value: unknown): string {
  if (typeof value === "object" && value !== null && "#text" in value)
    return text((value as Record<string, unknown>)["#text"]);
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|apos|#39);/g,
      (x) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&#39;": "'",
        })[x] || x,
    )
    .replace(/\s+/g, " ")
    .trim();
}
export function safeReadingUrl(value: string, source: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    const allowed =
      source === "NASA"
        ? ["nasa.gov", "www.nasa.gov", "science.nasa.gov", "www.jpl.nasa.gov"]
        : ["daily.jstor.org"];
    if (!allowed.includes(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export function parseFeed(xml: string, source: string): FeedArticle[] {
  if (Buffer.byteLength(xml) > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsafe feed");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
  }).parse(xml);
  const raw = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const items: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : [raw];
  return items.slice(0, 30).flatMap((item) => {
    const link = Array.isArray(item.link)
      ? item.link.find(
          (v: Record<string, string>) =>
            !v["@_rel"] || v["@_rel"] === "alternate",
        )
      : item.link;
    const linkValue =
      typeof link === "object" && link !== null
        ? (link as Record<string, unknown>)["@_href"]
        : link;
    const url = safeReadingUrl(text(linkValue), source),
      title = text(item.title).slice(0, 250);
    if (!url || !title) return [];
    const date = new Date(text(item.pubDate ?? item.published ?? item.updated));
    return [
      {
        id: createHash("sha256").update(url).digest("hex"),
        title,
        url,
        source,
        summary: text(item.description ?? item.summary).slice(0, 450),
        minutes: 5,
        publishedAt: Number.isFinite(+date) ? date : new Date(),
      },
    ];
  });
}
export function inWindDownWindow(bedtime: string, now: string): boolean {
  const minutes = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const start = (minutes(bedtime) - 30 + 1440) % 1440;
  return (minutes(now) - start + 1440) % 1440 < 30;
}
export async function fetchFeed(
  source: (typeof FEEDS)[number],
): Promise<FeedArticle[]> {
  let url = source.url as string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!safeReadingUrl(url, source.name))
        throw new Error("Feed redirect outside allowlist");
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "PersonalAPI/0.1 (+private RSS reader)",
          Accept:
            "application/rss+xml,application/atom+xml,application/xml,text/xml",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Invalid feed redirect");
        url = new URL(location, url).href;
        await response.body?.cancel();
        continue;
      }
      if (!response.ok || !response.body) throw new Error("Feed unavailable");
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error("Feed too large");
        }
        chunks.push(chunk.value);
      }
      return parseFeed(Buffer.concat(chunks).toString("utf8"), source.name);
    }
    throw new Error("Too many feed redirects");
  } finally {
    clearTimeout(timer);
  }
}
