import { openDB } from "idb";
import type { Dashboard, FocusSession } from "./types";
export interface QueueItem {
  id: string;
  userId: string;
  dataGeneration?: number;
  path: string;
  body: unknown;
  createdAt: string;
  status: "pending" | "failed";
  error?: string;
}
interface Owner {
  id: string;
  email: string;
  verifiedAt: number;
  dataGeneration: number;
}
let generation = 0;
const privacyChannel =
  typeof BroadcastChannel !== "undefined" && typeof window !== "undefined"
    ? new BroadcastChannel("personal-privacy")
    : null;
privacyChannel?.addEventListener("message", () => {
  generation++;
  window.dispatchEvent(new Event("personal-privacy"));
});
const database = () =>
  openDB("personal-private-v1", 1, {
    upgrade(db) {
      db.createObjectStore("queue", { keyPath: "id" });
      db.createObjectStore("state");
    },
  });
export async function drainQueue(
  items: QueueItem[],
  userId: string,
  send: (item: QueueItem) => Promise<void>,
  active: () => boolean,
): Promise<{ completed: string[]; failed: { id: string; error: string }[] }> {
  const result: {
    completed: string[];
    failed: { id: string; error: string }[];
  } = { completed: [], failed: [] };
  for (const item of items
    .filter((q) => q.userId === userId && q.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!active()) break;
    try {
      await send(item);
      if (!active()) break;
      result.completed.push(item.id);
    } catch (error) {
      if (!active()) break;
      const status = (error as { status?: number }).status;
      if (status === 401 || !status || status >= 500) break;
      result.failed.push({
        id: item.id,
        error:
          error instanceof Error ? error.message : "Zahtjev nije prihvaćen",
      });
    }
  }
  return result;
}
export async function rememberOwner(owner: Omit<Owner, "verifiedAt">) {
  const epoch = generation;
  const db = await database();
  const previous = (await db.get("state", "owner")) as Owner | undefined;
  if (epoch !== generation) return;
  if (
    previous &&
    (previous.id !== owner.id ||
      previous.dataGeneration !== owner.dataGeneration)
  )
    await purgeLocal();
  await db.put("state", { ...owner, verifiedAt: Date.now() }, "owner");
}
export async function offlineOwner(): Promise<Owner | null> {
  const owner = (await (await database()).get("state", "owner")) as
    Owner | undefined;
  return owner && Date.now() - owner.verifiedAt < 7 * 86400000 ? owner : null;
}
export async function saveSnapshot(id: string, data: Dashboard) {
  const epoch = generation,
    db = await database();
  if (epoch !== generation) return;
  await db.put("state", data, `snapshot:${id}`);
}
export async function loadSnapshot(id: string): Promise<Dashboard | undefined> {
  return (await database()).get("state", `snapshot:${id}`);
}
export async function saveLocalFocus(
  id: string,
  focus: FocusSession | null,
  dataGeneration: number,
) {
  const epoch = generation;
  const db = await database();
  if (epoch !== generation)
    throw new Error(
      "Privatni podaci su promijenjeni. Ponovno otvori aplikaciju.",
    );
  if (focus) await db.put("state", { focus, dataGeneration }, `focus:${id}`);
  else await db.delete("state", `focus:${id}`);
}
export function currentLocalFocus(
  stored: { focus?: FocusSession; dataGeneration?: number } | undefined,
  dataGeneration: number,
): FocusSession | null {
  return stored?.dataGeneration === dataGeneration
    ? (stored.focus ?? null)
    : null;
}
export async function loadLocalFocus(
  id: string,
  dataGeneration: number,
): Promise<FocusSession | null> {
  return currentLocalFocus(
    await (await database()).get("state", `focus:${id}`),
    dataGeneration,
  );
}
export async function enqueue(item: QueueItem) {
  const epoch = generation;
  if (!["/logs", "/focus/import"].includes(item.path))
    throw new Error("Ova radnja zahtijeva vezu.");
  const db = await database();
  if (epoch !== generation)
    throw new Error(
      "Privatni podaci su promijenjeni. Ponovno otvori aplikaciju.",
    );
  await db.put("queue", item);
}
export async function queued(id: string): Promise<QueueItem[]> {
  return ((await (await database()).getAll("queue")) as QueueItem[]).filter(
    (item) => item.userId === id,
  );
}
export async function discardQueue(id: string) {
  await (await database()).delete("queue", id);
}
export async function retryQueue(id: string, userId: string) {
  const db = await database();
  const item = (await db.get("queue", id)) as QueueItem | undefined;
  if (item?.userId === userId)
    await db.put("queue", { ...item, status: "pending", error: undefined });
}
let flushing = false;
export async function flushQueue(
  userId: string,
  send: (item: QueueItem) => Promise<void>,
) {
  if (flushing) return;
  flushing = true;
  const epoch = generation;
  try {
    const items = await queued(userId),
      result = await drainQueue(
        items,
        userId,
        send,
        () => epoch === generation,
      );
    if (epoch !== generation) return;
    const db = await database(),
      tx = db.transaction("queue", "readwrite");
    for (const id of result.completed) await tx.store.delete(id);
    for (const failed of result.failed) {
      const original = items.find((item) => item.id === failed.id);
      if (original)
        await tx.store.put({
          ...original,
          status: "failed",
          error: failed.error,
        });
    }
    await tx.done;
  } finally {
    flushing = false;
  }
}
export async function purgeLocal() {
  generation++;
  privacyChannel?.postMessage({ purge: true });
  const db = await database(),
    tx = db.transaction(["state", "queue"], "readwrite");
  await Promise.all([
    tx.objectStore("state").clear(),
    tx.objectStore("queue").clear(),
  ]);
  await tx.done;
}

export function boundedFocusIntervals(
  intervals: FocusSession["intervals"],
  now = Date.now(),
) {
  let remaining = 24 * 60 * 60 * 1000;
  return intervals.flatMap((interval) => {
    const start = new Date(interval.start).getTime();
    const duration = Math.min(
      remaining,
      Math.max(0, new Date(interval.end ?? now).getTime() - start),
    );
    remaining -= duration;
    return duration > 0
      ? [
          {
            start: interval.start,
            end: new Date(start + duration).toISOString(),
          },
        ]
      : [];
  });
}
