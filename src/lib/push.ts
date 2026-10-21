import { z } from "zod";
export function allowedPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".push.apple.com") ||
        u.hostname === "fcm.googleapis.com" ||
        u.hostname === "updates.push.services.mozilla.com")
    );
  } catch {
    return false;
  }
}
export const pushSchema = z
  .object({
    endpoint: z
      .url()
      .max(2048)
      .refine(allowedPushEndpoint, "Unsupported push endpoint"),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_=-]{50,200}$/),
        auth: z.string().regex(/^[A-Za-z0-9_=-]{16,100}$/),
      })
      .strict(),
  })
  .strict();
