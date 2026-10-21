import type {
  Profile,
  LogRecord,
  FocusSession,
  FocusInterval,
  DailyAggregate,
  BodyEstimates,
  Insight,
} from "./types";
export const defaultProfile: Profile = {
  displayName: "Petar",
  timezone: "Europe/Lisbon",
  activityLevel: 1.4,
  aiConsent: false,
  readingInterests: [
    "povijest",
    "geografija",
    "sportske priče",
    "misteriji",
    "pozitivne priče",
  ],
  goals: {
    learningMinutes: 180,
    socialMinutes: 60,
    steps: 8000,
    sleepMinHours: 7,
    sleepMaxHours: 9,
    bedtime: "01:00",
    wakeTime: "09:30",
  },
};
export function localDate(value: Date | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export function splitIntervals(
  intervals: FocusInterval[],
  timezone: string,
  now = new Date(),
): Record<string, number> {
  const ranges = intervals
    .map((i) => [+new Date(i.start), i.end ? +new Date(i.end) : +now])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [a, b] of ranges) {
    const prev = merged.at(-1);
    if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
    else merged.push([a, b]);
  }
  const result: Record<string, number> = {};
  for (const [start, end] of merged) {
    let cursor = start;
    while (cursor < end) {
      const day = localDate(new Date(cursor), timezone);
      let stop = end;
      if (localDate(new Date(end - 1), timezone) !== day) {
        let lo = cursor + 1,
          hi = Math.min(end, cursor + 36 * 3600000);
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (localDate(new Date(mid), timezone) === day) lo = mid + 1;
          else hi = mid;
        }
        stop = lo;
      }
      result[day] = (result[day] ?? 0) + (stop - cursor) / 60000;
      cursor = stop;
    }
  }
  return result;
}
export function focusDuration(
  session: Pick<FocusSession, "intervals" | "correctedMinutes">,
  now = new Date(),
): number {
  return (
    session.correctedMinutes ??
    Math.min(
      1440,
      session.intervals.reduce(
        (sum, i) =>
          sum +
          Math.max(0, +(i.end ? new Date(i.end) : now) - +new Date(i.start)) /
            60000,
        0,
      ),
    )
  );
}
export function aggregate(
  logs: LogRecord[],
  sessions: FocusSession[],
  profile: Profile,
  days: number,
  now = new Date(),
): DailyAggregate[] {
  const today = localDate(now, profile.timezone),
    dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const effective: FocusInterval[] = sessions.flatMap((s) => {
    if (s.correctedMinutes !== null) {
      const end = s.intervals.at(-1)?.end ?? s.updatedAt;
      return [
        {
          start: new Date(
            +new Date(end) - s.correctedMinutes * 60000,
          ).toISOString(),
          end,
        },
      ];
    }
    let remaining = 86400000;
    return s.intervals.flatMap((i) => {
      if (remaining <= 0) return [];
      const start = +new Date(i.start),
        end = i.end ? +new Date(i.end) : +now,
        duration = Math.min(remaining, Math.max(0, end - start));
      remaining -= duration;
      return [
        { start: i.start, end: new Date(start + duration).toISOString() },
      ];
    });
  });
  const learning = splitIntervals(effective, profile.timezone, now);
  return dates.map((date) => {
    const rows = logs
      .filter((l) => l.date === date)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const latest = (
      kind: string,
      key: string,
      healthKey?: string,
    ): number | null => {
      const matched = rows.filter(
        (l) =>
          l.kind === kind &&
          typeof l.data[key] === "number" &&
          (!healthKey || l.source === "manual" || l.healthKey === healthKey),
      );
      const manual = matched.filter((l) => l.source === "manual");
      const row = (manual.length ? manual : matched).at(-1);
      return row ? Number(row.data[key]) : null;
    };
    const nutrition = Object.fromEntries(
      ["calories", "proteinGrams", "carbsGrams", "fatGrams"].map((key) => {
        const manual = rows.filter(
          (l) =>
            l.kind === "nutrition" &&
            l.source === "manual" &&
            typeof l.data[key] === "number",
        );
        const keyMetric = key === "calories" ? "nutritionCalories" : key;
        const imported = rows
          .filter(
            (l) =>
              l.kind === "nutrition" &&
              l.source === "apple-health" &&
              l.healthKey === keyMetric,
          )
          .at(-1);
        return [
          key,
          manual.length
            ? manual.reduce((sum, l) => sum + Number(l.data[key]), 0)
            : imported
              ? Number(imported.data[key])
              : null,
        ];
      }),
    ) as NonNullable<DailyAggregate["nutrition"]>;
    const sleepManual = rows.filter(
      (l) => l.kind === "sleep" && l.source === "manual",
    );
    let sleepHours: number | null = null;
    if (sleepManual.length) {
      sleepHours = sleepManual.reduce(
        (sum, l) =>
          sum +
          (+new Date(String(l.data.wakeTime)) -
            +new Date(String(l.data.bedtime))) /
            3600000 -
          Number(l.data.awakeMinutes ?? 0) / 60,
        0,
      );
    } else sleepHours = latest("sleep", "hours", "sleepHours");
    const workouts = rows.filter((l) => l.kind === "workout");
    const social = rows.filter((l) => l.kind === "social");
    return {
      date,
      learningMinutes: Math.round((learning[date] ?? 0) * 100) / 100,
      steps: latest("steps", "count", "steps"),
      activeCalories: latest("energy", "activeCalories", "activeCalories"),
      weightKg: latest("weight", "kg", "weightKg"),
      sleepHours,
      socialMinutes: social.length
        ? social.reduce((s, l) => s + Number(l.data.minutes), 0)
        : null,
      nutrition: Object.values(nutrition).every((v) => v === null)
        ? null
        : nutrition,
      workoutMinutes: workouts.length
        ? workouts.reduce((s, l) => s + Number(l.data.durationMinutes), 0)
        : null,
      workoutCount: workouts.length || null,
    };
  });
}
export function bodyEstimates(
  profile: Profile,
  weight: number | null,
  waist: number | null,
): BodyEstimates {
  let calories: BodyEstimates["calories"] = null,
    bodyFat: BodyEstimates["bodyFat"] = null;
  if (
    weight &&
    profile.age &&
    profile.heightCm &&
    profile.sex &&
    profile.massGoal
  ) {
    const resting =
      10 * weight +
      6.25 * profile.heightCm -
      5 * profile.age +
      (profile.sex === "male" ? 5 : -161);
    calories = {
      resting: Math.round(resting),
      maintenance: Math.round(resting * profile.activityLevel),
      label:
        "Procjena održavanja (Mifflin–St Jeor); aktivne kalorije nisu dodatak prehrani.",
    };
  }
  if (waist && profile.heightCm && profile.sex) {
    const percent =
      64 -
      20 * (profile.heightCm / waist) +
      (profile.sex === "female" ? 12 : 0);
    if (percent >= 2 && percent <= 70)
      bodyFat = {
        percent: Math.round(percent * 10) / 10,
        label: "RFM procjena iz visine i opsega struka; nije mjerenje.",
      };
  }
  return {
    calories,
    proteinGrams: weight
      ? { min: Math.round(weight * 1.4), max: Math.round(weight * 2) }
      : null,
    bodyFat,
  };
}
export function ruleInsights(
  history: DailyAggregate[],
  profile: Profile,
): Insight[] {
  const today = history.at(-1);
  if (!today) return [];
  const rules: Insight[] = [];
  if (
    today.sleepHours !== null &&
    today.sleepHours < profile.goals.sleepMinHours
  )
    rules.push({
      id: "sleep",
      kind: "rule",
      title: "Kraći san",
      text: "Zabilježeni san je ispod tvog cilja. Razmotri mirniju večer i dosljedno vrijeme spavanja.",
    });
  if (today.learningMinutes < profile.goals.learningMinutes)
    rules.push({
      id: "learning",
      kind: "rule",
      title: "Prostor za učenje",
      text: `Zabilježeno je ${Math.round(today.learningMinutes)} od ${profile.goals.learningMinutes} planiranih minuta. Timer bilježi vrijeme, ne potvrđuje naučeno.`,
    });
  if (
    !history.some(
      (d) => d.steps !== null || d.sleepHours !== null || d.nutrition !== null,
    )
  )
    rules.push({
      id: "missing",
      kind: "rule",
      title: "Podaci još nedostaju",
      text: "Dodaj zapis ili poveži Apple Health za osobni pregled. Nedostajući podaci nisu nula.",
    });
  return rules;
}
