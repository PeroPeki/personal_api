import { describe, it, expect } from "vitest";
import { logSchema, importSchema, profileSchema } from "../src/lib/validation";
import {
  splitIntervals,
  aggregate,
  bodyEstimates,
  defaultProfile,
} from "../src/lib/domain";
describe("boundary validation", () => {
  it("rejects impossible calendar dates and nonfinite health values", () => {
    const base = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "weight",
      date: "2026-02-30",
      occurredAt: "2026-02-28T12:00:00Z",
      source: "manual",
      data: { kg: 80 },
    };
    expect(logSchema.safeParse(base).success).toBe(false);
    expect(
      importSchema.safeParse({
        records: [
          { externalId: "a", metric: "steps", date: "2026-02-28", value: -2 },
        ],
      }).success,
    ).toBe(false);
  });
  it("does not permit a manual client to forge imported provenance", () => {
    expect(
      logSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        kind: "steps",
        date: "2026-10-15",
        occurredAt: "2026-10-15T12:00:00Z",
        source: "apple-health",
        healthKey: "steps",
        data: { count: 2 },
      }).success,
    ).toBe(false);
  });
  it("keeps optional physiology absent and rejects unknown profile keys", () => {
    expect(profileSchema.parse(defaultProfile).age).toBeUndefined();
    expect(
      profileSchema.safeParse({ ...defaultProfile, admin: true }).success,
    ).toBe(false);
  });
});
describe("time and truthful missing data", () => {
  it("splits UTC learning at Lisbon local midnight and excludes pauses", () => {
    expect(
      splitIntervals(
        [
          { start: "2026-07-01T22:30:00Z", end: "2026-07-02T00:30:00Z" },
          { start: "2026-07-02T01:00:00Z", end: "2026-07-02T01:30:00Z" },
        ],
        "Europe/Lisbon",
      ),
    ).toEqual({ "2026-07-01": 30, "2026-07-02": 120 });
  });
  it("counts elapsed time correctly across Lisbon DST rollback", () => {
    expect(
      splitIntervals(
        [{ start: "2026-10-25T00:30:00Z", end: "2026-10-25T02:30:00Z" }],
        "Europe/Lisbon",
      ),
    ).toEqual({ "2026-10-25": 120 });
  });
  it("leaves missing observations null and derives no physiology from incomplete profile", () => {
    const days = aggregate(
      [],
      [],
      defaultProfile,
      1,
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(days[0]).toMatchObject({
      date: "2026-10-15",
      learningMinutes: 0,
      steps: null,
      sleepHours: null,
      nutrition: null,
      weightKg: null,
    });
    expect(bodyEstimates(defaultProfile, 80, null)).toEqual({
      calories: null,
      proteinGrams: { min: 112, max: 160 },
      bodyFat: null,
    });
  });
  it("prefers explicit manual daily correction over import without summing source totals", () => {
    const base = {
      date: "2026-10-15",
      occurredAt: "2026-10-15T12:00:00Z",
      kind: "steps" as const,
    };
    const days = aggregate(
      [
        {
          ...base,
          id: "a",
          source: "apple-health",
          healthKey: "steps",
          data: { count: 8000 },
        },
        { ...base, id: "b", source: "manual", data: { count: 5000 } },
      ],
      [],
      defaultProfile,
      1,
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(days[0].steps).toBe(5000);
  });
});
it("caps unattended running focus at24h and unions overlapping corrected sessions", () => {
  const base = {
    category: "learning",
    status: "running" as const,
    version: 0,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
    durationMinutes: 0,
    correctedMinutes: null,
  };
  const session = {
    ...base,
    id: "a",
    intervals: [{ start: "2026-10-14T00:00:00Z", end: null }],
  };
  const days = aggregate(
    [],
    [session],
    { ...defaultProfile, timezone: "UTC" },
    7,
    new Date("2026-10-16T00:00:00Z"),
  );
  expect(days.reduce((sum, d) => sum + d.learningMinutes, 0)).toBe(1440);
  const corrected = {
    ...base,
    status: "finished" as const,
    correctedMinutes: 60,
    intervals: [{ start: "2026-10-15T12:00:00Z", end: "2026-10-15T12:30:00Z" }],
  };
  expect(
    aggregate(
      [],
      [
        { ...corrected, id: "b" },
        { ...corrected, id: "c" },
      ],
      { ...defaultProfile, timezone: "UTC" },
      1,
      new Date("2026-10-15T15:00:00Z"),
    )[0].learningMinutes,
  ).toBe(60);
});
