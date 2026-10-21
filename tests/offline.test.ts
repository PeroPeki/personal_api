import { describe, expect, it } from "vitest";
import {
  boundedFocusIntervals,
  currentLocalFocus,
  drainQueue,
  type QueueItem,
} from "../src/lib/offline";
const item: QueueItem = {
  id: "a",
  userId: "owner",
  path: "/logs",
  body: { id: "a" },
  createdAt: "2026-10-15T10:00:00Z",
  status: "pending",
};
describe("account-scoped offline delivery", () => {
  it("does not relabel a stale local timer with a new server generation", () => {
    const focus = { id: "local" } as import("../src/lib/types").FocusSession;
    expect(currentLocalFocus({ focus, dataGeneration: 2 }, 3)).toBeNull();
    expect(currentLocalFocus({ focus }, 3)).toBeNull();
    expect(currentLocalFocus({ focus, dataGeneration: 3 }, 3)).toBe(focus);
  });
  it("bounds unattended offline sessions to 24 hours across pauses", () => {
    const intervals = boundedFocusIntervals(
      [
        { start: "2026-10-10T00:00:00Z", end: "2026-10-10T12:00:00Z" },
        { start: "2026-10-11T00:00:00Z", end: null },
      ],
      new Date("2026-10-14T00:00:00Z").getTime(),
    );
    expect(intervals[1].end).toBe("2026-10-11T12:00:00.000Z");
    expect(
      intervals.reduce(
        (sum, i) =>
          sum + new Date(i.end).getTime() - new Date(i.start).getTime(),
        0,
      ),
    ).toBe(86400000);
  });
  it("never sends another account records", async () => {
    const sent: string[] = [];
    await drainQueue(
      [item, { ...item, id: "b", userId: "other" }],
      "owner",
      async (entry) => {
        sent.push(entry.id);
      },
      () => true,
    );
    expect(sent).toEqual(["a"]);
  });
  it("stops after a network failure and keeps stable ids for retry", async () => {
    const sent: string[] = [];
    const result = await drainQueue(
      [item, { ...item, id: "b" }],
      "owner",
      async (entry) => {
        sent.push(entry.id);
        throw new TypeError("offline");
      },
      () => true,
    );
    expect(sent).toEqual(["a"]);
    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([]);
  });
  it("does not resurrect completed state after a privacy purge", async () => {
    let active = true;
    const result = await drainQueue(
      [item, { ...item, id: "b" }],
      "owner",
      async () => {
        active = false;
      },
      () => active,
    );
    expect(result.completed).toEqual([]);
  });
  it("marks rejected payloads for human review instead of retry looping", async () => {
    const result = await drainQueue(
      [item],
      "owner",
      async () => {
        throw Object.assign(new Error("Sukob"), { status: 409 });
      },
      () => true,
    );
    expect(result.failed).toEqual([{ id: "a", error: "Sukob" }]);
  });
});
