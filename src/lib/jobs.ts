import webpush from "web-push";
import { sql } from "./db";
import { localDate } from "./domain";
import { FEEDS, fetchFeed, inWindDownWindow } from "./feeds";
import { generateInsights } from "./insights";
import type { Profile } from "./types";

export async function refreshReading(): Promise<number> {
  let total = 0;
  for (const feed of FEEDS) {
    try {
      const articles = await fetchFeed(feed);
      for (const article of articles) {
        await sql`INSERT INTO articles(id,title,url,source,summary,minutes,published_at)
          VALUES(${article.id},${article.title},${article.url},${article.source},${article.summary},${article.minutes},${article.publishedAt})
          ON CONFLICT(url) DO UPDATE SET title=excluded.title,summary=excluded.summary`;
        total++;
      }
    } catch {
      console.warn(
        `Reading source unavailable: ${feed.name}. Existing articles retained.`,
      );
    }
  }
  return total;
}
function allowedPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".push.apple.com") ||
        ["fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(
          u.hostname,
        ))
    );
  } catch {
    return false;
  }
}
async function claim(
  userId: string,
  job: string,
  date: string,
): Promise<boolean> {
  const rows =
    await sql`INSERT INTO job_runs(user_id,job,date) VALUES(${userId},${job},${date}) ON CONFLICT DO NOTHING RETURNING job`;
  return rows.length > 0;
}
export async function runDailyJobs(): Promise<void> {
  // A transaction-level lock releases automatically on crashes and bounds concurrency across worker replicas.
  await sql.begin(async (lock) => {
    const [lease] =
      await lock`SELECT pg_try_advisory_xact_lock(476381728) AS acquired`;
    if (!lease.acquired) return;
    const users = await sql<
      { id: string; profile: Profile }[]
    >`SELECT id,profile FROM users`;
    for (const user of users) {
      const now = new Date(),
        date = localDate(now, user.profile.timezone);
      const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: user.profile.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      const [selected] =
        await sql`SELECT article_id FROM daily_reading WHERE user_id=${user.id} AND date=${date} LIMIT 1`;
      if (!selected) {
        const rows =
          await sql`SELECT a.id,a.title,a.summary FROM articles a WHERE NOT EXISTS(SELECT 1 FROM reading_state r WHERE r.user_id=${user.id} AND r.article_id=a.id AND r.read=true) ORDER BY a.published_at DESC LIMIT 100`;
        const interests = user.profile.readingInterests.map((v) =>
          v.toLowerCase(),
        );
        const score = (r: (typeof rows)[number]) =>
          interests.reduce(
            (n, v) =>
              n +
              (String(r.title + " " + r.summary)
                .toLowerCase()
                .includes(v)
                ? 1
                : 0),
            0,
          );
        rows.sort((a, b) => score(b) - score(a));
        if (rows[0])
          await sql`INSERT INTO daily_reading(user_id,date,article_id) VALUES(${user.id},${date},${rows[0].id}) ON CONFLICT DO NOTHING`;
      }
      if (
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        inWindDownWindow(user.profile.goals.bedtime, time)
      ) {
        const subscriptions =
          await sql`SELECT endpoint,subscription FROM push_subscriptions WHERE user_id=${user.id}`;
        if (subscriptions.length && (await claim(user.id, "wind-down", date))) {
          webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || "mailto:you@example.com",
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY,
          );
          for (const sub of subscriptions) {
            if (!allowedPushEndpoint(sub.endpoint)) continue;
            try {
              await webpush.sendNotification(
                sub.subscription,
                JSON.stringify({
                  title: "Vrijeme za mirniju večer",
                  body: "Tvoj tekst za čitanje je spreman. Društvene mreže ograniči kroz Screen Time.",
                  url: "/",
                }),
                { TTL: 1800, timeout: 10000 },
              );
            } catch (error) {
              const status = (error as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410)
                await sql`DELETE FROM push_subscriptions WHERE user_id=${user.id} AND endpoint=${sub.endpoint}`;
            }
          }
        }
      }
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: user.profile.timezone,
        weekday: "short",
      }).format(now);
      const hour = Number(time.slice(0, 2));
      if (
        weekday === "Sun" &&
        hour >= 18 &&
        hour < 22 &&
        user.profile.aiConsent &&
        process.env.AI_API_KEY &&
        process.env.AI_BASE_URL &&
        process.env.AI_MODEL &&
        (await claim(user.id, "weekly-insight", date))
      ) {
        try {
          await generateInsights(user.id);
        } catch {
          console.warn(
            "Weekly AI summary unavailable; local rule insights remain available.",
          );
        }
      }
    }
  });
}
