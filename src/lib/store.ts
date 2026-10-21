import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "./db";
import { fail } from "./http";
import {
  localDate,
  aggregate,
  focusDuration,
  bodyEstimates,
  ruleInsights,
} from "./domain";
import {
  logSchema,
  importSchema,
  focusActionSchema,
  isoSchema,
} from "./validation";
import type {
  LogRecord,
  Profile,
  FocusSession,
  Dashboard,
  FocusInterval,
} from "./types";
type Row = Record<string, any>;
export function logRow(r: Row): LogRecord {
  return {
    id: r.id,
    kind: r.kind,
    date:
      typeof r.date === "string"
        ? r.date.slice(0, 10)
        : r.date.toISOString().slice(0, 10),
    occurredAt: new Date(r.occurred_at).toISOString(),
    source: r.source,
    ...(r.health_key ? { healthKey: r.health_key } : {}),
    data: r.data,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
export function focusRow(r: Row): FocusSession {
  const s: FocusSession = {
    id: r.id,
    category: r.category,
    status: r.status,
    intervals: r.intervals,
    version: r.version,
    correctedMinutes:
      r.corrected_minutes === null ? null : Number(r.corrected_minutes),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    durationMinutes: 0,
  };
  s.durationMinutes = focusDuration(s);
  return s;
}
function sameLog(a: LogRecord, b: LogRecord) {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.date === b.date &&
    +new Date(a.occurredAt) === +new Date(b.occurredAt) &&
    a.source === b.source &&
    JSON.stringify(Object.entries(a.data).sort()) ===
      JSON.stringify(Object.entries(b.data).sort())
  );
}
export async function saveLog(
  userId: string,
  input: unknown,
  profile: Profile,
  patch = false,
  generation: number | null = null,
) {
  const parsed = logSchema.parse(input);
  const log: LogRecord = {
    ...parsed,
    occurredAt: new Date(parsed.occurredAt).toISOString(),
  };
  if (
    log.kind === "sleep" &&
    localDate(String(log.data.wakeTime), profile.timezone) !== log.date
  )
    fail(400, "Sleep date must match local wake date");
  return sql.begin(async (tx) => {
    const [account] =
      await tx`SELECT data_generation FROM users WHERE id=${userId} FOR UPDATE`;
    if (
      !patch &&
      (generation === null || account.data_generation !== generation)
    )
      fail(409, "Data generation changed; discard stale offline data");
    const [existing] = await tx`SELECT * FROM logs WHERE id=${log.id}`;
    if (existing) {
      if (existing.user_id !== userId || existing.source !== "manual")
        fail(409, "Record is not editable");
      if (!patch) {
        if (!sameLog(logRow(existing), log))
          fail(409, "ID reused with different data");
        return logRow(existing);
      }
    } else if (patch) fail(404, "Log not found");
    const [r] =
      await tx`INSERT INTO logs(id,user_id,kind,date,occurred_at,source,data) VALUES(${log.id},${userId},${log.kind},${log.date},${log.occurredAt},'manual',${tx.json(log.data)}) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,date=excluded.date,occurred_at=excluded.occurred_at,data=excluded.data,updated_at=now() RETURNING *`;
    return logRow(r);
  });
}
export async function getLogs(userId: string, days: number, profile: Profile) {
  const today = localDate(new Date(), profile.timezone);
  return (
    await sql`SELECT * FROM logs WHERE user_id=${userId} AND date>=${today}::date-(${days - 1}::int) AND date<=${today}::date ORDER BY date DESC,occurred_at DESC LIMIT 10000`
  ).map(logRow);
}
export async function getFocus(userId: string) {
  const rows =
    await sql`SELECT * FROM focus_sessions WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 100`;
  const focus = rows.map(focusRow);
  return {
    active: focus.find((s) => s.status !== "finished") ?? null,
    recent: focus.filter((s) => s.status === "finished").slice(0, 30),
  };
}
export async function changeFocus(userId: string, input: unknown) {
  const action = focusActionSchema.parse(input);
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const [row] =
      await tx`SELECT * FROM focus_sessions WHERE id=${action.id} FOR UPDATE`;
    const now = new Date().toISOString();
    if (action.action === "start") {
      if (row) {
        if (row.user_id !== userId || row.category !== action.category)
          fail(409, "Focus ID reused");
        return focusRow(row);
      }
      if (
        (
          await tx`SELECT id FROM focus_sessions WHERE user_id=${userId} AND status<>'finished' LIMIT 1`
        ).length
      )
        fail(409, "A focus session is already active");
      const [created] =
        await tx`INSERT INTO focus_sessions(id,user_id,category,status,intervals) VALUES(${action.id},${userId},${action.category},'running',${tx.json([{ start: now, end: null }])}) RETURNING *`;
      return focusRow(created);
    }
    if (!row || row.user_id !== userId) fail(404, "Focus session not found");
    if (action.action === "finish" && row.status === "finished")
      return focusRow(row);
    if (row.version !== action.version)
      fail(409, "Focus session changed; refresh before retrying");
    let intervals: FocusInterval[] = row.intervals,
      status = row.status,
      corrected = row.corrected_minutes;
    if (action.action === "correct") {
      if (status !== "finished")
        fail(409, "Only finished sessions can be corrected");
      corrected = action.durationMinutes;
    } else if (action.action === "pause") {
      if (status !== "running") fail(409, "Session is not running");
      intervals = intervals.map((i) =>
        i.end === null ? { ...i, end: now } : i,
      );
      status = "paused";
    } else if (action.action === "resume") {
      if (status !== "paused") fail(409, "Session is not paused");
      if (focusDuration({ intervals, correctedMinutes: null }) >= 1440)
        fail(409, "Session maximum duration reached");
      intervals = [...intervals, { start: now, end: null }];
      status = "running";
    } else {
      if (status !== "running" && status !== "paused")
        fail(409, "Session is already closed");
      intervals = intervals.map((i) =>
        i.end === null ? { ...i, end: now } : i,
      );
      status = "finished";
    }
    // Bound unattended timers to 24 hours of total counted intervals.
    let remaining = 1440 * 60000;
    intervals = intervals.flatMap((i) => {
      if (remaining <= 0) return [];
      const end = i.end ? +new Date(i.end) : +new Date(now),
        start = +new Date(i.start),
        duration = Math.max(0, end - start);
      const bounded = Math.min(remaining, duration);
      remaining -= bounded;
      return [
        {
          start: i.start,
          end:
            duration > bounded
              ? new Date(start + bounded).toISOString()
              : i.end,
        },
      ];
    });
    if (remaining <= 0 && status === "running") status = "finished";
    const [updated] =
      await tx`UPDATE focus_sessions SET status=${status},intervals=${tx.json(intervals.map((i) => ({ ...i })))},corrected_minutes=${corrected},version=version+1,updated_at=now() WHERE id=${action.id} RETURNING *`;
    return focusRow(updated);
  });
}
export const offlineFocusSchema = z
  .object({
    id: z.uuid(),
    category: z.string().trim().min(1).max(100),
    createdAt: isoSchema,
    intervals: z
      .array(z.object({ start: isoSchema, end: isoSchema }).strict())
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((s, c) => {
    let last = -Infinity,
      total = 0;
    for (const i of s.intervals) {
      const a = +new Date(i.start),
        b = +new Date(i.end);
      if (
        a < last ||
        b <= a ||
        b > Date.now() + 300000 ||
        a < +new Date(s.createdAt)
      )
        c.addIssue({ code: "custom", message: "Invalid focus intervals" });
      last = b;
      total += b - a;
    }
    if (total > 86400000 || +new Date(s.createdAt) > Date.now() + 300000)
      c.addIssue({ code: "custom", message: "Invalid focus duration" });
  });
export async function importFocus(
  userId: string,
  input: unknown,
  generation: number | null,
) {
  const s = offlineFocusSchema.parse(input);
  return sql.begin(async (tx) => {
    const [account] =
      await tx`SELECT data_generation FROM users WHERE id=${userId} FOR UPDATE`;
    if (generation === null || account.data_generation !== generation)
      fail(409, "Data generation changed; discard stale offline data");
    const [r] = await tx`SELECT * FROM focus_sessions WHERE id=${s.id}`;
    if (r) {
      if (
        r.user_id !== userId ||
        r.category !== s.category ||
        JSON.stringify(
          (r.intervals as FocusInterval[]).map((i) => [i.start, i.end]),
        ) !== JSON.stringify(s.intervals.map((i) => [i.start, i.end])) ||
        +r.created_at !== +new Date(s.createdAt)
      )
        fail(409, "Focus ID reused");
      return focusRow(r);
    }
    const [created] =
      await tx`INSERT INTO focus_sessions(id,user_id,category,status,intervals,created_at) VALUES(${s.id},${userId},${s.category},'finished',${tx.json(s.intervals)},${s.createdAt}) RETURNING *`;
    return focusRow(created);
  });
}
export async function importHealth(
  userId: string,
  input: unknown,
  credentialHash: string,
) {
  const batch = importSchema.parse(input);
  const mapping = {
    steps: ["steps", "count"],
    activeCalories: ["energy", "activeCalories"],
    weightKg: ["weight", "kg"],
    sleepHours: ["sleep", "hours"],
    nutritionCalories: ["nutrition", "calories"],
    proteinGrams: ["nutrition", "proteinGrams"],
  } as const;
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    if (
      !(
        await tx`SELECT user_id FROM integration_tokens WHERE user_id=${userId} AND token_hash=${credentialHash}`
      ).length
    )
      fail(401, "Integration revoked");
    for (const r of batch.records) {
      const [known] =
        await tx`SELECT date::text FROM health_external_ids WHERE user_id=${userId} AND external_id=${r.externalId} AND metric=${r.metric}`;
      if (known && known.date !== r.date)
        fail(409, "External ID reused for a different date");
      await tx`INSERT INTO health_external_ids(user_id,external_id,metric,date) VALUES(${userId},${r.externalId},${r.metric},${r.date}) ON CONFLICT DO NOTHING`;
      const [kind, key] = mapping[r.metric];
      await tx`INSERT INTO logs(id,user_id,kind,date,occurred_at,source,health_key,external_id,data) VALUES(${randomUUID()},${userId},${kind},${r.date},${r.date + "T12:00:00Z"},'apple-health',${r.metric},${r.externalId},${tx.json({ [key]: r.value })}) ON CONFLICT(user_id,source,health_key,date) WHERE health_key IS NOT NULL DO UPDATE SET data=excluded.data,external_id=excluded.external_id,updated_at=now()`;
    }
    await tx`UPDATE integration_tokens SET last_sync=now() WHERE user_id=${userId}`;
    return batch.records.length;
  });
}
export async function dashboard(
  userId: string,
  profile: Profile,
  days: number,
): Promise<Dashboard> {
  const logs = await getLogs(userId, days, profile),
    today = localDate(new Date(), profile.timezone);
  const focus = (
    await sql`SELECT * FROM focus_sessions WHERE user_id=${userId} AND (updated_at>=${today}::date-(${days}::int) OR status<>'finished') ORDER BY created_at DESC LIMIT 2000`
  ).map(focusRow);
  const history = aggregate(logs, focus, profile, days);
  const [integration] =
    await sql`SELECT last_sync FROM integration_tokens WHERE user_id=${userId}`;
  const [weight] =
    await sql`SELECT data FROM logs WHERE user_id=${userId} AND kind='weight' ORDER BY date DESC,(source='manual') DESC,occurred_at DESC LIMIT 1`;
  const [measurement] =
    await sql`SELECT data FROM logs WHERE user_id=${userId} AND kind='measurement' AND data ? 'waistCm' ORDER BY date DESC,occurred_at DESC LIMIT 1`;
  return {
    profile,
    today: history.at(-1)!,
    history,
    recentLogs: logs.slice(0, 100),
    activeFocus: focus.find((s) => s.status !== "finished") ?? null,
    lastHealthSync: integration?.last_sync
      ? new Date(integration.last_sync).toISOString()
      : null,
    insights: ruleInsights(history, profile),
    estimates: bodyEstimates(
      profile,
      weight?.data.kg ?? null,
      measurement?.data.waistCm ?? null,
    ),
  };
}
