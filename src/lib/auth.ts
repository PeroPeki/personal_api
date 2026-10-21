import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { sql } from "./db";
import { ApiError, fail } from "./http";
import { loginSchema } from "./validation";
import type { Profile } from "./types";
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function cookieToken(req: Request): string | null {
  const value = req.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("personal_session="))
    ?.slice(17);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function sessionCookie(token: string, maxAge = 604800) {
  const secure = (process.env.APP_ORIGIN ?? "").startsWith("https://");
  return `personal_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export async function authenticate(req: Request): Promise<{
  id: string;
  email: string;
  profile: Profile;
  dataGeneration: number;
}> {
  if (req.headers.has("authorization")) fail(401, "Session required");
  const token = cookieToken(req);
  if (!token) fail(401, "Authentication required");
  const rows =
    await sql`SELECT u.id,u.email,u.profile,u.data_generation AS "dataGeneration" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hashToken(token!)} AND s.expires_at>now()`;
  if (!rows[0]) fail(401, "Session expired");
  return rows[0] as {
    id: string;
    email: string;
    profile: Profile;
    dataGeneration: number;
  };
}
export async function login(input: unknown) {
  const data = loginSchema.parse(input);
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4928200)`;
    await tx`INSERT INTO login_throttle(key) VALUES('single-account') ON CONFLICT DO NOTHING`;
    await tx`UPDATE login_throttle SET attempts=0,window_start=now() WHERE key='single-account' AND window_start<now()-interval '15 minutes'`;
    const [r] =
      await tx`SELECT attempts FROM login_throttle WHERE key='single-account' FOR UPDATE`;
    if (r.attempts >= 5)
      throw new ApiError(429, "Too many attempts. Try again in 15 minutes.");
    await tx`UPDATE login_throttle SET attempts=attempts+1 WHERE key='single-account'`;
  });
  const [user] =
    await sql`SELECT id,email,password_hash,profile,data_generation AS "dataGeneration" FROM users WHERE email=${data.email}`;
  let valid = false;
  if (user) {
    valid = await argon2.verify(user.password_hash, data.password);
  } else {
    await argon2.hash(data.password, { type: argon2.argon2id });
  }
  if (!valid) fail(401, "Invalid email or password");
  const token = randomBytes(32).toString("hex");
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sessions WHERE expires_at<now()`;
    await tx`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${hashToken(token)},${user.id},now()+interval '7 days')`;
    await tx`UPDATE login_throttle SET attempts=0 WHERE key='single-account'`;
  });
  return {
    token,
    user: { id: user.id as string, email: user.email as string },
    profile: user.profile as Profile,
    dataGeneration: user.dataGeneration as number,
  };
}
export async function importUser(req: Request): Promise<string> {
  const value = req.headers.get("authorization");
  if (!value?.startsWith("Bearer ") || value.length > 200)
    fail(401, "Integration bearer token required");
  const token = value!.slice(7);
  const [row] =
    await sql`SELECT user_id FROM integration_tokens WHERE token_hash=${hashToken(token)}`;
  if (!row) fail(401, "Invalid integration token");
  return row.user_id;
}
