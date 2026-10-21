import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptBackup, decryptBackup } from "../scripts/backup-crypto";

describe("encrypted database backup", () => {
  it("restores the exact binary dump", () => {
    const key = randomBytes(32);
    const dump = Buffer.from([0, 255, 4, 5, 0, 12]);
    const encrypted = encryptBackup(dump, key);
    expect(encrypted.equals(dump)).toBe(false);
    expect(decryptBackup(encrypted, key)).toEqual(dump);
  });
  it("rejects tampered dumps and the wrong key", () => {
    const key = randomBytes(32);
    const encrypted = encryptBackup(Buffer.from("private"), key);
    expect(() => decryptBackup(encrypted, randomBytes(32))).toThrow();
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptBackup(encrypted, key)).toThrow();
  });
  it("rejects invalid headers and keys", () => {
    expect(() =>
      decryptBackup(Buffer.from("not a backup"), randomBytes(32)),
    ).toThrow();
    expect(() => encryptBackup(Buffer.from("x"), Buffer.alloc(2))).toThrow();
  });
});
