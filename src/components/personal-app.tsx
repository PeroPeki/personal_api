"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Footprints,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Settings,
  Timer,
  TrendingUp,
  WifiOff,
} from "lucide-react";
import type {
  Dashboard,
  FocusAction,
  FocusSession,
  LogKind,
  LogRecord,
  Profile,
} from "@/lib/types";
import { api, ApiError, formatNumber, minutes, uuid } from "@/lib/client";
import {
  discardQueue,
  boundedFocusIntervals,
  enqueue,
  flushQueue,
  loadLocalFocus,
  loadSnapshot,
  offlineOwner,
  purgeLocal,
  queued,
  rememberOwner,
  retryQueue,
  saveLocalFocus,
  saveSnapshot,
  type QueueItem,
} from "@/lib/offline";
import { Empty, MiniChart } from "./ui";
import { LogEditor, LOG_LABELS } from "./log-editor";
import { FocusPanel, duration } from "./focus-panel";
import { SettingsPanel } from "./settings-panel";
import { ReadingPanel, InsightsPanel } from "./reading-panel";
type User = { id: string; email: string; dataGeneration: number };
type Tab = "today" | "focus" | "fitness" | "sleep" | "reading" | "settings";
const NAV: { id: Tab; label: string; icon: typeof Timer }[] = [
  { id: "today", label: "Danas", icon: LayoutDashboard },
  { id: "focus", label: "Učenje", icon: Timer },
  { id: "fitness", label: "Fitness", icon: Footprints },
  { id: "sleep", label: "San", icon: Moon },
  { id: "reading", label: "Čitanje", icon: BookOpen },
  { id: "settings", label: "Postavke", icon: Settings },
];
const chartMetrics = {
  learningMinutes: { label: "Vrijeme učenja", unit: "min" },
  steps: { label: "Koraci", unit: "koraka" },
  weightKg: { label: "Težina", unit: "kg" },
  sleepHours: { label: "Trajanje sna", unit: "h" },
  socialMinutes: { label: "Društvene mreže", unit: "min" },
  activeCalories: { label: "Aktivna energija", unit: "kcal" },
};
function describeLog(log: LogRecord) {
  const d = log.data;
  switch (log.kind) {
    case "weight":
      return `${formatNumber(Number(d.kg), 1)} kg`;
    case "workout":
      return `${d.type} · ${d.durationMinutes} min`;
    case "sleep":
      return d.hours !== undefined
        ? `${formatNumber(Number(d.hours), 1)} h`
        : `${new Date(String(d.bedtime)).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })} → ${new Date(String(d.wakeTime)).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}`;
    case "nutrition":
      return `${d.calories === undefined ? "—" : formatNumber(Number(d.calories))} kcal · ${d.proteinGrams === undefined ? "—" : formatNumber(Number(d.proteinGrams))} g proteina`;
    case "social":
      return `${d.minutes} min`;
    case "steps":
      return `${formatNumber(Number(d.count))} koraka`;
    case "energy":
      return `${formatNumber(Number(d.activeCalories))} kcal`;
    case "measurement":
      return [
        d.waistCm ? `${d.waistCm} cm` : null,
        d.bodyFatPercent ? `${d.bodyFatPercent}% (uneseno)` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  }
}

export function PersonalApp() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [data, setData] = useState<Dashboard | null>(null),
    [tab, setTab] = useState<Tab>("today"),
    [days, setDays] = useState(7),
    [metric, setMetric] =
      useState<keyof typeof chartMetrics>("learningMinutes");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [offline, setOffline] = useState(false),
    [syncing, setSyncing] = useState(false),
    [queue, setQueue] = useState<QueueItem[]>([]),
    [localFocus, setLocalFocus] = useState<FocusSession | null>(null),
    [editor, setEditor] = useState<{ kind: LogKind; log?: LogRecord } | null>(
      null,
    ),
    [working, setWorking] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const clear = () => {
      epoch.current++;
      setUser(null);
      setData(null);
      setQueue([]);
      setLocalFocus(null);
      setEditor(null);
    };
    window.addEventListener("personal-privacy", clear);
    return () => window.removeEventListener("personal-privacy", clear);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api<{
          user: User;
          profile: Profile;
          dataGeneration: number;
        }>("/auth/me");
        if (cancelled) return;
        const owner = {
          ...response.user,
          dataGeneration: response.dataGeneration,
        };
        await rememberOwner(owner);
        setUser(owner);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status >= 500) {
          const cached = await offlineOwner();
          if (cached && !cancelled) {
            setUser({
              id: cached.id,
              email: cached.email,
              dataGeneration: cached.dataGeneration,
            });
            setData((await loadSnapshot(cached.id)) ?? null);
            setOffline(true);
          } else if (!cancelled)
            setError(
              "Server nije dostupan. Provjeri je li aplikacija pokrenuta.",
            );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    if ("serviceWorker" in navigator && window.isSecureContext)
      navigator.serviceWorker
        .register("/sw.js")
        .then(async () => {
          const registration = await navigator.serviceWorker.ready;
          const urls = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name);
          registration.active?.postMessage({ type: "CACHE_ASSETS", urls });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!user) return;
    const current = epoch.current;
    try {
      const snapshot = await api<Dashboard>(`/dashboard?days=${days}`);
      if (current !== epoch.current) return;
      setData(snapshot);
      setOffline(false);
      await rememberOwner(user);
      if (current !== epoch.current) return;
      await saveSnapshot(user.id, snapshot);
    } catch (e) {
      if (current !== epoch.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setData(null);
        setError(
          "Prijava je istekla. Prijavi se ponovno; neposlani zapisi čekaju isti račun.",
        );
      } else {
        setOffline(true);
        if (!data)
          setError("Pregled nije dostupan. Provjeri vezu i bazu podataka.");
      }
    }
  }, [user, days, data]);
  const sync = useCallback(async () => {
    if (!user) return;
    setSyncing(true);
    try {
      await flushQueue(user.id, async (item) => {
        await api(item.path, "POST", item.body, {
          "X-Data-Generation": String(item.dataGeneration ?? -1),
        });
      });
      setQueue(await queued(user.id));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sinkronizacija nije uspjela.");
    } finally {
      setSyncing(false);
    }
  }, [user, refresh]);
  // Stable event dependencies: polling reads the latest callback via a ref without resetting on every data response.
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (!user) return;
    loadLocalFocus(user.id, user.dataGeneration).then(setLocalFocus);
    queued(user.id).then(setQueue);
    syncRef.current();
    const reconnect = () => syncRef.current();
    const disconnect = () => setOffline(true);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnect);
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") syncRef.current();
    }, 30000);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", disconnect);
    };
  }, [user?.id, user?.dataGeneration, days]);
  async function login(email: string, password: string) {
    setError("");
    const response = await api<{ user: User; dataGeneration: number }>(
      "/auth/login",
      "POST",
      {
        email,
        password,
      },
    );
    const owner = { ...response.user, dataGeneration: response.dataGeneration };
    await rememberOwner(owner);
    setUser(owner);
    setData(null);
  }
  async function logout() {
    setError("");
    if (
      queue.length &&
      !confirm(
        "Postoje neposlani zapisi. Odjava ih briše s ovog uređaja. Nastaviti?",
      )
    )
      return;
    try {
      await api("/auth/logout", "POST", {});
    } catch {
      setError("Za sigurnu odjavu i opoziv sesije potrebna je veza.");
      return;
    }
    epoch.current++;
    await purgeLocal();
    navigator.serviceWorker?.controller?.postMessage("CLEAR_PRIVATE");
    setUser(null);
    setData(null);
    setQueue([]);
    setLocalFocus(null);
  }
  async function saveLog(log: LogRecord, editing: boolean) {
    if (!user) return;
    if (editing) {
      await api("/logs", "PATCH", log);
      await refresh();
      setNotice("Zapis je ažuriran.");
      return;
    }
    await enqueue({
      id: log.id,
      userId: user.id,
      dataGeneration: user.dataGeneration,
      path: "/logs",
      body: log,
      createdAt: new Date().toISOString(),
      status: "pending",
    });
    await sync();
    const remaining = await queued(user.id);
    setQueue(remaining);
    const failed = remaining.find(
      (item) => item.id === log.id && item.status === "failed",
    );
    if (failed) throw new Error(failed.error);
    setNotice(
      remaining.some((item) => item.id === log.id)
        ? "Zapis je spremljen na ovom uređaju i čeka slanje."
        : "Zapis je spremljen.",
    );
  }
  async function removeLog(log: LogRecord) {
    if (!confirm("Obrisati ovaj zapis?")) return;
    setWorking(true);
    try {
      await api("/logs", "DELETE", { id: log.id });
      await refresh();
      setNotice("Zapis je obrisan.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Brisanje nije uspjelo.");
    } finally {
      setWorking(false);
    }
  }
  async function focusAction(action: FocusAction) {
    await api("/focus", "POST", action);
    await refresh();
  }
  async function startLocal(category: string) {
    if (!user) return;
    if (data?.activeFocus)
      throw new Error(
        "Već postoji aktivna serverska sesija. Poveži se prije promjene.",
      );
    const now = new Date().toISOString();
    const session: FocusSession = {
      id: uuid(),
      category,
      status: "running",
      intervals: [{ start: now, end: null }],
      version: 0,
      createdAt: now,
      updatedAt: now,
      durationMinutes: 0,
      correctedMinutes: null,
    };
    await saveLocalFocus(user.id, session, user.dataGeneration);
    setLocalFocus(session);
  }
  async function localAction(action: "pause" | "resume" | "finish") {
    if (!user || !localFocus) return;
    const now = new Date().toISOString();
    const intervals = localFocus.intervals.map((i) => ({ ...i }));
    if (action === "resume") intervals.push({ start: now, end: null });
    else if (intervals.at(-1)?.end === null)
      intervals[intervals.length - 1].end = now;
    const next = {
      ...localFocus,
      intervals,
      status: (action === "finish"
        ? "finished"
        : action === "pause"
          ? "paused"
          : "running") as FocusSession["status"],
      version: localFocus.version + 1,
      updatedAt: now,
    };
    if (action === "finish") {
      await enqueue({
        id: next.id,
        userId: user.id,
        dataGeneration: user.dataGeneration,
        path: "/focus/import",
        body: {
          id: next.id,
          category: next.category,
          intervals: boundedFocusIntervals(next.intervals),
          createdAt: next.createdAt,
        },
        status: "pending",
        createdAt: now,
      });
      await saveLocalFocus(user.id, null, user.dataGeneration);
      setLocalFocus(null);
      await sync();
      setNotice("Lokalna sesija je završena. Provjeri stanje sinkronizacije.");
    } else {
      await saveLocalFocus(user.id, next, user.dataGeneration);
      setLocalFocus(next);
    }
  }
  async function afterPrivacyChange(purged = false) {
    if (purged) {
      epoch.current++;
      setLocalFocus(null);
      setQueue([]);
      setData(null);
      const response = await api<{ user: User; dataGeneration: number }>(
        "/auth/me",
      );
      const owner = {
        ...response.user,
        dataGeneration: response.dataGeneration,
      };
      await rememberOwner(owner);
      setUser(owner);
      return;
    }
    await refresh();
  }
  if (!ready)
    return (
      <main className="loading">
        <div className="brand-mark">p.</div>
        <p>Otvaram tvoj prostor…</p>
      </main>
    );
  if (!user) return <Login onLogin={login} initialError={error} />;
  const greeting = new Intl.DateTimeFormat("hr-HR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: data?.profile.timezone ?? "Europe/Lisbon",
  }).format(new Date());
  const current = data?.today,
    profile = data?.profile,
    active = localFocus ?? data?.activeFocus;
  const records = (data?.recentLogs ?? []).filter((log) =>
    tab === "fitness"
      ? [
          "weight",
          "workout",
          "nutrition",
          "steps",
          "energy",
          "measurement",
        ].includes(log.kind)
      : tab === "sleep"
        ? log.kind === "sleep"
        : true,
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Preskoči na sadržaj
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">p.</span>
          <span>
            personal<span className="brand-sub">Malo po malo. Svaki dan.</span>
          </span>
        </a>
        <span className="nav-caption">MOJ PROSTOR</span>
        <nav aria-label="Glavna navigacija">
          {NAV.map((item) => (
            <button
              key={item.id}
              aria-current={tab === item.id ? "page" : undefined}
              className={tab === item.id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(item.id);
                setError("");
              }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {tab === item.id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <span className="dot" />
            Privatno. Samo tvoje.
          </div>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            <span>Odjava</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            personal<span>p.</span>
          </div>
          <span className="date-label">{greeting}</span>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Odjava"
              title="Odjava"
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
            <button
              className="sync-button"
              disabled={syncing}
              onClick={() => sync()}
            >
              {offline ? <WifiOff size={15} /> : <Check size={15} />}
              <span>
                {syncing
                  ? "Sinkronizacija…"
                  : offline
                    ? "Bez veze"
                    : queue.length
                      ? `${queue.length} na čekanju`
                      : "Povezano"}
              </span>
            </button>
            <span
              className="avatar"
              aria-label={profile?.displayName ?? "Korisnik"}
            >
              {profile?.displayName?.slice(0, 1) ?? "P"}
            </span>
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tab === "today"
                  ? "Tvoj dnevni pregled"
                  : "Tvoj osobni dnevnik"}
              </span>
              <h1>
                {tab === "today"
                  ? `Dobro došao, ${profile?.displayName ?? "Petar"}.`
                  : NAV.find((item) => item.id === tab)?.label}
              </h1>
              <p>
                {tab === "today"
                  ? "Vrijeme za sebe, na jednom mjestu. Prati ono što ti je važno."
                  : tab === "fitness"
                    ? "Kretanje, treninzi i napredak kroz vrijeme."
                    : tab === "sleep"
                      ? "Mirnije večeri počinju malim navikama."
                      : tab === "focus"
                        ? "Napravi prostora za ono što želiš naučiti."
                        : tab === "settings"
                          ? "Tvoji ciljevi, izvori i privatnost."
                          : "Završi dan nečim zanimljivim."}
              </p>
            </div>
            {!["settings", "reading"].includes(tab) && (
              <button
                className="button"
                onClick={() =>
                  setEditor({
                    kind:
                      tab === "sleep"
                        ? "sleep"
                        : tab === "fitness"
                          ? "workout"
                          : "weight",
                  })
                }
              >
                <Plus size={17} />
                Dodaj zapis
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Zatvori poruku" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
              <button aria-label="Zatvori poruku" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {offline && (
            <aside className="offline-note">
              <WifiOff size={18} />
              <span>
                Prikaz posljednjih dostupnih podataka. Novi unosi čekaju slanje;
                uređivanje i brisanje zahtijevaju vezu. Za offline rad zadrži
                ovu aplikaciju otvorenom.
              </span>
            </aside>
          )}
          {queue.length > 0 && (
            <details className="queue">
              <summary>
                {queue.length}{" "}
                {queue.length === 1 ? "zapis čeka" : "zapisa čekaju"}{" "}
                sinkronizaciju
              </summary>
              {queue.map((item) => (
                <div className="queue-row" key={item.id}>
                  <span>
                    {item.path === "/logs"
                      ? LOG_LABELS[(item.body as LogRecord).kind]
                      : "Sesija učenja"}{" "}
                    · {item.status === "failed" ? item.error : "Čeka vezu"}
                  </span>
                  {item.status === "failed" && (
                    <button
                      onClick={async () => {
                        await retryQueue(item.id, user.id);
                        await sync();
                      }}
                      className="text-button"
                    >
                      Pokušaj ponovno
                    </button>
                  )}
                  <button
                    className="text-button danger"
                    onClick={async () => {
                      if (confirm("Odbaciti ovaj neposlani zapis?")) {
                        await discardQueue(item.id);
                        setQueue(await queued(user.id));
                      }
                    }}
                  >
                    Odbaci
                  </button>
                </div>
              ))}
            </details>
          )}
          {!data ? (
            <section className="panel">
              <Empty title="Pripremamo tvoj pregled">
                {offline
                  ? "Za prvi pregled potrebna je veza sa serverom."
                  : "Dohvaćanje podataka…"}
              </Empty>
              <button className="button secondary" onClick={() => refresh()}>
                Pokušaj ponovno
              </button>
            </section>
          ) : (
            <>
              {tab === "today" && (
                <>
                  <section
                    className="stats-grid"
                    aria-label="Današnji pokazatelji"
                  >
                    <Stat
                      title="Učenje"
                      value={minutes(current!.learningMinutes)}
                      detail={`od ${minutes(profile!.goals.learningMinutes)} danas`}
                      icon={<Timer size={19} />}
                      progress={
                        current!.learningMinutes /
                        profile!.goals.learningMinutes
                      }
                      action={() => setTab("focus")}
                    />
                    <Stat
                      title="Koraci"
                      value={formatNumber(current!.steps)}
                      detail={`cilj ${formatNumber(profile!.goals.steps)} koraka`}
                      icon={<Footprints size={19} />}
                      progress={
                        current!.steps === null
                          ? undefined
                          : current!.steps / profile!.goals.steps
                      }
                      action={() => {
                        setTab("fitness");
                        setMetric("steps");
                      }}
                    />
                    <Stat
                      title="San"
                      value={
                        current!.sleepHours === null
                          ? "—"
                          : `${formatNumber(current!.sleepHours, 1)} h`
                      }
                      detail={`cilj ${profile!.goals.sleepMinHours}–${profile!.goals.sleepMaxHours} sati`}
                      icon={<Moon size={19} />}
                      action={() => setTab("sleep")}
                    />
                    <Stat
                      title="Društvene mreže"
                      value={
                        current!.socialMinutes === null
                          ? "—"
                          : `${formatNumber(current!.socialMinutes)} min`
                      }
                      detail={`cilj ispod ${profile!.goals.socialMinutes} min · ručni unos`}
                      icon={<TrendingUp size={19} />}
                      action={() => setEditor({ kind: "social" })}
                    />
                  </section>
                  <div className="overview-grid">
                    <section className="panel focus-prompt">
                      <div>
                        <span className="eyebrow">
                          {active ? "Tvoja sesija" : "Sljedeći mali korak"}
                        </span>
                        <h2>
                          {active ? active.category : "Što ćeš danas naučiti?"}
                        </h2>
                        <p>
                          {active
                            ? "Sesija je spremljena. Otvori timer za pauzu ili završetak."
                            : "Odvoji vrijeme za čitanje, programiranje ili svoj projekt."}
                        </p>
                        <button
                          className="button"
                          onClick={() => setTab("focus")}
                        >
                          {active ? "Otvori timer" : "Počni učiti"}
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <div className="focus-art" aria-hidden="true">
                        <span>{data.profile.goals.learningMinutes}</span>
                        <small>MINUTA ZA SEBE</small>
                      </div>
                    </section>
                    <aside className="panel daily-note">
                      <span className="eyebrow">Večernji ritual</span>
                      <Moon size={27} />
                      <h3>
                        Manje scrollanja.
                        <br />
                        Više dobrih priča.
                      </h3>
                      <p>Jedan odabrani tekst, pa vrijeme za odmor.</p>
                      <button
                        className="text-button"
                        onClick={() => setTab("reading")}
                      >
                        Pronađi priču <ArrowUpRight size={15} />
                      </button>
                    </aside>
                  </div>
                </>
              )}
              {tab === "focus" && (
                <FocusPanel
                  goalMinutes={data.profile.goals.learningMinutes}
                  active={data.activeFocus}
                  local={localFocus}
                  onAction={focusAction}
                  onLocalStart={startLocal}
                  onLocalAction={localAction}
                  refresh={refresh}
                />
              )}
              {["today", "fitness", "sleep"].includes(tab) && (
                <>
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">Mala slika napretka</span>
                        <h2>
                          {tab === "sleep"
                            ? "Tvoj ritam sna"
                            : "Pogled kroz vrijeme"}
                        </h2>
                      </div>
                      <div className="segmented" aria-label="Razdoblje grafa">
                        {[7, 30, 90].map((value) => (
                          <button
                            key={value}
                            aria-pressed={days === value}
                            onClick={() => setDays(value)}
                          >
                            {value} dana
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="chart-heading">
                      <select
                        aria-label="Pokazatelj grafa"
                        value={tab === "sleep" ? "sleepHours" : metric}
                        onChange={(e) =>
                          setMetric(e.target.value as keyof typeof chartMetrics)
                        }
                        disabled={tab === "sleep"}
                      >
                        {Object.entries(chartMetrics).map(([key, item]) => (
                          <option key={key} value={key}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="footnote">
                        {data.lastHealthSync
                          ? `Health: ${new Date(data.lastHealthSync).toLocaleString("hr-HR")}`
                          : "Health još nije sinkroniziran"}
                      </span>
                    </div>
                    <MiniChart
                      values={data.history.map(
                        (day) => day[tab === "sleep" ? "sleepHours" : metric],
                      )}
                      labels={data.history.map((day) => day.date)}
                      label={
                        chartMetrics[tab === "sleep" ? "sleepHours" : metric]
                          .label
                      }
                      unit={
                        chartMetrics[tab === "sleep" ? "sleepHours" : metric]
                          .unit
                      }
                    />
                  </section>
                  {tab === "fitness" && (
                    <>
                      <section className="stats-grid three">
                        <Stat
                          title="Težina danas"
                          value={
                            current!.weightKg === null
                              ? "—"
                              : `${formatNumber(current!.weightKg, 1)} kg`
                          }
                          detail="Pojedinačno mjerenje"
                          icon={<TrendingUp size={19} />}
                          action={() => setEditor({ kind: "weight" })}
                        />
                        <Stat
                          title="Trening danas"
                          value={
                            current!.workoutMinutes === null
                              ? "—"
                              : `${current!.workoutMinutes} min`
                          }
                          detail={
                            current!.workoutCount
                              ? `${current!.workoutCount} trening(a)`
                              : "Još nema zapisa"
                          }
                          icon={<Footprints size={19} />}
                          action={() => setEditor({ kind: "workout" })}
                        />
                        <Stat
                          title="Prehrana danas"
                          value={
                            current!.nutrition?.calories == null
                              ? "—"
                              : `${formatNumber(current!.nutrition.calories)} kcal`
                          }
                          detail={`${formatNumber(current!.nutrition?.proteinGrams)} g proteina · zabilježeno`}
                          icon={<BookOpen size={19} />}
                          action={() => setEditor({ kind: "nutrition" })}
                        />
                      </section>
                      <section className="panel">
                        <div className="section-heading">
                          <h2>Okvirne potrebe</h2>
                          <button
                            className="text-button"
                            onClick={() => setTab("settings")}
                          >
                            Uredi profil ↗
                          </button>
                        </div>
                        <div className="estimate-grid">
                          <div>
                            <span>Održavanje težine</span>
                            <strong>
                              {data.estimates.calories
                                ? `${formatNumber(data.estimates.calories.maintenance)} kcal`
                                : "Potreban je profil"}
                            </strong>
                            <small>
                              Mifflin–St Jeor + odabrana aktivnost. Nema
                              automatskog deficita ili suficita.
                            </small>
                          </div>
                          <div>
                            <span>Proteini · opći raspon</span>
                            <strong>
                              {data.estimates.proteinGrams
                                ? `${data.estimates.proteinGrams.min}–${data.estimates.proteinGrams.max} g`
                                : "Potrebna je težina"}
                            </strong>
                            <small>
                              1,4–2,0 g/kg za osobe koje vježbaju; osobne
                              potrebe mogu se razlikovati.
                            </small>
                          </div>
                          <div>
                            <span>Body fat · RFM procjena</span>
                            <strong>
                              {data.estimates.bodyFat
                                ? `${data.estimates.bodyFat.percent}%`
                                : "Potrebne su mjere"}
                            </strong>
                            <small>
                              Visina, opseg struka i parametar formule. Nije
                              izmjeren postotak.
                            </small>
                          </div>
                        </div>
                        <p className="footnote">
                          Aktivna energija danas:{" "}
                          {formatNumber(current!.activeCalories)} kcal
                          (procjena). Nije dodatak dopuštenom unosu hrane. Za
                          izmjenu prehrane pregledaj trendove i potvrdi cilj.
                        </p>
                      </section>
                    </>
                  )}
                  {tab === "sleep" && (
                    <aside className="note">
                      <strong>
                        Tvoj raspored: {profile!.goals.bedtime} →{" "}
                        {profile!.goals.wakeTime}
                      </strong>
                      <p>
                        Ručno uneseni san je samoprocjena. Zabilježi budnost i
                        jutarnji osjećaj odmorenosti; Fitbit se može povezati
                        kasnije.
                      </p>
                    </aside>
                  )}
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">Tvoja povijest</span>
                        <h2>Nedavni zapisi</h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          setEditor({
                            kind: tab === "sleep" ? "sleep" : "weight",
                          })
                        }
                      >
                        Dodaj novi <Plus size={15} />
                      </button>
                    </div>
                    {records.length ? (
                      <ul className="record-list">
                        {records.map((log) => (
                          <li key={log.id}>
                            <div
                              className={`record-dot ${log.kind}`}
                              aria-hidden="true"
                            />
                            <div className="record-description">
                              <strong>{LOG_LABELS[log.kind]}</strong>
                              <small>
                                {log.date} ·{" "}
                                {log.source === "manual"
                                  ? "Ručni unos"
                                  : "Apple Health"}
                              </small>
                            </div>
                            <span className="record-value">
                              {describeLog(log)}
                            </span>
                            {log.source === "manual" && (
                              <div className="record-actions">
                                <button
                                  className="text-button"
                                  disabled={working}
                                  onClick={() =>
                                    setEditor({ kind: log.kind, log })
                                  }
                                >
                                  Uredi
                                </button>
                                <button
                                  className="text-button danger"
                                  disabled={working}
                                  onClick={() => removeLog(log)}
                                >
                                  Obriši
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty title="Ovdje počinje tvoja povijest" />
                    )}
                  </section>
                  {tab === "today" && <InsightsPanel />}
                </>
              )}
              {tab === "reading" && <ReadingPanel />}
              {tab === "settings" && (
                <SettingsPanel
                  profile={data.profile}
                  onSaved={afterPrivacyChange}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Personal · Tvoj prostor, tvoj ritam.</span>
            <span>Bez pritiska. Uz malo više uvida.</span>
          </footer>
        </main>
      </div>
      {editor && profile && (
        <LogEditor
          timezone={profile.timezone}
          initialKind={editor.kind}
          existing={editor.log}
          onSave={saveLog}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  detail,
  icon,
  progress,
  action,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  progress?: number;
  action: () => void;
}) {
  return (
    <button className="stat" onClick={action}>
      <div className="stat-heading">
        <span>{title}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
      {progress !== undefined && (
        <div className="progress-track">
          <span
            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
          />
        </div>
      )}
    </button>
  );
}
function Login({
  onLogin,
  initialError,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  initialError: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prijava nije uspjela.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand-mark">p.</div>
        <span className="eyebrow">Tvoj privatni dnevnik</span>
        <h1>
          Više prostora
          <br />
          za ono važno.
        </h1>
        <p>
          Učenje, kretanje i mirnije večeri.
          <br />
          Malo po malo, na jednom mjestu.
        </p>
        <span className="login-signature">personal / svaki dan pomalo</span>
      </section>
      <section className="login-form">
        <span className="eyebrow">Dobro došao natrag</span>
        <h2>Otvori svoj prostor.</h2>
        <p className="muted">Prijavi se svojim privatnim računom.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Lozinka</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy ? "Prijava…" : "Prijavi se"}
            <ArrowUpRight size={17} />
          </button>
        </form>
        <p className="footnote">
          Nema javne registracije. Račun se priprema na tvom serveru. Upute su u
          README datoteci projekta.
        </p>
      </section>
    </main>
  );
}
