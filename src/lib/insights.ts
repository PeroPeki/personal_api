import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { dashboard } from "./store";
import { fail } from "./http";
import type { Insight, Profile } from "./types";
export function aiConfiguration() {
  const raw = process.env.AI_BASE_URL,
    model = process.env.AI_MODEL,
    key = process.env.AI_API_KEY;
  let url: URL | null = null;
  try {
    if (raw) {
      url = new URL(raw.endsWith("/") ? raw : raw + "/");
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        url = null;
      else if (!url.pathname.endsWith("/chat/completions/"))
        url = new URL("chat/completions", url);
      else url.pathname = url.pathname.slice(0, -1);
    }
  } catch {
    url = null;
  }
  const budget = Number(process.env.AI_MONTHLY_LIMIT_CENTS ?? 500),
    reservation = Number(process.env.AI_CALL_RESERVATION_CENTS ?? 100);
  return {
    configured: !!(
      url &&
      model &&
      key &&
      Number.isSafeInteger(budget) &&
      budget > 0 &&
      Number.isSafeInteger(reservation) &&
      reservation > 0 &&
      reservation <= budget
    ),
    url,
    model,
    key,
    budget,
    reservation,
    provider: process.env.AI_PROVIDER_NAME ?? "Configured provider",
  };
}
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, "Empty provider response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const r = await reader!.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 65536) {
      await reader!.cancel();
      fail(502, "Provider response too large");
    }
    chunks.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(502, "Invalid provider response");
  }
}
export async function generateInsights(userId: string): Promise<Insight> {
  const [user] = await sql`SELECT profile FROM users WHERE id=${userId}`;
  if (!user?.profile.aiConsent) fail(403, "AI consent required");
  const config = aiConfiguration();
  if (!config.configured) fail(503, "AI provider is not configured");
  const view = await dashboard(userId, user.profile as Profile, 7);
  const observed = view.history.filter((d) => d.sleepHours !== null),
    steps = view.history.filter((d) => d.steps !== null);
  const summary = {
    days: 7,
    loggedSleepDays: observed.length,
    averageSleepHours: observed.length
      ? Math.round(
          (observed.reduce((s, d) => s + d.sleepHours!, 0) / observed.length) *
            10,
        ) / 10
      : null,
    loggedStepsDays: steps.length,
    averageSteps: steps.length
      ? Math.round(steps.reduce((s, d) => s + d.steps!, 0) / steps.length)
      : null,
    learningMinutes: view.history.reduce((s, d) => s + d.learningMinutes, 0),
    learningGoalMinutesPerDay: user.profile.goals.learningMinutes,
    workoutCount: view.history.reduce((s, d) => s + (d.workoutCount ?? 0), 0),
  };
  const month = new Date().toISOString().slice(0, 7);
  await sql.begin(async (tx) => {
    const [current] =
      await tx`SELECT profile FROM users WHERE id=${userId} FOR UPDATE`;
    if (!current?.profile.aiConsent) fail(403, "AI consent revoked");
    await tx`INSERT INTO ai_usage(user_id,month,reserved_cents) VALUES(${userId},${month},0) ON CONFLICT DO NOTHING`;
    const [used] =
      await tx`UPDATE ai_usage SET reserved_cents=reserved_cents+${config.reservation} WHERE user_id=${userId} AND month=${month} AND reserved_cents+${config.reservation}<=${config.budget} RETURNING reserved_cents`;
    if (!used) fail(429, "Monthly AI budget reached");
  });
  const [consent] = await sql`SELECT profile FROM users WHERE id=${userId}`;
  if (!consent?.profile.aiConsent) fail(403, "AI consent revoked");
  let response: Response;
  try {
    response = await fetch(config.url!, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 500,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "Odgovori na hrvatskom. Daj do tri kratka praktična prijedloga na temelju agregata navika. Nema dijagnoza, medicinskih preporuka, tvrdnji o uzroku ili potvrde stvarnog učenja. Nedostajući podaci nisu nula. Ne preporučuj kalorijski deficit.",
          },
          { role: "user", content: JSON.stringify(summary) },
        ],
      }),
    });
  } catch {
    fail(502, "AI provider could not be reached");
  }
  if (!response!.ok) fail(502, "AI provider rejected the request");
  const result = await boundedResponse(response!);
  const content = result?.choices?.[0]?.message?.content;
  if (
    typeof content !== "string" ||
    content.length < 1 ||
    content.length > 12000
  )
    fail(502, "Invalid AI response");
  const id = randomUUID();
  return sql.begin(async (tx) => {
    const [current] =
      await tx`SELECT profile FROM users WHERE id=${userId} FOR UPDATE`;
    if (!current?.profile.aiConsent) fail(403, "AI consent revoked");
    const [r] =
      await tx`INSERT INTO ai_insights(id,user_id,text,provider) VALUES(${id},${userId},${content},${config.provider}) RETURNING created_at`;
    return {
      id,
      kind: "ai" as const,
      title: "AI osvrt",
      text: content,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}
