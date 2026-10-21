"use client";
import { useId } from "react";
import { formatNumber } from "@/lib/client";
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">↗</span>
      <h3>{title}</h3>
      <p>
        {children ||
          "Prvi zapis je dovoljan za početak. Dodaj ga kada budeš spreman."}
      </p>
    </div>
  );
}
export function MiniChart({
  values,
  labels,
  label,
  unit,
}: {
  values: (number | null)[];
  labels: string[];
  label: string;
  unit: string;
}) {
  const id = useId(),
    numbers = values.filter((v): v is number => v !== null),
    width = 640,
    height = 160;
  if (!numbers.length)
    return (
      <Empty title="Još nema podataka za graf">
        Odaberi drugo razdoblje ili dodaj prvi zapis.
      </Empty>
    );
  const min = Math.min(...numbers),
    max = Math.max(...numbers),
    range = max - min || 1;
  const xy = (v: number, i: number) => [
    12 + (i / Math.max(values.length - 1, 1)) * (width - 24),
    height - 16 - ((v - min) / range) * (height - 36),
  ];
  const segments: string[] = [];
  let segment = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (segment) segments.push(segment);
      segment = "";
    } else {
      const [x, y] = xy(v, i);
      segment += `${segment ? " L" : "M"}${x},${y}`;
    }
  });
  if (segment) segments.push(segment);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}>
        <title id={id}>
          {label}: {formatNumber(min, 1)} do {formatNumber(max, 1)} {unit}
        </title>
        {[30, 85, 140].map((y) => (
          <line key={y} x1="0" x2={width} y1={y} y2={y} className="gridline" />
        ))}
        {segments.map((d, i) => (
          <path key={i} d={d} className="chart-line" />
        ))}
        {values.map((v, i) =>
          v === null ? null : (
            <circle
              key={i}
              cx={xy(v, i)[0]}
              cy={xy(v, i)[1]}
              r="3"
              className="chart-dot"
            >
              <title>
                {labels[i]}: {formatNumber(v, 1)} {unit}
              </title>
            </circle>
          ),
        )}
      </svg>
      <figcaption>
        <span>{labels[0]}</span>
        <span>{labels.at(-1)}</span>
      </figcaption>
      <details>
        <summary>Prikaži brojčane vrijednosti</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>
                  {label} ({unit})
                </th>
              </tr>
            </thead>
            <tbody>
              {values.map((v, i) => (
                <tr key={labels[i]}>
                  <td>{labels[i]}</td>
                  <td>{formatNumber(v, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
