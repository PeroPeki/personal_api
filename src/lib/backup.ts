import { z } from "zod";
import { sql } from "./db";
import { fail } from "./http";
import {
  logSchema,
  profileSchema,
  dateSchema,
  isoSchema,
  importRecordSchema,
} from "./validation";
import { logRow, focusRow } from "./store";
import { MAX_ARCHIVE_BYTES, type ExportData, type LogRecord } from "./types";
const restoredLog = z
  .object({
    id: z.uuid(),
    kind: z.enum([
      "weight",
      "workout",
      "sleep",
      "nutrition",
      "social",
      "steps",
      "energy",
      "measurement",
    ]),
    date: dateSchema,
    occurredAt: isoSchema,
    source: z.enum(["manual", "apple-health"]),
    healthKey: z.string().max(80).optional(),
    data: z.record(z.string(), z.union([z.number().finite(), z.string()])),
    createdAt: isoSchema.optional(),
    updatedAt: isoSchema.optional(),
  })
  .strict()
  .superRefine((l, c) => {
    if (l.source === "manual") {
      if (
        l.healthKey ||
        !logSchema.safeParse({
          id: l.id,
          kind: l.kind,
          date: l.date,
          occurredAt: l.occurredAt,
          source: l.source,
          data: l.data,
        }).success
      )
        c.addIssue({ code: "custom", message: "Invalid manual record" });
    } else {
      const map: Record<string, [string, string]> = {
        steps: ["steps", "count"],
        activeCalories: ["energy", "activeCalories"],
        weightKg: ["weight", "kg"],
        sleepHours: ["sleep", "hours"],
        nutritionCalories: ["nutrition", "calories"],
        proteinGrams: ["nutrition", "proteinGrams"],
      };
      const keys = l.healthKey ? map[l.healthKey] : undefined;
      if (
        !keys ||
        l.kind !== keys[0] ||
        Object.keys(l.data).length !== 1 ||
        !importRecordSchema.safeParse({
          externalId: l.id,
          metric: l.healthKey,
          date: l.date,
          value: keys ? l.data[keys[1]] : undefined,
        }).success
      )
        c.addIssue({ code: "custom", message: "Invalid imported record" });
    }
  });
const restoredFocus = z
  .object({
    id: z.uuid(),
    category: z.string().min(1).max(100),
    status: z.enum(["running", "paused", "finished"]),
    intervals: z
      .array(z.object({ start: isoSchema, end: isoSchema.nullable() }).strict())
      .max(200),
    version: z.number().int().min(0),
    createdAt: isoSchema,
    updatedAt: isoSchema,
    durationMinutes: z.number().min(0).max(1440),
    correctedMinutes: z.number().min(0).max(1440).nullable(),
  })
  .strict()
  .superRefine((s, c) => {
    let prev = -Infinity;
    for (const [index, i] of s.intervals.entries()) {
      const a = +new Date(i.start),
        b = i.end ? +new Date(i.end) : Date.now();
      if (
        a < prev ||
        b < a ||
        b > Date.now() + 300000 ||
        (!i.end && (s.status !== "running" || index !== s.intervals.length - 1))
      )
        c.addIssue({ code: "custom", message: "Invalid focus intervals" });
      prev = b;
    }
    if (s.intervals.filter((i) => i.end === null).length > 1)
      c.addIssue({ code: "custom", message: "Multiple running intervals" });
  });
export const restoreSchema = z
  .object({
    version: z.literal(1),
    exportedAt: isoSchema,
    profile: profileSchema,
    logs: z.array(restoredLog).max(10000),
    focus: z.array(restoredFocus).max(2000),
    readingState: z
      .array(
        z
          .object({ articleId: z.string().min(1).max(200), read: z.boolean() })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((data, c) => {
    for (const rows of [data.logs, data.focus])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        c.addIssue({ code: "custom", message: "Duplicate IDs" });
    const keys = data.logs
      .filter((l) => l.source === "apple-health")
      .map((l) => l.healthKey + ":" + l.date);
    if (new Set(keys).size !== keys.length)
      c.addIssue({ code: "custom", message: "Duplicate import date/metric" });
    if (+new Date(data.exportedAt) > Date.now() + 300000)
      c.addIssue({ code: "custom", message: "Future export" });
  });
export async function exportData(userId: string): Promise<ExportData> {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const [user] = await tx`SELECT profile FROM users WHERE id=${userId}`;
    const logs =
      await tx`SELECT * FROM logs WHERE user_id=${userId} ORDER BY date,occurred_at LIMIT 10001`;
    const focus =
      await tx`SELECT * FROM focus_sessions WHERE user_id=${userId} ORDER BY created_at LIMIT 2001`;
    const state =
      await tx`SELECT article_id,read FROM reading_state WHERE user_id=${userId} LIMIT 1001`;
    if (logs.length > 10000 || focus.length > 2000 || state.length > 1000)
      fail(413, "Archive exceeds JSON export limits; use database backup");
    const data: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: user.profile,
      logs: logs.map(logRow),
      focus: focus.map(focusRow),
      readingState: state.map((r) => ({
        articleId: r.article_id as string,
        read: r.read as boolean,
      })),
    };
    if (
      Buffer.byteLength(JSON.stringify(data, null, 2), "utf8") >
      MAX_ARCHIVE_BYTES
    )
      fail(413, "Archive exceeds JSON export limits; use database backup");
    return data;
  });
}
export async function restoreData(userId: string, input: unknown) {
  const data = restoreSchema.parse(input);
  if (
    Buffer.byteLength(JSON.stringify(data, null, 2), "utf8") > MAX_ARCHIVE_BYTES
  )
    fail(413, "Archive exceeds JSON restore limits; use database backup");
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    await tx`DELETE FROM logs WHERE user_id=${userId}`;
    await tx`DELETE FROM focus_sessions WHERE user_id=${userId}`;
    await tx`DELETE FROM reading_state WHERE user_id=${userId}`;
    await tx`DELETE FROM daily_reading WHERE user_id=${userId}`;
    await tx`DELETE FROM integration_tokens WHERE user_id=${userId}`;
    await tx`DELETE FROM health_external_ids WHERE user_id=${userId}`;
    await tx`DELETE FROM ai_insights WHERE user_id=${userId}`;
    await tx`DELETE FROM ai_usage WHERE user_id=${userId}`;
    await tx`DELETE FROM job_runs WHERE user_id=${userId}`;
    const [generation] =
      await tx`UPDATE users SET profile=${tx.json({ ...data.profile, aiConsent: false })},data_generation=data_generation+1 WHERE id=${userId} RETURNING data_generation`;
    for (const l of data.logs as LogRecord[]) {
      await tx`INSERT INTO logs(id,user_id,kind,date,occurred_at,source,health_key,data) VALUES(${l.id},${userId},${l.kind},${l.date},${l.occurredAt},${l.source},${l.healthKey ?? null},${tx.json(l.data)})`;
    }
    for (const s of data.focus) {
      let remaining = 86400000;
      const intervals = s.intervals.flatMap((i) => {
        if (remaining <= 0) return [];
        const end = i.end
            ? +new Date(i.end)
            : Math.min(+new Date(data.exportedAt), Date.now()),
          start = +new Date(i.start);
        const duration = Math.min(remaining, Math.max(0, end - start));
        remaining -= duration;
        return [
          { start: i.start, end: new Date(start + duration).toISOString() },
        ];
      });
      await tx`INSERT INTO focus_sessions(id,user_id,category,status,intervals,version,corrected_minutes,created_at,updated_at) VALUES(${s.id},${userId},${s.category},'finished',${tx.json(intervals)},${s.version + 1},${s.correctedMinutes},${s.createdAt},now())`;
    }
    for (const state of data.readingState)
      await tx`INSERT INTO reading_state(user_id,article_id,read) SELECT ${userId},id,${state.read} FROM articles WHERE id=${state.articleId} ON CONFLICT(user_id,article_id) DO UPDATE SET read=excluded.read,updated_at=now()`;
    return generation.data_generation as number;
  });
}
export async function deleteData(userId: string) {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    await tx`DELETE FROM logs WHERE user_id=${userId}`;
    await tx`DELETE FROM focus_sessions WHERE user_id=${userId}`;
    await tx`DELETE FROM reading_state WHERE user_id=${userId}`;
    await tx`DELETE FROM daily_reading WHERE user_id=${userId}`;
    await tx`DELETE FROM ai_insights WHERE user_id=${userId}`;
    await tx`DELETE FROM ai_usage WHERE user_id=${userId}`;
    await tx`DELETE FROM integration_tokens WHERE user_id=${userId}`;
    await tx`DELETE FROM health_external_ids WHERE user_id=${userId}`;
    await tx`DELETE FROM push_subscriptions WHERE user_id=${userId}`;
    await tx`DELETE FROM job_runs WHERE user_id=${userId}`;
    const [generation] =
      await tx`UPDATE users SET profile=jsonb_set(profile,'{aiConsent}','false'::jsonb),data_generation=data_generation+1 WHERE id=${userId} RETURNING data_generation`;
    return generation.data_generation as number;
  });
}
