import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, unlink, access } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import argon2 from "argon2";
import { z } from "zod";
import { sql } from "../src/lib/db";
import { defaultProfile } from "../src/lib/domain";
async function hiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error("An interactive terminal is required");
  process.stdout.write("Password (at least 12 characters): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (data: Buffer) => {
      for (const char of data.toString()) {
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
        } else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const generated = process.argv.includes("--generate");
  const emailArg = process.argv.indexOf("--email");
  let email = emailArg >= 0 ? process.argv[emailArg + 1] : undefined;
  let password: string;
  if (generated) {
    email = email ?? "petar@personal.local";
    password = randomBytes(24).toString("base64url");
    try {
      await access(".local-credentials");
      throw new Error("Credentials file already exists");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  } else {
    if (!email) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      email = await rl.question("Email: ");
      rl.close();
    }
    password = await hiddenPassword();
  }
  email = z.email().max(254).parse(email).toLowerCase();
  if (password.length < 12 || password.length > 1024)
    throw new Error("Password must contain 12–1024 characters");
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });
  let wrote = false;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(1492842)`;
      if ((await tx`SELECT id FROM users LIMIT 1`).length)
        throw new Error("Private account already exists");
      if (generated) {
        await writeFile(
          ".local-credentials",
          `URL=${process.env.APP_ORIGIN ?? "http://localhost:3000"}\nEMAIL=${email}\nPASSWORD=${password}\n`,
          { mode: 0o600, flag: "wx" },
        );
        wrote = true;
      }
      await tx`INSERT INTO users(id,email,password_hash,profile) VALUES(${randomUUID()},${email},${hash},${tx.json({ ...defaultProfile })})`;
    });
  } catch (e) {
    if (wrote) await unlink(".local-credentials");
    throw e;
  }
  console.log(
    generated
      ? "Created private account. Credentials: .local-credentials"
      : "Private account created.",
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof z.ZodError
        ? "Invalid email."
        : e instanceof Error
          ? e.message
          : "Account creation failed",
    );
    process.exitCode = 1;
  })
  .finally(() => sql.end());
