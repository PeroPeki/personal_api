"use client";
import { useEffect, useState } from "react";
import type { ReadingResponse, Article, InsightsResponse } from "@/lib/types";
import { api } from "@/lib/client";
import { Empty } from "./ui";
export function ReadingPanel() {
  const [data, setData] = useState<ReadingResponse | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  async function load() {
    try {
      setData(await api<ReadingResponse>("/reading"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Članci nisu dostupni.");
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function toggle(article: Article) {
    setBusy(article.id);
    try {
      await api("/reading", "POST", {
        articleId: article.id,
        read: !article.read,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promjena nije spremljena.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <section className="reading-intro">
        <span className="eyebrow">Umjesto još jednog scrolla</span>
        <h2>
          Jedna dobra priča
          <br />
          za kraj dana.
        </h2>
        <p>
          Odabrani izvori, miran ritam i jasan završetak. Članci vode na izvorni
          tekst.
        </p>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data ? (
        <p className="muted">Dohvaćanje tekstova…</p>
      ) : !data.articles.length ? (
        <section className="panel">
          <Empty title="Prve priče još dolaze">
            Pokreni pozadinski worker da dohvati članke iz NASA-e i JSTOR
            Dailyja. Ako izvor nije dostupan, pokušat ćemo ponovno.
          </Empty>
        </section>
      ) : (
        <div className="reading-grid">
          {data.articles.map((article) => (
            <article
              key={article.id}
              className={`panel article ${article.selected ? "selected" : ""}`}
            >
              <div className="article-meta">
                <span>{article.source}</span>
                {article.selected && <span className="tag">Za večeras</span>}
              </div>
              <h3>{article.title}</h3>
              <p>{article.summary || "Otvori izvorni tekst i otkrij priču."}</p>
              <footer>
                <span className="footnote">
                  Oko {article.minutes} min · okvirno
                </span>
                <div className="button-row">
                  <a
                    className="text-button"
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Čitaj na izvoru ↗
                  </a>
                  <button
                    className="text-button"
                    disabled={busy === article.id}
                    onClick={() => toggle(article)}
                  >
                    {article.read ? "✓ Pročitano" : "Označi pročitano"}
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function InsightsPanel() {
  const [data, setData] = useState<InsightsResponse | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await api<InsightsResponse>("/insights"));
  }
  useEffect(() => {
    load().catch(() => setError("Savjeti trenutačno nisu dostupni."));
  }, []);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      await api("/insights/generate", "POST", {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sažetak nije dostupan.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Primijeti obrazac</span>
          <h2>Tvoj pregled</h2>
        </div>
        <button
          className="button secondary"
          disabled={busy || !data?.configured}
          onClick={generate}
        >
          {busy ? "Pripremam…" : "Zatraži AI sažetak"}
        </button>
      </div>
      <p className="muted">
        Lokalni pokazatelji temelje se na tvojim zapisima. Vanjski AI zahtijeva
        konfiguraciju i dopuštenje u postavkama.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="insights-list">
        {data?.rules.map((item) => (
          <article key={item.id}>
            <span className="eyebrow">Lokalno pravilo</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
        {data?.ai && (
          <article>
            <span className="eyebrow">AI sažetak · {data.provider}</span>
            <h3>{data.ai.title}</h3>
            <p className="preserve-lines">{data.ai.text}</p>
          </article>
        )}
      </div>
      {!data?.configured && (
        <p className="footnote">
          AI je isključen dok se na serveru ne odaberu pružatelj, model i
          pristupni ključ.
        </p>
      )}
    </section>
  );
}
