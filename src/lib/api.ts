import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sql } from "./db";
import { ApiError, fail, json, checkOrigin, readJson } from "./http";
import {
  authenticate,
  login,
  sessionCookie,
  cookieToken,
  hashToken,
  importUser,
} from "./auth";
import { profilePatchSchema, profileSchema } from "./validation";
import {
  saveLog,
  getLogs,
  getFocus,
  changeFocus,
  dashboard,
  importHealth,
  importFocus,
} from "./store";
import { exportData, restoreData, deleteData } from "./backup";
import { generateInsights, aiConfiguration } from "./insights";
import { pushSchema } from "./push";
import { localDate } from "./domain";
import {
  MAX_ARCHIVE_BYTES,
  type Article,
  type Insight,
  type Profile,
} from "./types";
function daysParam(url: URL) {
  const value = url.searchParams.get("days") ?? "30";
  if (!["7", "30", "90"].includes(value)) fail(400, "days must be 7, 30 or 90");
  return Number(value);
}
function requestGeneration(req: Request): number | null {
  const raw = req.headers.get("x-data-generation");
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
export async function handle(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url),
      path = url.pathname.replace(/^\/api\/v1\//, "").replace(/\/$/, ""),
      method = req.method;
    const write = !["GET", "HEAD"].includes(method);
    let body: unknown;
    if (path === "health/import" && method === "POST") {
      const userId = await importUser(req);
      body = await readJson(req, 1024 * 1024);
      const imported = await importHealth(
        userId,
        body,
        hashToken(req.headers.get("authorization")!.slice(7)),
      );
      return json({ ok: true, imported });
    }
    if (write) {
      checkOrigin(req);
      body = await readJson(
        req,
        path === "restore" ? MAX_ARCHIVE_BYTES : 65536,
      );
    }
    if (path === "auth/login" && method === "POST") {
      const result = await login(body);
      return json(
        {
          user: result.user,
          profile: result.profile,
          dataGeneration: result.dataGeneration,
        },
        200,
        {
          "Set-Cookie": sessionCookie(result.token),
        },
      );
    }
    const user = await authenticate(req);
    if (path === "auth/me" && method === "GET")
      return json({
        user: { id: user.id, email: user.email },
        profile: user.profile,
        dataGeneration: user.dataGeneration,
      });
    if (path === "auth/logout" && method === "POST") {
      const token = cookieToken(req);
      if (token)
        await sql`DELETE FROM sessions WHERE token_hash=${hashToken(token)}`;
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }
    if (path === "profile" && method === "GET")
      return json({ profile: user.profile });
    if (path === "profile" && method === "PATCH") {
      const patch = profilePatchSchema.parse(body);
      const profile = await sql.begin(async (tx) => {
        const [current] =
          await tx`SELECT profile FROM users WHERE id=${user.id} FOR UPDATE`;
        const merged = { ...current.profile, ...patch };
        for (const key of ["age", "heightCm", "sex", "massGoal"])
          if (merged[key] === null) delete merged[key];
        const next = profileSchema.parse(merged);
        await tx`UPDATE users SET profile=${tx.json(next)} WHERE id=${user.id}`;
        if (!next.aiConsent)
          await tx`DELETE FROM ai_insights WHERE user_id=${user.id}`;
        return next;
      });
      return json({ profile });
    }
    if (path === "logs" && method === "GET")
      return json({
        logs: await getLogs(user.id, daysParam(url), user.profile),
      });
    if (path === "logs" && (method === "POST" || method === "PATCH"))
      return json({
        log: await saveLog(
          user.id,
          body,
          user.profile,
          method === "PATCH",
          requestGeneration(req),
        ),
      });
    if (path === "logs" && method === "DELETE") {
      const { id } = z.object({ id: z.uuid() }).strict().parse(body);
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
        const [record] =
          await tx`SELECT source FROM logs WHERE id=${id} AND user_id=${user.id}`;
        if (record && record.source !== "manual")
          fail(409, "Imported records require an explicit manual correction");
        await tx`DELETE FROM logs WHERE id=${id} AND user_id=${user.id}`;
      });
      return json({ ok: true });
    }
    if (path === "focus" && method === "GET")
      return json(await getFocus(user.id));
    if (path === "focus" && method === "POST")
      return json({ session: await changeFocus(user.id, body) });
    if (path === "focus/import" && method === "POST")
      return json({
        session: await importFocus(user.id, body, requestGeneration(req)),
      });
    if (path === "dashboard" && method === "GET")
      return json(await dashboard(user.id, user.profile, daysParam(url)));
    if (path === "history" && method === "GET")
      return json({
        history: (await dashboard(user.id, user.profile, daysParam(url)))
          .history,
      });
    if (path === "export" && method === "GET")
      return json(await exportData(user.id));
    if (path === "restore" && method === "POST") {
      const dataGeneration = await restoreData(user.id, body);
      return json({ ok: true, dataGeneration });
    }
    if (path === "data/delete" && method === "POST") {
      z.object({ confirm: z.literal("DELETE MY DATA") })
        .strict()
        .parse(body);
      const dataGeneration = await deleteData(user.id);
      return json({ ok: true, dataGeneration });
    }
    if (path === "reading" && method === "GET") {
      const date = localDate(new Date(), user.profile.timezone);
      const rows =
        await sql`SELECT a.id,a.title,a.url,a.source,a.summary,a.minutes,coalesce(s.read,false) AS read,(d.article_id IS NOT NULL) AS selected FROM articles a LEFT JOIN reading_state s ON s.article_id=a.id AND s.user_id=${user.id} LEFT JOIN daily_reading d ON d.article_id=a.id AND d.user_id=${user.id} AND d.date=${date} ORDER BY selected DESC,a.published_at DESC LIMIT 50`;
      return json({ articles: rows as unknown as Article[], date });
    }
    if (path === "reading" && method === "POST") {
      const input = z
        .object({ articleId: z.string().min(1).max(200), read: z.boolean() })
        .strict()
        .parse(body);
      if (
        !(await sql`SELECT id FROM articles WHERE id=${input.articleId}`).length
      )
        fail(404, "Article not found");
      await sql`INSERT INTO reading_state(user_id,article_id,read) VALUES(${user.id},${input.articleId},${input.read}) ON CONFLICT(user_id,article_id) DO UPDATE SET read=excluded.read,updated_at=now()`;
      return json({ ok: true });
    }
    if (path === "insights" && method === "GET") {
      const view = await dashboard(user.id, user.profile, 7);
      let ai: Insight | null = null;
      if (user.profile.aiConsent) {
        const [row] =
          await sql`SELECT id,text,created_at FROM ai_insights WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 1`;
        if (row)
          ai = {
            id: row.id,
            title: "AI osvrt",
            text: row.text,
            kind: "ai",
            createdAt: new Date(row.created_at).toISOString(),
          };
      }
      const config = aiConfiguration();
      return json({
        rules: view.insights,
        ai,
        configured: config.configured,
        provider: config.configured ? config.provider : null,
      });
    }
    if (path === "insights/generate" && method === "POST")
      return json({ insight: await generateInsights(user.id) });
    if (path === "integrations" && method === "GET") {
      const [r] =
        await sql`SELECT created_at,last_sync FROM integration_tokens WHERE user_id=${user.id}`;
      return json({
        active: !!r,
        createdAt: r ? new Date(r.created_at).toISOString() : null,
        lastHealthSync: r?.last_sync
          ? new Date(r.last_sync).toISOString()
          : null,
      });
    }
    if (path === "integrations/token" && method === "POST") {
      const token = randomBytes(32).toString("hex");
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
        await tx`INSERT INTO integration_tokens(user_id,token_hash) VALUES(${user.id},${hashToken(token)}) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=now(),last_sync=NULL`;
      });
      return json({ token });
    }
    if (path === "integrations" && method === "DELETE") {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
        await tx`DELETE FROM integration_tokens WHERE user_id=${user.id}`;
      });
      return json({ ok: true });
    }
    if (path === "push" && method === "GET") {
      const config = !!(
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT
      );
      const [r] =
        await sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=${user.id}`;
      return json({
        configured: config,
        publicKey: config ? process.env.VAPID_PUBLIC_KEY : null,
        subscribed: r.n > 0,
      });
    }
    if (path === "push" && method === "POST") {
      if (
        !process.env.VAPID_PUBLIC_KEY ||
        !process.env.VAPID_PRIVATE_KEY ||
        !process.env.VAPID_SUBJECT
      )
        fail(503, "Push is not configured");
      const subscription = pushSchema.parse(body);
      await sql`INSERT INTO push_subscriptions(user_id,endpoint,subscription) VALUES(${user.id},${subscription.endpoint},${sql.json(subscription)}) ON CONFLICT(user_id,endpoint) DO UPDATE SET subscription=excluded.subscription`;
      return json({ ok: true });
    }
    if (path === "push" && method === "DELETE") {
      const { endpoint } = z
        .object({ endpoint: z.string().max(2048).optional() })
        .strict()
        .parse(body);
      if (endpoint)
        await sql`DELETE FROM push_subscriptions WHERE user_id=${user.id} AND endpoint=${endpoint}`;
      else await sql`DELETE FROM push_subscriptions WHERE user_id=${user.id}`;
      return json({ ok: true });
    }
    return json({ error: "Endpoint not found" }, 404);
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        {
          error:
            "Invalid request: " +
            error.issues
              .slice(0, 3)
              .map((i) => i.path.join(".") || i.message)
              .join(", "),
        },
        400,
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    )
      return json({ error: "Record conflict" }, 409);
    console.error(
      "API request failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return json({ error: "Service unavailable" }, 503);
  }
}
