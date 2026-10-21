import postgres from "postgres";
// postgres connects only when the first query is executed, so builds need no DB.
export const sql = postgres(
  process.env.DATABASE_URL ??
    "postgres://unconfigured:unconfigured@localhost:5433/unconfigured",
  {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 5,
    transform: { undefined: null },
  },
);
export type DB = typeof sql;
