import "dotenv/config";
import { readFile } from "node:fs/promises";
import { sql } from "../src/lib/db";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(1492841)`;
    await tx.unsafe(
      await readFile(new URL("../db/001.sql", import.meta.url), "utf8"),
    );
  });
  console.log("Database migration 001 applied.");
}
main()
  .catch(() => {
    console.error("Migration failed. Check database configuration.");
    process.exitCode = 1;
  })
  .finally(() => sql.end());
