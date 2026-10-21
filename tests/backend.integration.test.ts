import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { handle as Handle } from "../src/lib/api";
const enabled = !!process.env.DATABASE_URL;
describe.skipIf(!enabled)(
  "PostgreSQL API workflows in isolated temporary database",
  () => {
    let admin: ReturnType<typeof postgres>,
      db: ReturnType<typeof postgres>,
      handle: typeof Handle,
      cookie: string,
      userId: string;
    let dataGeneration = 0;
    const name = "personal_test_" + randomUUID().replaceAll("-", "");
    async function call(
      path: string,
      method = "GET",
      body?: unknown,
      extra: Record<string, string> = {},
    ) {
      const response = await handle(
        new Request("http://localhost:3000/api/v1/" + path, {
          method,
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            "x-data-generation": String(dataGeneration),
            ...(cookie ? { cookie } : {}),
            ...extra,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      if (
        response.ok &&
        ["auth/login", "restore", "data/delete"].includes(path)
      ) {
        const value = await response.clone().json();
        if (typeof value.dataGeneration === "number")
          dataGeneration = value.dataGeneration;
      }
      return response;
    }
    beforeAll(async () => {
      admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      const url = new URL(process.env.DATABASE_URL!);
      url.pathname = "/" + name;
      process.env.DATABASE_URL = url.toString();
      process.env.APP_ORIGIN = "http://localhost:3000";
      db = (await import("../src/lib/db")).sql;
      await db.unsafe(await readFile("db/001.sql", "utf8"));
      handle = (await import("../src/lib/api")).handle;
      userId = randomUUID();
      const { defaultProfile } = await import("../src/lib/domain");
      await db`INSERT INTO users(id,email,password_hash,profile) VALUES(${userId},'test@example.invalid',${await argon2.hash("test-password-123")},${db.json({ ...defaultProfile })})`;
      const r = await call("auth/login", "POST", {
        email: "test@example.invalid",
        password: "test-password-123",
      });
      expect(r.status).toBe(200);
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    }, 30000);
    afterAll(async () => {
      if (db) await db.end();
      if (admin) {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin.end();
      }
    });
    it("deduplicates offline UUID writes and rejects changed replay", async () => {
      const log = {
        id: randomUUID(),
        kind: "steps",
        date: "2026-10-15",
        occurredAt: "2026-10-15T12:00:00Z",
        source: "manual",
        data: { count: 5000 },
      };
      expect((await call("logs", "POST", log)).status).toBe(200);
      expect((await call("logs", "POST", log)).status).toBe(200);
      expect(
        (await call("logs", "POST", { ...log, data: { count: 6000 } })).status,
      ).toBe(409);
      expect(
        (await db`SELECT count(*)::int AS n FROM logs WHERE id=${log.id}`)[0].n,
      ).toBe(1);
    });
    it("imports batches atomically, replaces daily totals, and never allows bearer export", async () => {
      const token = (
        await (await call("integrations/token", "POST", {})).json()
      ).token;
      const headers = { authorization: `Bearer ${token}` };
      const record = {
        externalId: "one",
        metric: "steps",
        date: "2026-10-15",
        value: 8000,
      };
      expect(
        (await call("health/import", "POST", { records: [record] }, headers))
          .status,
      ).toBe(200);
      expect(
        (
          await call(
            "health/import",
            "POST",
            { records: [{ ...record, externalId: "two", value: 9000 }] },
            headers,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await db`SELECT count(*)::int AS n FROM logs WHERE source='apple-health'`
        )[0].n,
      ).toBe(1);
      expect(
        (
          await call(
            "health/import",
            "POST",
            {
              records: [
                { ...record, value: 12000 },
                { ...record, externalId: "bad", value: -1 },
              ],
            },
            headers,
          )
        ).status,
      ).toBe(400);
      expect(
        (await db`SELECT data FROM logs WHERE source='apple-health'`)[0].data
          .count,
      ).toBe(9000);
      expect((await call("export", "GET", undefined, headers)).status).toBe(
        401,
      );
      expect(
        (await db`SELECT token_hash FROM integration_tokens`)[0].token_hash,
      ).not.toBe(token);
    });
    it("serializes focus transitions, stale actions, and idempotent finish", async () => {
      const id = randomUUID();
      let r = await call("focus", "POST", {
        action: "start",
        id,
        category: "learning",
      });
      expect(r.status).toBe(200);
      expect(
        (
          await call("focus", "POST", {
            action: "start",
            id: randomUUID(),
            category: "learning",
          })
        ).status,
      ).toBe(409);
      r = await call("focus", "POST", { action: "pause", id, version: 0 });
      expect(r.status).toBe(200);
      expect(
        (await call("focus", "POST", { action: "pause", id, version: 0 }))
          .status,
      ).toBe(409);
      expect(
        (await call("focus", "POST", { action: "resume", id, version: 1 }))
          .status,
      ).toBe(200);
      r = await call("focus", "POST", { action: "finish", id, version: 2 });
      const finished = await r.json();
      expect(r.status).toBe(200);
      expect(
        await (
          await call("focus", "POST", { action: "finish", id, version: 2 })
        ).json(),
      ).toEqual(finished);
    });
    it("exports no auth hashes and rejects malformed restore without any changes", async () => {
      const data = await (await call("export")).json();
      expect(data.version).toBe(1);
      expect(JSON.stringify(data)).not.toMatch(
        /password|token_hash|password_hash/,
      );
      const before = (await db`SELECT count(*)::int AS n FROM logs`)[0].n;
      expect(
        (
          await call("restore", "POST", {
            ...data,
            logs: [...data.logs, { kind: "bad" }],
          })
        ).status,
      ).toBe(400);
      expect((await db`SELECT count(*)::int AS n FROM logs`)[0].n).toBe(before);
    });
    it("restores a valid archive atomically and closes running timers", async () => {
      const archive = await (await call("export")).json();
      expect((await call("restore", "POST", archive)).status).toBe(200);
      expect((await db`SELECT count(*)::int AS n FROM logs`)[0].n).toBe(
        archive.logs.length,
      );
      expect(
        (await db`SELECT count(*)::int AS n FROM integration_tokens`)[0].n,
      ).toBe(0);
    });
    it("replays an offline focus import without duplicates and rejects future intervals", async () => {
      const input = {
        id: randomUUID(),
        category: "learning",
        createdAt: "2026-10-15T10:00:00Z",
        intervals: [
          { start: "2026-10-15T10:00:00Z", end: "2026-10-15T10:30:00Z" },
        ],
      };
      expect((await call("focus/import", "POST", input)).status).toBe(200);
      expect((await call("focus/import", "POST", input)).status).toBe(200);
      expect(
        (
          await db`SELECT count(*)::int AS n FROM focus_sessions WHERE id=${input.id}`
        )[0].n,
      ).toBe(1);
      expect(
        (
          await call("focus/import", "POST", {
            ...input,
            id: randomUUID(),
            intervals: [
              { start: "2199-01-01T00:00:00Z", end: "2199-01-01T01:00:00Z" },
            ],
          })
        ).status,
      ).toBe(400);
    });
    it("clears previously saved optional physiology using explicit nulls", async () => {
      expect(
        (
          await call("profile", "PATCH", {
            age: 30,
            heightCm: 180,
            sex: "male",
            massGoal: "maintain",
          })
        ).status,
      ).toBe(200);
      const response = await call("profile", "PATCH", {
        age: null,
        heightCm: null,
        sex: null,
        massGoal: null,
      });
      expect(response.status).toBe(200);
      const { profile } = await response.json();
      for (const key of ["age", "heightCm", "sex", "massGoal"])
        expect(profile).not.toHaveProperty(key);
      expect(
        (await (await call("dashboard")).json()).estimates.calories,
      ).toBeNull();
    });
    it("uses manual daily weight correction consistently in chart and physiology estimates", async () => {
      const { localDate } = await import("../src/lib/domain");
      const date = localDate(new Date(), "Europe/Lisbon");
      const log = {
        id: randomUUID(),
        kind: "weight",
        date,
        occurredAt: date + "T08:00:00Z",
        source: "manual",
        data: { kg: 80 },
      };
      expect((await call("logs", "POST", log)).status).toBe(200);
      await db`INSERT INTO logs(id,user_id,kind,date,occurred_at,source,health_key,data) VALUES(${randomUUID()},${userId},'weight',${date},${date + "T12:00:00Z"},'apple-health','weightKg',${db.json({ kg: 90 })})`;
      const view = await (await call("dashboard")).json();
      expect(view.today.weightKg).toBe(80);
      expect(view.estimates.proteinGrams).toEqual({ min: 112, max: 160 });
    });
    it("rejects old-tab queued writes after restore and deletion using persisted generation", async () => {
      const me = await (await call("auth/me")).json();
      expect(me.dataGeneration).toBeTypeOf("number");
      const old = String(me.dataGeneration);
      const archive = await (await call("export")).json();
      expect((await call("restore", "POST", archive)).status).toBe(200);
      const staleLog = {
        id: randomUUID(),
        kind: "steps",
        date: "2026-10-15",
        occurredAt: "2026-10-15T12:00:00Z",
        source: "manual",
        data: { count: 42 },
      };
      expect(
        (await call("logs", "POST", staleLog, { "x-data-generation": old }))
          .status,
      ).toBe(409);
      expect(
        (await call("logs", "POST", staleLog, { "x-data-generation": "" }))
          .status,
      ).toBe(409);
      const beforeDelete = dataGeneration;
      expect(
        (await call("data/delete", "POST", { confirm: "DELETE MY DATA" }))
          .status,
      ).toBe(200);
      expect(dataGeneration).toBe(beforeDelete + 1);
      const offline = {
        id: randomUUID(),
        category: "learning",
        createdAt: "2026-10-15T10:00:00Z",
        intervals: [
          { start: "2026-10-15T10:00:00Z", end: "2026-10-15T10:30:00Z" },
        ],
      };
      expect(
        (
          await call("focus/import", "POST", offline, {
            "x-data-generation": String(beforeDelete),
          })
        ).status,
      ).toBe(409);
      expect((await db`SELECT count(*)::int AS n FROM logs`)[0].n).toBe(0);
      expect(
        (await db`SELECT count(*)::int AS n FROM focus_sessions`)[0].n,
      ).toBe(0);
      expect((await call("logs", "POST", staleLog)).status).toBe(200);
    });
    it("refuses AI without consent and clears personal records while retaining account", async () => {
      expect((await call("insights/generate", "POST", {})).status).toBe(403);
      expect(
        (await call("data/delete", "POST", { confirm: "DELETE MY DATA" }))
          .status,
      ).toBe(200);
      expect(
        (await db`SELECT count(*)::int AS n FROM integration_tokens`)[0].n,
      ).toBe(0);
      expect((await db`SELECT count(*)::int AS n FROM logs`)[0].n).toBe(0);
      expect((await call("auth/me")).status).toBe(200);
    });
    it("refuses an archive that would exceed the pretty UTF8 JSON restore cap", async () => {
      const note = "ž".repeat(1000);
      await db`INSERT INTO logs(id,user_id,kind,date,occurred_at,source,data) SELECT gen_random_uuid(),${userId},'workout','2026-10-15','2026-10-15T12:00:00Z','manual',${db.json({ type: "walk", durationMinutes: 10, note })} FROM generate_series(1,2200)`;
      const logs = await (await call("logs?days=90")).json();
      const profile = (await (await call("profile")).json()).profile;
      const fixture = {
        version: 1,
        exportedAt: new Date().toISOString(),
        profile,
        logs: logs.logs,
        focus: [],
        readingState: [],
      };
      expect(Buffer.byteLength(JSON.stringify(fixture), "utf8")).toBeLessThan(
        5242880,
      );
      expect(
        Buffer.byteLength(JSON.stringify(fixture, null, 2), "utf8"),
      ).toBeGreaterThan(5242880);
      expect((await call("export")).status).toBe(413);
      await db`DELETE FROM logs WHERE user_id=${userId}`;
    });
  },
);
