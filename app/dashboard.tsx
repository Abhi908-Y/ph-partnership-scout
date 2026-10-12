"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, type Category, type Launch, type OutreachStatus } from "@/lib/types";
import { scanNow } from "./actions";

const DAY = 86_400_000;
const WINDOW = 7;

const CAT_COLOR: Record<Category, string> = {
  "Project management": "var(--pm)",
  "HR tech": "var(--hr)",
  "Developer productivity": "var(--dev)",
  "Team communication": "var(--team)",
};
const CAT_SHORT: Record<Category, string> = {
  "Project management": "Project mgmt",
  "HR tech": "HR tech",
  "Developer productivity": "Dev productivity",
  "Team communication": "Team comms",
};

const STATUS_LABEL: Record<OutreachStatus, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  partner: "Partner",
};

type View = "week" | "closing" | "contacted" | "replied" | "partner" | "hidden";
const VIEWS: { id: View; icon: string; label: string; title: [string, string] }[] = [
  { id: "week", icon: "📌", label: "This week", title: ["This week's", "launch scout"] },
  { id: "closing", icon: "⏳", label: "Closing soon", title: ["Closing", "in 2 days or less"] },
  { id: "contacted", icon: "✉️", label: "Contacted", title: ["Founders you've", "contacted"] },
  { id: "replied", icon: "💬", label: "Replied", title: ["Founders who", "replied"] },
  { id: "partner", icon: "🤝", label: "Partners", title: ["Your new", "partners"] },
  { id: "hidden", icon: "🙈", label: "Not relevant", title: ["Filtered out", "by Gemini"] },
];

const isCategory = (c: string): c is Category => (CATEGORIES as readonly string[]).includes(c);
const dayOf = (iso: string) => Math.min(WINDOW, Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / DAY) + 1));
const daysLeft = (iso: string) => WINDOW - dayOf(iso);
const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
const fitTone = (fit: number) => (fit >= 7 ? "high" : fit >= 5 ? "mid" : "low");
const replies = (l: Launch) =>
  l.scoreBasis === "maker"
    ? { n: l.makerComments ?? 0, label: "maker replies" }
    : { n: l.commentsCount, label: "comments" };
const founderLine = (l: Launch) => (l.makers.length ? `by ${l.makers.join(", ")}` : "Founder: see Product Hunt page");

export default function Dashboard() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, OutreachStatus>>({});
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [view, setView] = useState<View>("week");
  const [cat, setCat] = useState<Category | "All">("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/launches", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLaunches(data.launches);
      setNotes(data.notes);
      setStatuses(data.statuses ?? {});
      setLastScan(data.lastScan);
    } catch (err) {
      setMessage(`Couldn't load launches: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function scan() {
    setScanning(true);
    setMessage("Checking Product Hunt and asking Gemini to sort new launches…");
    try {
      const data = await scanNow();
      if ("error" in data) setMessage(`Scan failed: ${data.error}`);
      else if (data.skipped) setMessage("A scan ran less than 3 minutes ago, so these results are current.");
      else
        setMessage(
          `Scan finished: ${data.found} launches checked, ${data.newCount} new, ${data.analyzed} sorted by Gemini` +
            (data.alerted ? `, ${data.alerted} sent to Telegram.` : ".") +
            (data.errors.length ? ` ${data.errors.length} errors (first: ${data.errors[0].slice(0, 160)})` : "")
        );
      await load();
    } catch {
      setMessage("Scan failed: the server didn't respond. Try again in a minute.");
    } finally {
      setScanning(false);
    }
  }

  async function changeStatus(id: string, next: OutreachStatus) {
    const prev = statuses[id] ?? "new";
    setStatuses((s) => ({ ...s, [id]: next }));
    const res = await fetch("/api/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setStatuses((s) => ({ ...s, [id]: prev }));
      setMessage("Couldn't save the status. Check your connection and try again.");
    }
  }

  const statusOf = useCallback((id: string) => statuses[id] ?? "new", [statuses]);
  const relevant = useMemo(() => launches.filter((l) => l.category !== "Not relevant"), [launches]);

  const inView = useCallback(
    (l: Launch, v: View) => {
      switch (v) {
        case "week":
          return l.category !== "Not relevant";
        case "closing":
          return l.category !== "Not relevant" && daysLeft(l.launchedAt) <= 2;
        case "hidden":
          return l.category === "Not relevant";
        default:
          return statusOf(l.id) === v;
      }
    },
    [statusOf]
  );

  const viewPool = useMemo(() => launches.filter((l) => inView(l, view)), [launches, view, inView]);
  const q = query.trim().toLowerCase();
  const visible = viewPool.filter(
    (l) =>
      (cat === "All" || l.category === cat) &&
      (!q || `${l.name} ${l.oneLiner} ${l.tagline} ${l.makers.join(" ")}`.toLowerCase().includes(q))
  );
  const opened = launches.find((l) => l.id === openId) ?? null;
  const catCount = (c: Category | "All") => (c === "All" ? viewPool.length : viewPool.filter((l) => l.category === c).length);
  const viewMeta = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark sk" aria-hidden="true">🔭</span>
          <b>Partnership Scout</b>
        </div>

        <nav className="nav" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="nav-item"
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
                setCat("All");
              }}
            >
              <span aria-hidden="true">{v.icon}</span>
              {v.label}
              <span className="n">{launches.filter((l) => inView(l, v.id)).length}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <header className="head">
          <div className="head-text">
            <h1>
              {viewMeta.title[0]} <mark>{viewMeta.title[1]}</mark>
            </h1>
            <p>
              {loading
                ? "Loading launches…"
                : `${relevant.length} Product Hunt launches still inside their 7-day window · ${
                    lastScan ? `last scan ${timeAgo(lastScan)}` : "no scans yet"
                  }`}
            </p>
          </div>
          <Rocket />
          <div className="actions">
            <label className="search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Search launches"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search launches"
              />
            </label>
            <button className="btn" onClick={scan} disabled={scanning}>
              {scanning ? "Scanning…" : "↻ Scan now"}
            </button>
          </div>
        </header>

        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}

        <div className="tabs" role="tablist" aria-label="Category filter">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button key={c} role="tab" className="tab" aria-selected={cat === c} onClick={() => setCat(c)}>
              {c !== "All" && <span className="dot" style={{ background: CAT_COLOR[c] }} />}
              {c === "All" ? "All" : CAT_SHORT[c]}
              <span className="n">{catCount(c)}</span>
            </button>
          ))}
          <span className="hint">
            ranked by upvotes + 5 × maker replies
            <svg width="30" height="18" viewBox="0 0 34 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M2 4c10 0 20 4 26 12" />
              <path d="M22 15l6 2 1-6" />
            </svg>
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="empty sk">
            <p>
              {loading
                ? "Loading launches…"
                : launches.length === 0
                  ? "Nothing here yet. Run a scan to pull the last seven days of launches from Product Hunt."
                  : q
                    ? `No launches match “${query}”.`
                    : view === "week" || view === "closing" || view === "hidden"
                      ? "No launches here right now. Try another category or scan again later."
                      : `No launches marked “${viewMeta.label}” yet. Open a launch and set its status.`}
            </p>
            {!loading && launches.length === 0 && (
              <button className="btn" onClick={scan} disabled={scanning}>
                ↻ Scan Product Hunt now
              </button>
            )}
          </div>
        ) : (
          <ol className="list sk">
            {visible.map((l, i) => (
              <Row
                key={l.id}
                launch={l}
                rank={i + 1}
                status={statusOf(l.id)}
                hasNote={!!notes[l.id]}
                onOpen={() => setOpenId(l.id)}
              />
            ))}
          </ol>
        )}
      </main>

      {opened && (
        <LaunchDialog
          key={opened.id}
          launch={opened}
          status={statusOf(opened.id)}
          onStatus={(s) => changeStatus(opened.id, s)}
          note={notes[opened.id] ?? ""}
          onNoteSaved={(n) => setNotes((prev) => ({ ...prev, [opened.id]: n }))}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function Rocket() {
  return (
    <svg className="rocket" width="150" height="70" viewBox="0 0 150 70" fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 60c18-4 30-14 44-16s28 6 44-6" strokeDasharray="4 6" />
      <g transform="translate(100 6) rotate(35 18 18)">
        <path d="M18 2c8 6 11 16 9 26H9C7 18 10 8 18 2z" fill="#fff" />
        <circle cx="18" cy="15" r="3.6" fill="var(--dev)" />
        <path d="M9 22 3 30l7-1M27 22l6 8-7-1" fill="var(--hr)" />
        <path d="M13 29l5 8 5-8" fill="var(--team)" />
      </g>
      <path d="M70 12l3 6M64 18l-5 2M76 6l1-5" strokeWidth="1.5" />
    </svg>
  );
}

function WindowBar({ launchedAt, compact }: { launchedAt: string; compact?: boolean }) {
  const day = dayOf(launchedAt);
  const left = WINDOW - day;
  const tone = left === 0 ? "hot" : left <= 2 ? "warn" : "ok";
  const label = left === 0 ? "last day!" : `${left} day${left === 1 ? "" : "s"} left`;
  return (
    <div className="window" data-tone={tone} aria-label={`Day ${day} of ${WINDOW}, ${label}`}>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: WINDOW }, (_, k) => (
          <span key={k} className={`seg${k < day ? " used" : ""}`} />
        ))}
      </div>
      <div className="window-label">
        {!compact && <span>Day {day} of 7</span>}
        <span className="left">{label}</span>
      </div>
    </div>
  );
}

function CategoryChip({ launch: l }: { launch: Launch }) {
  if (isCategory(l.category))
    return (
      <span className="chip">
        <span className="dot" style={{ background: CAT_COLOR[l.category] }} />
        {CAT_SHORT[l.category]}
      </span>
    );
  return <span className="chip muted">{l.category === "Pending" ? "analysis pending" : "not relevant"}</span>;
}

function FitBadge({ launch: l }: { launch: Launch }) {
  return (
    <span className="fit" data-tone={l.analyzedAt ? fitTone(l.relevance) : "low"}>
      {l.analyzedAt ? `fit ${l.relevance}/10` : "fit –"}
    </span>
  );
}

function Row({
  launch: l,
  rank,
  status,
  hasNote,
  onOpen,
}: {
  launch: Launch;
  rank: number;
  status: OutreachStatus;
  hasNote: boolean;
  onOpen: () => void;
}) {
  const r = replies(l);
  return (
    <li>
      <button className="row" aria-haspopup="dialog" onClick={onOpen}>
        <span className="rank">{rank}</span>
        {l.thumbnail ? <img className="thumb" src={l.thumbnail} alt="" /> : <span className="thumb" />}
        <span className="who">
          <span className="name">
            {l.name}
            <CategoryChip launch={l} />
            {status !== "new" && <span className={`status-chip s-${status}`}>{STATUS_LABEL[status]}</span>}
            {hasNote && <span className="note-dot" title="Has notes">✎</span>}
          </span>
          <span className="one">{l.category === "Pending" ? l.tagline : l.oneLiner}</span>
          <span className="founder">{founderLine(l)}</span>
        </span>
        <FitBadge launch={l} />
        <span className="stat">
          <b>{l.votes}</b>
          <span>upvotes</span>
        </span>
        <span className="stat replies">
          <b>{r.n}</b>
          <span>{r.label}</span>
        </span>
        <WindowBar launchedAt={l.launchedAt} compact />
      </button>
    </li>
  );
}

function LaunchDialog({
  launch: l,
  status,
  onStatus,
  note,
  onNoteSaved,
  onClose,
}: {
  launch: Launch;
  status: OutreachStatus;
  onStatus: (s: OutreachStatus) => void;
  note: string;
  onNoteSaved: (n: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(note);
  const [saveState, setSaveState] = useState("");
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const r = replies(l);
  const founders = l.makerProfiles?.length ? l.makerProfiles : l.makers.map((name) => ({ name, headline: undefined, username: undefined }));
  const summary = l.summary || l.description || l.tagline;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => clearTimeout(timer.current);
  }, []);

  function editNote(value: string) {
    setDraft(value);
    setSaveState("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: l.id, note: value }),
      }).catch(() => null);
      setSaveState(res?.ok ? "Saved" : "Couldn't save. Your text is still here; keep typing to retry.");
      if (res?.ok) onNoteSaved(value);
    }, 700);
  }

  async function copyAngle() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(l.outreachAngle);
      ok = true;
    } catch {
      // Clipboard API blocked (permissions, iframe, http): fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = l.outreachAngle;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ref.current?.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    setCopied(ok ? "Copied" : "Couldn't copy. Select the text instead.");
    setTimeout(() => setCopied(""), 1800);
  }

  return (
    <dialog
      ref={ref}
      className="dialog sk"
      aria-labelledby={`dialog-title-${l.id}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close(); // backdrop click
      }}
    >
      <div className="dialog-body">
        <button className="close" onClick={() => ref.current?.close()} aria-label="Close">
          ✕
        </button>

        <div className="d-top">
          {l.thumbnail ? <img src={l.thumbnail} alt="" /> : <span className="thumb" />}
          <div>
            <h2 id={`dialog-title-${l.id}`}>{l.name}</h2>
            <div className="d-chips">
              <CategoryChip launch={l} />
              <FitBadge launch={l} />
            </div>
          </div>
        </div>

        <section className="founders">
          <h3>{founders.length === 1 ? "Founder" : "Founders"}</h3>
          {founders.length ? (
            <ul>
              {founders.map((f) => (
                <li key={f.name}>
                  {f.username ? (
                    <a href={`https://www.producthunt.com/@${f.username}`} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  ) : (
                    <b>{f.name}</b>
                  )}
                  {f.headline && <span>{f.headline}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">Product Hunt hides the makers of this launch. See the Product Hunt page.</p>
          )}
          {founders.length > 0 && !!l.makersHidden && (
            <p className="muted-text small">
              +{l.makersHidden} more maker{l.makersHidden === 1 ? "" : "s"} hidden by Product Hunt.
            </p>
          )}
        </section>

        <div className="status-buttons" role="group" aria-label="Outreach status">
          {(Object.keys(STATUS_LABEL) as OutreachStatus[]).map((s) => (
            <button key={s} className={`s-${s}`} aria-pressed={status === s} onClick={() => onStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="d-stats">
          <div>
            <b>{l.votes}</b>
            <span>upvotes</span>
          </div>
          <div>
            <b>{r.n}</b>
            <span>{r.label}</span>
          </div>
          <div>
            <b>{l.score}</b>
            <span>score</span>
          </div>
        </div>

        <WindowBar launchedAt={l.launchedAt} />

        <section>
          <h3>Summary</h3>
          <p className="summary">{summary}</p>
        </section>

        <div className="angle">
          <svg className="sparkle" width="30" height="26" viewBox="0 0 30 26" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M10 3v10M5 8h10M23 13v8M19 17h8" />
          </svg>
          <h3>✦ Outreach angle</h3>
          {l.outreachAngle ? (
            <>
              <p>{l.outreachAngle}</p>
              <button className="btn" onClick={copyAngle}>
                {copied || "Copy angle"}
              </button>
            </>
          ) : (
            <p className="muted-text">Gemini hasn&apos;t analyzed this launch yet. It will be picked up on the next scan.</p>
          )}
        </div>

        <div className="notes">
          <label htmlFor={`note-${l.id}`}>Your notes</label>
          <textarea
            id={`note-${l.id}`}
            value={draft}
            onChange={(e) => editNote(e.target.value)}
            placeholder="Who to contact, where, and what you said…"
          />
          <div className="saved" aria-live="polite">
            {saveState}
          </div>
        </div>

        <div className="links">
          <a href={l.url} target="_blank" rel="noreferrer">
            Product Hunt page ↗
          </a>
          <a href={l.website} target="_blank" rel="noreferrer">
            Website ↗
          </a>
          <span>Launched {new Date(l.launchedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        </div>
      </div>
    </dialog>
  );
}
