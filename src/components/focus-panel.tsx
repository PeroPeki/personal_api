"use client";
import { useEffect, useState } from "react";
import type { FocusSession, FocusAction } from "@/lib/types";
import { api, minutes, uuid, formatNumber } from "@/lib/client";
import { Field, Empty } from "./ui";
export function duration(session: FocusSession, now = Date.now()) {
  return (
    session.correctedMinutes ??
    Math.min(
      1440,
      session.intervals.reduce(
        (sum, i) =>
          sum +
          Math.max(0, (i.end ? +new Date(i.end) : now) - +new Date(i.start)) /
            60000,
        0,
      ),
    )
  );
}
export function FocusPanel({
  active,
  local,
  onAction,
  onLocalStart,
  onLocalAction,
  refresh,
  goalMinutes,
}: {
  active: FocusSession | null;
  local: FocusSession | null;
  onAction: (action: FocusAction) => Promise<void>;
  onLocalStart: (category: string) => Promise<void>;
  onLocalAction: (action: "pause" | "resume" | "finish") => Promise<void>;
  refresh: () => Promise<void>;
  goalMinutes: number;
}) {
  const [category, setCategory] = useState("Programiranje"),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recent, setRecent] = useState<FocusSession[]>([]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    api<{ recent: FocusSession[] }>("/focus")
      .then((data) => setRecent(data.recent))
      .catch(() => {});
  }, [active?.version, active?.id]);
  const session = local ?? active,
    elapsed = session ? duration(session, now) : 0;
  async function act(action: "start" | "pause" | "resume" | "finish") {
    setBusy(true);
    setError("");
    try {
      if (local) {
        await onLocalAction(action as "pause" | "resume" | "finish");
      } else if (action === "start") {
        if (!navigator.onLine) await onLocalStart(category);
        else await onAction({ action: "start", id: uuid(), category });
      } else if (session)
        await onAction({ action, id: session.id, version: session.version });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Radnja nije uspjela.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function correct(s: FocusSession) {
    const input = prompt(
      "Ispravljeno ukupno trajanje u minutama:",
      String(Math.round(duration(s))),
    );
    if (input === null) return;
    const value = Number(input);
    if (!Number.isFinite(value) || value < 0 || value > 1440) {
      setError("Trajanje treba biti između 0 i 1440 minuta.");
      return;
    }
    try {
      await onAction({
        action: "correct",
        id: s.id,
        version: s.version,
        durationMinutes: value,
      });
      await refresh();
      const response = await api<{ recent: FocusSession[] }>("/focus");
      setRecent(response.recent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ispravak nije spremljen.");
    }
  }
  return (
    <>
      <section className="panel focus-panel">
        <span className="eyebrow">Vrijeme za nešto novo</span>
        <h2>{session ? session.category : "Odvoji vrijeme za učenje."}</h2>
        <p className="muted">
          Tvoj prostor za programiranje, čitanje i projekte. Pauze se ne
          računaju.
        </p>
        <div className="timer" role="timer" aria-label="Proteklo vrijeme">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}
          <span>:</span>
          {String(Math.floor(elapsed % 60)).padStart(2, "0")}
          <small>
            {String(Math.floor((elapsed * 60) % 60)).padStart(2, "0")}
          </small>
        </div>
        <p className="status-label">
          {local
            ? "Lokalna sesija · sprema se na ovom uređaju"
            : session?.status === "paused"
              ? "Sesija je na pauzi"
              : session
                ? "Sesija je u tijeku"
                : `Cilj: ${goalMinutes} minuta dnevno`}
        </p>
        {!session && (
          <Field label="Što ćeš učiti?">
            <input
              maxLength={100}
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
        )}
        <div className="timer-actions">
          {!session ? (
            <button
              className="button"
              disabled={busy || !category.trim()}
              onClick={() => act("start")}
            >
              ▶ Počni učiti
            </button>
          ) : (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  act(session.status === "paused" ? "resume" : "pause")
                }
              >
                {session.status === "paused" ? "▶ Nastavi" : "Ⅱ Pauza"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => act("finish")}
              >
                Završi sesiju
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="footnote">
          Timer bilježi prijavljeno vrijeme. Ako izgubiš vezu tijekom serverske
          sesije, ponovno se poveži prije završetka i po potrebi ispravi
          trajanje.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Nedavne sesije</h2>
          <span className="muted">Bez pauza</span>
        </div>
        {recent.length ? (
          <ul className="record-list">
            {recent
              .filter((s) => s.status === "finished")
              .slice(0, 12)
              .map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.category}</strong>
                    <small>
                      {new Date(s.createdAt).toLocaleDateString("hr-HR")} ·{" "}
                      {s.correctedMinutes !== null ? "ispravljeno" : "timer"}
                    </small>
                  </div>
                  <span>{minutes(duration(s))}</span>
                  <button className="text-button" onClick={() => correct(s)}>
                    Ispravi
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <Empty title="Tvoja prva sesija tek dolazi" />
        )}
      </section>
      <aside className="note">
        <strong>Mir prije fokusa.</strong>
        <p>
          Za vrijeme učenja uključi ograničenja u ugrađenom Screen Timeu. Ova
          web aplikacija ne može blokirati druge iPhone aplikacije.
        </p>
      </aside>
    </>
  );
}
