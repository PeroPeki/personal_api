"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LogKind, LogRecord } from "@/lib/types";
import { localDay, uuid } from "@/lib/client";
import { Field } from "./ui";
export const LOG_LABELS: Record<LogKind, string> = {
  weight: "Težina",
  workout: "Trening",
  sleep: "San",
  nutrition: "Prehrana",
  social: "Društvene mreže",
  steps: "Koraci",
  energy: "Aktivna energija",
  measurement: "Tjelesne mjere",
};
const INPUTS: Record<
  LogKind,
  {
    key: string;
    label: string;
    type?: string;
    min?: number;
    max?: number;
    required?: boolean;
  }[]
> = {
  weight: [
    { key: "kg", label: "Težina (kg)", min: 20, max: 400, required: true },
  ],
  workout: [
    { key: "type", label: "Vrsta treninga", type: "text", required: true },
    {
      key: "durationMinutes",
      label: "Trajanje (minute)",
      min: 1,
      max: 1440,
      required: true,
    },
    { key: "note", label: "Bilješka (neobavezno)", type: "text" },
  ],
  sleep: [
    {
      key: "bedtime",
      label: "Odlazak u krevet",
      type: "datetime-local",
      required: true,
    },
    {
      key: "wakeTime",
      label: "Buđenje",
      type: "datetime-local",
      required: true,
    },
    {
      key: "quality",
      label: "Odmo­renost od 1 do 5",
      min: 1,
      max: 5,
      required: true,
    },
    {
      key: "awakeMinutes",
      label: "Budnost tijekom noći (minute)",
      min: 0,
      max: 1440,
    },
  ],
  nutrition: [
    { key: "calories", label: "Unesene kalorije (kcal)", min: 0, max: 15000 },
    { key: "proteinGrams", label: "Proteini (g)", min: 0, max: 1000 },
    { key: "carbsGrams", label: "Ugljikohidrati (g)", min: 0, max: 2000 },
    { key: "fatGrams", label: "Masti (g)", min: 0, max: 1000 },
  ],
  social: [
    {
      key: "minutes",
      label: "Provedeno vrijeme (minute)",
      min: 0,
      max: 1440,
      required: true,
    },
    { key: "note", label: "Aplikacije / bilješka", type: "text" },
  ],
  steps: [
    {
      key: "count",
      label: "Ukupan broj koraka za dan",
      min: 0,
      max: 200000,
      required: true,
    },
  ],
  energy: [
    {
      key: "activeCalories",
      label: "Aktivna energija (kcal)",
      min: 0,
      max: 15000,
      required: true,
    },
  ],
  measurement: [
    { key: "waistCm", label: "Opseg struka (cm)", min: 30, max: 250 },
    { key: "bodyFatPercent", label: "Uneseni body fat (%)", min: 2, max: 70 },
  ],
};
function datetimeInput(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return new Date(+date - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function LogEditor({
  timezone,
  initialKind = "weight",
  existing,
  onSave,
  onClose,
}: {
  timezone: string;
  initialKind?: LogKind;
  existing?: LogRecord;
  onSave: (log: LogRecord, editing: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current
      ?.querySelector<HTMLElement>("button,input,select,textarea")
      ?.focus();
    return () => previous?.focus();
  }, []);
  const [kind, setKind] = useState<LogKind>(existing?.kind ?? initialKind),
    [date, setDate] = useState(
      existing?.date ?? localDay(new Date(), timezone),
    );
  const [id] = useState(existing?.id ?? uuid()),
    [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        Object.entries(existing?.data ?? {}).map(([k, v]) => [
          k,
          ["bedtime", "wakeTime"].includes(k) ? datetimeInput(v) : String(v),
        ]),
      ),
    );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data: Record<string, string | number> = {};
      for (const field of INPUTS[kind]) {
        const value = values[field.key];
        if (value == null || value === "") continue;
        data[field.key] =
          field.type === "datetime-local"
            ? new Date(value).toISOString()
            : field.type === "text"
              ? value
              : Number(value);
      }
      if (!Object.keys(data).length)
        throw new Error("Unesi barem jednu vrijednost.");
      const logDate =
        kind === "sleep" && data.wakeTime
          ? localDay(new Date(String(data.wakeTime)), timezone)
          : date;
      const occurredAt =
        existing?.occurredAt ??
        (logDate === localDay(new Date(), timezone)
          ? new Date().toISOString()
          : new Date(logDate + "T12:00:00Z").toISOString());
      await onSave(
        { id, kind, date: logDate, occurredAt, source: "manual", data },
        !!existing,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unos nije spremljen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key !== "Tab") return;
          const items = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
            ) ?? []),
          ];
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">Kratki dnevni unos</span>
            <h2 id="log-title">{existing ? "Uredi zapis" : "Dodaj zapis"}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Zatvori obrazac"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Što bilježiš?">
              <select
                value={kind}
                disabled={!!existing}
                onChange={(e) => {
                  setKind(e.target.value as LogKind);
                  setValues({});
                }}
              >
                {Object.entries(LOG_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Datum"
              hint={kind === "sleep" ? "San pripada danu buđenja." : undefined}
            >
              <input
                type="date"
                required
                value={date}
                disabled={kind === "sleep"}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            {INPUTS[kind].map((field) => (
              <Field key={field.key} label={field.label}>
                <input
                  autoFocus={field === INPUTS[kind][0]}
                  name={field.key}
                  type={field.type ?? "number"}
                  min={field.min}
                  max={field.max}
                  step={["count", "quality"].includes(field.key) ? 1 : "any"}
                  required={field.required}
                  maxLength={field.type === "text" ? 500 : undefined}
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues({ ...values, [field.key]: e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          {kind === "sleep" && (
            <p className="muted">
              Vremena unosiš u lokalnom vremenu ovog uređaja. Trajanje je
              samoprocjena, a ne mjerenje faza sna.
            </p>
          )}
          {kind === "social" && (
            <p className="muted">
              Unesi novi dio vremena ili uredi postojeći zapis. Više zapisa
              istog dana zbraja se.
            </p>
          )}
          {kind === "energy" && (
            <p className="muted">
              Procjena kretanja nije dodatak dopuštenom unosu hrane.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
              disabled={busy}
            >
              Odustani
            </button>
            <button className="button" disabled={busy}>
              {busy ? "Spremanje…" : "Spremi zapis"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
