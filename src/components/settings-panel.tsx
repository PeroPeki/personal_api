"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Profile, IntegrationStatus, InsightsResponse } from "@/lib/types";
import { api } from "@/lib/client";
import { purgeLocal } from "@/lib/offline";
import { Field } from "./ui";
export function SettingsPanel({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (purged?: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Profile>(profile),
    [status, setStatus] = useState<IntegrationStatus | null>(null),
    [ai, setAi] = useState<InsightsResponse | null>(null),
    [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [push, setPush] = useState<{
      configured: boolean;
      publicKey: string | null;
      subscribed: boolean;
    } | null>(null);
  const load = () =>
    Promise.all([
      api<IntegrationStatus>("/integrations").then(setStatus),
      api<InsightsResponse>("/insights").then(setAi),
      api<{
        configured: boolean;
        publicKey: string | null;
        subscribed: boolean;
      }>("/push").then(setPush),
    ]);
  useEffect(() => {
    load().catch(() =>
      setError("Postavke integracija nisu dostupne bez veze."),
    );
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Radnja nije uspjela.");
    } finally {
      setBusy(false);
    }
  }
  const goal = (key: keyof Profile["goals"], value: number | string) =>
    setDraft({ ...draft, goals: { ...draft.goals, [key]: value } });
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api<{ profile: Profile }>("/profile", "PATCH", {
        ...draft,
        age: draft.age ?? null,
        heightCm: draft.heightCm ?? null,
        sex: draft.sex ?? null,
        massGoal: draft.massGoal ?? null,
      });
      setDraft(result.profile);
      setMessage("Postavke su spremljene.");
      await onSaved();
      await load();
    });
  }
  async function notifications() {
    await run(async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error(
          "Ovaj preglednik ne podržava Web Push. Na iPhoneu dodaj aplikaciju na početni zaslon i koristi HTTPS.",
        );
      const registration = await navigator.serviceWorker.ready;
      if (push?.subscribed) {
        const sub = await registration.pushManager.getSubscription();
        await api("/push", "DELETE", sub ? { endpoint: sub.endpoint } : {});
        await sub?.unsubscribe();
      } else {
        if (!push?.publicKey)
          throw new Error("Najprije konfiguriraj VAPID ključeve na serveru.");
        if ((await Notification.requestPermission()) !== "granted")
          throw new Error(
            "Obavijesti nisu dopuštene. Možeš promijeniti dopuštenje u postavkama uređaja.",
          );
        const base = push.publicKey.replace(/-/g, "+").replace(/_/g, "/"),
          raw = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
        const key = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
        const sub =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          }));
        await api("/push", "POST", sub.toJSON());
      }
      await load();
      setMessage("Postavke obavijesti su spremljene.");
    });
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Po tvojoj mjeri</span>
            <h2>Profil i dnevni ciljevi</h2>
          </div>
        </div>
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Ime">
              <input
                required
                maxLength={80}
                value={draft.displayName}
                onChange={(e) =>
                  setDraft({ ...draft, displayName: e.target.value })
                }
              />
            </Field>
            <Field
              label="Vremenska zona"
              hint="Primjer: Europe/Lisbon ili Europe/Zagreb"
            >
              <input
                required
                value={draft.timezone}
                onChange={(e) =>
                  setDraft({ ...draft, timezone: e.target.value })
                }
              />
            </Field>
            <Field label="Dob (neobavezno)">
              <input
                type="number"
                min={18}
                max={100}
                value={draft.age ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    age: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </Field>
            <Field label="Visina u cm (neobavezno)">
              <input
                type="number"
                min={100}
                max={250}
                value={draft.heightCm ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    heightCm: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
              />
            </Field>
            <Field label="Spolni parametar formule">
              <select
                value={draft.sex ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sex: (e.target.value || undefined) as Profile["sex"],
                  })
                }
              >
                <option value="">Ne računaj procjenu</option>
                <option value="male">Muški</option>
                <option value="female">Ženski</option>
              </select>
            </Field>
            <Field label="Fitness cilj">
              <select
                value={draft.massGoal ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    massGoal: (e.target.value ||
                      undefined) as Profile["massGoal"],
                  })
                }
              >
                <option value="">Još nije odabran</option>
                <option value="maintain">Održavanje težine</option>
                <option value="lose">Smanjenje masnog tkiva</option>
                <option value="gain">Povećanje mase</option>
              </select>
            </Field>
            <Field label="Procijenjena razina aktivnosti">
              <select
                value={draft.activityLevel}
                onChange={(e) =>
                  setDraft({ ...draft, activityLevel: Number(e.target.value) })
                }
              >
                <option value={1.2}>Niska · 1,2</option>
                <option value={1.4}>Lagana · 1,4</option>
                <option value={1.6}>Umjerena · 1,6</option>
                <option value={1.8}>Visoka · 1,8</option>
                <option value={2}>Vrlo visoka · 2,0</option>
              </select>
            </Field>
            <Field label="Učenje (min/dan)">
              <input
                required
                type="number"
                min={0}
                max={720}
                value={draft.goals.learningMinutes}
                onChange={(e) =>
                  goal("learningMinutes", Number(e.target.value))
                }
              />
            </Field>
            <Field label="Društvene mreže (min/dan)">
              <input
                required
                type="number"
                min={0}
                max={720}
                value={draft.goals.socialMinutes}
                onChange={(e) => goal("socialMinutes", Number(e.target.value))}
              />
            </Field>
            <Field label="Koraci (dan)">
              <input
                required
                type="number"
                min={1}
                max={100000}
                value={draft.goals.steps}
                onChange={(e) => goal("steps", Number(e.target.value))}
              />
            </Field>
            <Field label="Najmanje sna (sati)">
              <input
                required
                type="number"
                min={1}
                max={16}
                step={0.5}
                value={draft.goals.sleepMinHours}
                onChange={(e) => goal("sleepMinHours", Number(e.target.value))}
              />
            </Field>
            <Field label="Najviše sna (sati)">
              <input
                required
                type="number"
                min={1}
                max={16}
                step={0.5}
                value={draft.goals.sleepMaxHours}
                onChange={(e) => goal("sleepMaxHours", Number(e.target.value))}
              />
            </Field>
            <Field label="Cilj odlaska na spavanje">
              <input
                required
                type="time"
                value={draft.goals.bedtime}
                onChange={(e) => goal("bedtime", e.target.value)}
              />
            </Field>
            <Field label="Cilj buđenja">
              <input
                required
                type="time"
                value={draft.goals.wakeTime}
                onChange={(e) => goal("wakeTime", e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Interesi za čitanje"
            hint="Odvoji zarezom. Izvori se zasad dohvaćaju na izvornom jeziku."
          >
            <input
              value={draft.readingInterests.join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  readingInterests: e.target.value
                    .split(",")
                    .map((v) => v.trim()),
                })
              }
            />
          </Field>
          <fieldset className="consent">
            <legend>Vanjski AI</legend>
            <p>
              {ai?.configured
                ? `Pružatelj: ${ai.provider ?? "konfigurirani servis"}.`
                : "AI servis nije konfiguriran. Lokalni savjeti po pravilima rade bez njega."}
            </p>
            <p>
              Uz dopuštenje šaljemo sažetke učenja, sna, aktivnosti i prehrane
              odabranom vanjskom pružatelju. Bez sirovih tragova aplikacija ili
              pristupnih ključeva. Prijedlozi nisu dijagnoza i sami ne mijenjaju
              ciljeve.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.aiConsent}
                onChange={(e) =>
                  setDraft({ ...draft, aiConsent: e.target.checked })
                }
              />
              Dopuštam slanje navedenih osobnih sažetaka vanjskom AI servisu.
            </label>
            <small>
              Opoziv zaustavlja buduće pozive; već poslane podatke ne može
              povući.
            </small>
          </fieldset>
          <button className="button" disabled={busy}>
            {busy ? "Spremanje…" : "Spremi postavke"}
          </button>
        </form>
      </section>
      <div className="stack">
        <section className="panel">
          <span className="eyebrow">Poveži izvore</span>
          <h2>Apple Health</h2>
          <p className="muted">
            Web aplikacija prima odabrane podatke preko tvojeg Shortcutsa.
            Čitanje Healtha može zahtijevati otključan iPhone.
          </p>
          <p className="connection">
            <span className={status?.active ? "dot" : "dot inactive"} />
            {status?.active ? "Ključ je aktivan" : "Ključ nije postavljen"}
          </p>
          <p className="footnote">
            Zadnji uvoz:{" "}
            {status?.lastHealthSync
              ? new Date(status.lastHealthSync).toLocaleString("hr-HR")
              : "još nema uvoza"}
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    status?.active &&
                    !confirm("Novi ključ poništava stari. Nastaviti?")
                  )
                    return;
                  const result = await api<{ token: string }>(
                    "/integrations/token",
                    "POST",
                    {},
                  );
                  setToken(result.token);
                  await load();
                })
              }
            >
              {status?.active ? "Zamijeni ključ" : "Generiraj ključ"}
            </button>
            {status?.active && (
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!confirm("Opozvati Health ključ?")) return;
                    await api("/integrations", "DELETE", {});
                    setToken("");
                    await load();
                  })
                }
              >
                Opozovi
              </button>
            )}
          </div>
          {token && (
            <div className="token">
              <strong>Prikazuje se samo sada</strong>
              <code>{token}</code>
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(token);
                    setMessage(
                      "Ključ je kopiran. Spremi ga samo u svoj Shortcut.",
                    );
                  })
                }
              >
                Kopiraj ključ
              </button>
            </div>
          )}
          <details>
            <summary>Kako složiti Shortcut</summary>
            <ol>
              <li>Find Health Samples: odaberi korake, datum i izvor.</li>
              <li>Pripremi dnevni ukupni iznos i stabilan externalId.</li>
              <li>Pošalji JSON putem Get Contents of URL → POST.</li>
              <li>
                URL:{" "}
                <code>
                  {typeof window !== "undefined" ? window.location.origin : ""}
                  /api/v1/health/import
                </code>
              </li>
              <li>Header: Authorization: Bearer TVOJ_KLJUČ.</li>
            </ol>
            <pre>
              {JSON.stringify(
                {
                  records: [
                    {
                      externalId: "iphone-steps-DATUM",
                      metric: "steps",
                      date: "YYYY-MM-DD",
                      value: 8340,
                    },
                  ],
                  timezone: draft.timezone,
                },
                null,
                2,
              )}
            </pre>
            <p className="footnote">
              Brojevi su primjer. Ponovni prijenos dnevnog zbroja zamjenjuje
              prethodni. Detaljan vodič nalazi se u projektu: docs/shortcuts.md.
            </p>
          </details>
        </section>
        <section className="panel">
          <h2>Večernje obavijesti</h2>
          <p className="muted">
            Pokušaj dostave 30 minuta prije zadanog spavanja, uz konfiguriran
            worker i VAPID ključeve. Isporuka ovisi o uređaju.
          </p>
          <button
            className="button secondary"
            disabled={busy || !push?.configured}
            onClick={notifications}
          >
            {push?.subscribed ? "Isključi obavijesti" : "Uključi obavijesti"}
          </button>
          {!push?.configured && (
            <p className="footnote">
              Web Push još nije konfiguriran na serveru.
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Tvoji podaci</h2>
          <p className="muted">
            Izvoz sadrži osobne zapise i postavke, bez lozinke i ključeva.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const data = await api("/export");
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `personal-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setMessage("Izvoz je preuzet.");
                })
              }
            >
              Preuzmi izvoz
            </button>
          </div>
          <Field label="Vrati osobni JSON izvoz">
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                run(async () => {
                  if (file.size > 5 * 1024 * 1024)
                    throw new Error("Datoteka je prevelika (najviše 5 MB).");
                  if (
                    !confirm(
                      "Povrat zamjenjuje sve postojeće zapise i sesije, isključuje AI i opoziva Health ključ. Nastaviti?",
                    )
                  )
                    return;
                  const data = JSON.parse(await file.text());
                  await api("/restore", "POST", data);
                  await purgeLocal();
                  await onSaved(true);
                  setDraft(
                    (await api<{ profile: Profile }>("/profile")).profile,
                  );
                  await load();
                  setToken("");
                  setMessage("Osobni podaci su vraćeni.");
                });
              }}
            />
          </Field>
          <hr />
          <p className="footnote">
            Brisanje uklanja praćene zapise, sesije učenja, AI rezultate,
            pretplate na obavijesti i Health ključ. Račun i profil/ciljevi
            ostaju; AI dopuštenje se isključuje.
          </p>
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (
                  prompt("Za brisanje upiši: DELETE MY DATA") !==
                  "DELETE MY DATA"
                )
                  return;
                await api("/data/delete", "POST", {
                  confirm: "DELETE MY DATA",
                });
                await purgeLocal();
                await onSaved(true);
                setDraft((await api<{ profile: Profile }>("/profile")).profile);
                await load();
                setToken("");
                setMessage("Praćeni podaci su obrisani.");
              })
            }
          >
            Obriši praćene podatke
          </button>
        </section>
        <aside className="note">
          <strong>Screen Time ostaje na iPhoneu.</strong>
          <p>
            Dnevni limit za odabrane mreže i večernji raspored postavi u
            ugrađenom Screen Timeu. Naš timer ne može uključiti tu blokadu.
          </p>
        </aside>
      </div>
      <div className="settings-feedback" aria-live="polite">
        {message && <p className="success">{message}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
