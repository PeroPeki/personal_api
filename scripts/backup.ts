import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { encryptBackup, decryptBackup } from "./backup-crypto";

function main() {
  const keyPath = resolve(process.env.BACKUP_KEY_FILE || ".backup-key");
  const restoreIndex = process.argv.indexOf("--restore");
  const restoring = restoreIndex !== -1;
  if (
    restoring &&
    (!process.argv.includes("--confirm-overwrite") ||
      !process.argv[restoreIndex + 1])
  ) {
    throw new Error(
      "Restore overwrites the database. Use --restore FILE --confirm-overwrite after stopping app and worker.",
    );
  }
  if (!existsSync(keyPath)) {
    if (restoring)
      throw new Error(
        "Original backup key is missing. Restore cannot continue.",
      );
    writeFileSync(keyPath, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      "Created private backup key. Store a separate safe copy; without it backups cannot be restored.",
    );
  }
  const hex = readFileSync(keyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("Invalid backup key file");
  const key = Buffer.from(hex, "hex");
  if (restoring) {
    const dump = decryptBackup(
      readFileSync(resolve(process.argv[restoreIndex + 1])),
      key,
    );
    const result = spawnSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "db",
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--single-transaction",
        "-U",
        "personal",
        "-d",
        "personal",
      ],
      { input: dump, maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        "Database restore failed; inspect PostgreSQL service logs.",
      );
    console.log(
      "Database restored. Old sessions/tokens from this backup were also restored; revoke them before exposing the server.",
    );
  } else {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "db",
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "-U",
        "personal",
        "-d",
        "personal",
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.error || result.status !== 0)
      throw new Error("Database dump failed. Start the db service first.");
    mkdirSync("backups", { recursive: true, mode: 0o700 });
    const file = `backups/personal-${new Date().toISOString().replace(/[:.]/g, "-")}.pgdump.enc`;
    writeFileSync(file, encryptBackup(result.stdout, key), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(`Encrypted backup saved: ${file}`);
  }
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backup failed");
  process.exitCode = 1;
}
