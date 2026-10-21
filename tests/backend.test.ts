import { describe, it, expect } from "vitest";
import { handle } from "../src/lib/api";
const req = (
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  new Request("http://localhost:3000/api/v1/" + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
describe("privacy boundaries before database access", () => {
  it("rejects cross-site and missing-origin writes even on login", async () => {
    expect(
      (
        await handle(
          req("auth/login", "POST", { email: "x@x.test", password: "a" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handle(
          req(
            "auth/login",
            "POST",
            { email: "x@x.test", password: "a" },
            { origin: "https://evil.test" },
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("never lets a bearer token access private reads", async () => {
    const r = await handle(
      req("export", "GET", undefined, { authorization: "Bearer secret" }),
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("protects private reads and rejects non-JSON cookie writes", async () => {
    expect((await handle(req("profile"))).status).toBe(401);
    const r = await handle(
      new Request("http://localhost:3000/api/v1/auth/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "text/plain",
        },
        body: "{}",
      }),
    );
    expect(r.status).toBe(415);
  });
});
import { allowedPushEndpoint } from "../src/lib/push";
it("only accepts HTTPS push provider endpoints and blocks arbitrary internal destinations", () => {
  expect(allowedPushEndpoint("https://web.push.apple.com/x")).toBe(true);
  expect(allowedPushEndpoint("https://fcm.googleapis.com/x")).toBe(true);
  for (const url of [
    "http://fcm.googleapis.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://evil.test/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://u:p@web.push.apple.com/x",
    "https://web.push.apple.com:444/x",
  ])
    expect(allowedPushEndpoint(url)).toBe(false);
});
