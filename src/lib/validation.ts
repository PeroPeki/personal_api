import { z } from "zod";
const n = (min: number, max: number) => z.number().finite().min(min).max(max);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return (
      !Number.isNaN(+d) &&
      d.toISOString().slice(0, 10) === v &&
      v >= "1900-01-01" &&
      v <= "2200-12-31"
    );
  }, "Invalid calendar date");
export const isoSchema = z.iso.datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    age: n(18, 110).int().optional(),
    heightCm: n(100, 250).optional(),
    sex: z.enum(["male", "female"]).optional(),
    massGoal: z.enum(["maintain", "lose", "gain"]).optional(),
    activityLevel: n(1.2, 2.2),
    aiConsent: z.boolean(),
    readingInterests: z.array(z.string().trim().min(1).max(80)).max(12),
    goals: z
      .object({
        learningMinutes: n(0, 720).int(),
        socialMinutes: n(0, 720).int(),
        steps: n(100, 100000).int(),
        sleepMinHours: n(3, 12),
        sleepMaxHours: n(3, 14),
        bedtime: time,
        wakeTime: time,
      })
      .strict()
      .refine((v) => v.sleepMaxHours >= v.sleepMinHours),
  })
  .strict();
export const profilePatchSchema = profileSchema.partial().extend({
  age: profileSchema.shape.age.nullable(),
  heightCm: profileSchema.shape.heightCm.nullable(),
  sex: profileSchema.shape.sex.nullable(),
  massGoal: profileSchema.shape.massGoal.nullable(),
});
const common = {
  id: z.uuid(),
  date: dateSchema,
  occurredAt: isoSchema,
  source: z.literal("manual").default("manual"),
};
const variants = [
  z
    .object({
      ...common,
      kind: z.literal("weight"),
      data: z.object({ kg: n(20, 400) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("workout"),
      data: z
        .object({
          type: z.string().trim().min(1).max(100),
          durationMinutes: n(1, 1440),
          note: z.string().max(2000).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("sleep"),
      data: z
        .object({
          bedtime: isoSchema,
          wakeTime: isoSchema,
          quality: n(1, 5).int(),
          awakeMinutes: n(0, 1440).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("nutrition"),
      data: z
        .object({
          calories: n(0, 15000).optional(),
          proteinGrams: n(0, 1000).optional(),
          carbsGrams: n(0, 2000).optional(),
          fatGrams: n(0, 1000).optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("social"),
      data: z
        .object({ minutes: n(0, 1440), note: z.string().max(2000).optional() })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("steps"),
      data: z.object({ count: n(0, 200000).int() }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("energy"),
      data: z.object({ activeCalories: n(0, 15000) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("measurement"),
      data: z
        .object({
          waistCm: n(30, 250).optional(),
          bodyFatPercent: n(2, 70).optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0),
    })
    .strict(),
] as const;
export const logSchema = z
  .discriminatedUnion("kind", variants)
  .superRefine((v, ctx) => {
    if (v.kind === "sleep") {
      const m =
        (+new Date(v.data.wakeTime) - +new Date(v.data.bedtime)) / 60000;
      if (m <= 0 || m > 1440 || (v.data.awakeMinutes ?? 0) > m)
        ctx.addIssue({ code: "custom", message: "Invalid sleep interval" });
    }
  });
export const importRecordSchema = z
  .object({
    externalId: z.string().min(1).max(200),
    metric: z.enum([
      "steps",
      "activeCalories",
      "weightKg",
      "sleepHours",
      "nutritionCalories",
      "proteinGrams",
    ]),
    date: dateSchema,
    value: n(0, 200000),
    source: z.string().max(100).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const max = {
      steps: 200000,
      activeCalories: 15000,
      weightKg: 400,
      sleepHours: 24,
      nutritionCalories: 15000,
      proteinGrams: 1000,
    }[v.metric];
    if (
      v.value > max ||
      (v.metric === "weightKg" && v.value < 20) ||
      (v.metric === "steps" && !Number.isInteger(v.value))
    )
      c.addIssue({ code: "custom", message: "Invalid metric value" });
  });
export const importSchema = z
  .object({
    records: z.array(importRecordSchema).min(1).max(500),
    timezone: profileSchema.shape.timezone.optional(),
  })
  .strict();
export const focusActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      id: z.uuid(),
      category: z.string().trim().min(1).max(100),
    })
    .strict(),
  ...(["pause", "resume", "finish"] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        id: z.uuid(),
        version: z.number().int().min(0),
      })
      .strict(),
  ),
  z
    .object({
      action: z.literal("correct"),
      id: z.uuid(),
      version: z.number().int().min(0),
      durationMinutes: n(0, 1440),
    })
    .strict(),
]);
export const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(1024),
  })
  .strict();
