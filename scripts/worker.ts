import "dotenv/config";
import { refreshReading, runDailyJobs } from "../src/lib/jobs";
import { sql } from "../src/lib/db";

let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
async function main() {
  let lastFeed = 0;
  do {
    try {
      if (Date.now() - lastFeed > 6 * 60 * 60 * 1000) {
        await refreshReading();
        lastFeed = Date.now();
      }
      await runDailyJobs();
      console.log(`Worker cycle finished ${new Date().toISOString()}`);
    } catch {
      console.warn(
        "Worker cycle failed; check database connectivity and migration status.",
      );
    }
    if (process.argv.includes("--once")) break;
    for (let i = 0; i < 60 && !stopped; i++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopped);
  await sql.end({ timeout: 5 });
}
main().catch(() => {
  console.error("Worker stopped");
  process.exitCode = 1;
});
