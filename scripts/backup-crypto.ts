import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const MAGIC = Buffer.from("PAPIENC1");
function assertKey(key: Buffer) {
  if (key.length !== 32)
    throw new Error("Backup key must contain exactly 32 bytes");
}
export function encryptBackup(data: Buffer, key: Buffer): Buffer {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(data: Buffer, key: Buffer): Buffer {
  assertKey(key);
  if (data.length < 36 || !data.subarray(0, 8).equals(MAGIC))
    throw new Error("Invalid backup format");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(8, 20));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(data.subarray(20, 36));
  return Buffer.concat([decipher.update(data.subarray(36)), decipher.final()]);
}
