export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export function checkOrigin(req: Request) {
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  if (
    req.headers.get("origin") !== origin ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    fail(403, "Origin is not allowed");
}
export async function readJson(req: Request, max = 65536): Promise<unknown> {
  if (
    req.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    fail(415, "JSON required");
  if (Number(req.headers.get("content-length")) > max)
    fail(413, "Payload too large");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "JSON required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader!.cancel();
      fail(413, "Payload too large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Invalid JSON");
  }
}
