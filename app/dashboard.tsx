"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  type Category,
  type ContactsRecord,
  type FounderContact,
  type Launch,
  type OutreachConfig,
  type OutreachStatus,
} from "@/lib/types";
import { bandFor, DEFAULT_RUBRIC, scoreBreakdown, scoreWith, type Rubric } from "@/lib/rubric";
import { linkedinSearchUrl } from "@/lib/linkedin";
import { roleOf } from "@/lib/roles";
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
  "Project management": "Project management",
  "HR tech": "HR tech",
  "Developer productivity": "Developer productivity",
  "Team communication": "Team communication",
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
const foundersOf = (l: Launch) =>
  l.makerProfiles?.length ? l.makerProfiles : l.makers.map((name) => ({ name, headline: undefined, username: undefined }));
const founderLine = (l: Launch) => {
  const f = foundersOf(l);
  return f.length
    ? `by ${f.map((m) => (roleOf(m.headline) === "Maker" ? m.name : `${m.name} (${roleOf(m.headline)})`)).join(", ")}`
    : "Founder: see Product Hunt page";
};

async function copyText(text: string, container?: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (permissions, iframe, http): fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    (container ?? document.body).appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

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
  const [rubric, setRubric] = useState<Rubric>(DEFAULT_RUBRIC);
  const [rubricOpen, setRubricOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/launches", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLaunches(data.launches);
      setNotes(data.notes);
      setStatuses(data.statuses ?? {});
      setLastScan(data.lastScan);
      if (data.rubric) setRubric(data.rubric);
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
      else if (data.skipped)
        setMessage(
          data.reason === "running"
            ? "A scan is already running. Its results will show here in about a minute."
            : "A scan ran less than 3 minutes ago, so these results are current."
        );
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
  const visible = viewPool
    .filter(
      (l) =>
        (cat === "All" || l.category === cat) &&
        (!q || `${l.name} ${l.oneLiner} ${l.tagline} ${l.makers.join(" ")}`.toLowerCase().includes(q))
    )
    .map((l) => ({ l, score: scoreWith(l, rubric) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.l);
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
            <button className="btn light" onClick={() => setRubricOpen(true)}>
              ⚖ Scoring rubric
            </button>
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
            ranked by {formulaText(rubric)}
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
          onContacted={() =>
            setStatuses((s) => ((s[opened.id] ?? "new") === "new" ? { ...s, [opened.id]: "contacted" } : s))
          }
          onClose={() => setOpenId(null)}
          rubric={rubric}
        />
      )}

      {rubricOpen && (
        <RubricDialog
          rubric={rubric}
          sample={visible[0] ?? null}
          onSaved={(r, rescoring) => {
            setRubric(r);
            setMessage(
              rescoring
                ? "Rubric saved. The list is re-ranked, and Gemini will re-score every launch's fit over the next scans (about 80 per scan)."
                : "Rubric saved. The list is re-ranked with the new weights."
            );
          }}
          onClose={() => setRubricOpen(false)}
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
  onContacted,
  onClose,
  rubric,
}: {
  launch: Launch;
  status: OutreachStatus;
  onStatus: (s: OutreachStatus) => void;
  note: string;
  onNoteSaved: (n: string) => void;
  onContacted: () => void;
  onClose: () => void;
  rubric: Rubric;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(note);
  const [saveState, setSaveState] = useState("");
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const r = replies(l);
  const founders = foundersOf(l);
  const summary = l.summary || l.description || l.tagline;
  const breakdown = scoreBreakdown(l, rubric);
  const band = l.analyzedAt ? bandFor(l.relevance, rubric) : undefined;

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
    const ok = await copyText(l.outreachAngle, ref.current);
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
                  <span className="role" title={f.headline}>
                    {roleOf(f.headline)}
                  </span>
                  {f.username ? (
                    <a href={`https://www.producthunt.com/@${f.username}`} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  ) : (
                    <b>{f.name}</b>
                  )}
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
        <p className="status-hint">
          Track your outreach: mark <b>Contacted</b> when you message a founder, <b>Replied</b> when they answer,
          and <b>Partner</b> when you agree to work together. The launch then appears under that view in the sidebar.
        </p>

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
            <b>{breakdown.total}</b>
            <span>score</span>
          </div>
        </div>
        <p className="score-why">
          <b>How it&apos;s scored:</b>{" "}
          {breakdown.parts.map((p, i) => (
            <span key={p.label}>
              {i > 0 && " + "}
              {p.count} {p.label} × {p.weight}
            </span>
          ))}{" "}
          = <b>{breakdown.total}</b>
          {band && (
            <>
              <br />
              <b>Fit {l.relevance}/10:</b> {band.description}
            </>
          )}
        </p>

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

        <ReachOut launch={l} dialog={ref} onSent={onContacted} />

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

type Composer = { name: string; mode: "email" | "linkedin" };

function ReachOut({
  launch: l,
  dialog,
  onSent,
}: {
  launch: Launch;
  dialog: React.RefObject<HTMLDialogElement | null>;
  onSent: () => void;
}) {
  const [config, setConfig] = useState<OutreachConfig | null>(null);
  const [contacts, setContacts] = useState<ContactsRecord | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [composer, setComposer] = useState<Composer | null>(null);

  useEffect(() => {
    fetch(`/api/outreach?id=${encodeURIComponent(l.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setConfig(d.config);
        setContacts(d.contacts);
      })
      .catch((e) => setError(`Couldn't load contacts: ${(e as Error).message}`));
  }, [l.id]);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(`${action}:${extra.name ?? ""}`);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: l.id, ...extra }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setContacts(d.contacts);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function openComposer(f: FounderContact, mode: Composer["mode"]) {
    setComposer({ name: f.name, mode });
    if (!f.draft) await call("draft", { name: f.name });
  }

  async function send(f: FounderContact, subject: string, body: string) {
    const d = await call("send", { name: f.name, subject, body, again: !!f.sentAt });
    if (d) {
      setInfo(`Email sent to ${d.sentTo}.`);
      setComposer(null);
      onSent();
    }
  }

  return (
    <section className="reach">
      <h3>Reach out</h3>
      {config?.testTo && (
        <p className="test-banner">
          Test mode: every email goes to <b>{config.testTo}</b>, not to the founder.
        </p>
      )}

      {!contacts ? (
        <div className="reach-empty">
          {l.makers.length ? (
            <>
              <button className="btn" onClick={() => call("find")} disabled={!!busy || !config}>
                {busy.startsWith("find") ? "Searching the web…" : "Find LinkedIn & email"}
              </button>
              <span className="muted-text small">
                {config && !config.search
                  ? "Web search needs OPENROUTER_API_KEY. LinkedIn search links and drafts work now."
                  : "Gemini searches the web for each founder's LinkedIn profile and any public email."}
              </span>
            </>
          ) : (
            <span className="muted-text">Product Hunt hides this launch&apos;s makers, so there&apos;s no one to look up.</span>
          )}
        </div>
      ) : (
        <ul className="contacts">
          {contacts.founders.map((f) => (
            <FounderCard
              key={f.name}
              founder={f}
              launchName={l.name}
              config={config}
              busy={busy}
              composer={composer?.name === f.name ? composer.mode : null}
              onOpen={(mode) => openComposer(f, mode)}
              onClose={() => setComposer(null)}
              onRedraft={() => call("draft", { name: f.name })}
              onSend={(subject, body) => send(f, subject, body)}
              copy={(text) => copyText(text, dialog.current)}
            />
          ))}
        </ul>
      )}

      {contacts && config?.search && (
        <button className="link-btn" onClick={() => call("find")} disabled={!!busy}>
          {busy.startsWith("find") ? "Looking up again…" : "Look up again"}
        </button>
      )}
      {error && (
        <p className="reach-error" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="reach-info" role="status">
          {info}
        </p>
      )}
    </section>
  );
}

function FounderCard({
  founder: f,
  launchName,
  config,
  busy,
  composer,
  onOpen,
  onClose,
  onRedraft,
  onSend,
  copy,
}: {
  founder: FounderContact;
  launchName: string;
  config: OutreachConfig | null;
  busy: string;
  composer: Composer["mode"] | null;
  onOpen: (mode: Composer["mode"]) => void;
  onClose: () => void;
  onRedraft: () => void;
  onSend: (subject: string, body: string) => void;
  copy: (text: string) => Promise<boolean>;
}) {
  const [subject, setSubject] = useState(f.draft?.subject ?? "");
  const [body, setBody] = useState(f.draft?.body ?? "");
  const [note, setNote] = useState(f.draft?.linkedinNote ?? "");
  const [copied, setCopied] = useState(false);
  const drafting = busy === `draft:${f.name}`;
  const sending = busy === `send:${f.name}`;

  // Fill the editors when a (re)generated draft arrives.
  useEffect(() => {
    setSubject(f.draft?.subject ?? "");
    setBody(f.draft?.body ?? "");
    setNote(f.draft?.linkedinNote ?? "");
  }, [f.draft?.subject, f.draft?.body, f.draft?.linkedinNote]);

  const emailLabel = f.emailKind === "company" ? "company email" : null;
  // In test mode every email goes to the test inbox, so a draft can be sent even without a founder email.
  const canEmail = !!config?.resend && (!!f.email || !!config?.testTo);
  // Unconfirmed founders get a LinkedIn people search for their name only (older lookups stored a
  // search that also included the product name, which usually came back empty).
  const linkedinHref = f.linkedinIsSearch || !f.linkedin ? linkedinSearchUrl(f.name, launchName) : f.linkedin;

  async function copyAndOpen() {
    const ok = await copy(note);
    setCopied(ok);
    window.open(linkedinHref, "_blank", "noopener,noreferrer");
  }

  return (
    <li className="contact">
      <div className="contact-head">
        <span className="role">{f.role}</span>
        <b>{f.name}</b>
        {f.sentAt && (
          <span className="sent-chip">
            ✓ emailed {new Date(f.sentAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        )}
      </div>

      <div className="contact-lines">
        <span>
          <span className="ico" aria-hidden="true">✉</span>
          {f.email ? (
            <>
              <a href={`mailto:${f.email}`}>{f.email}</a>
              {emailLabel && <span className="muted-text"> · {emailLabel}</span>}
            </>
          ) : (
            <span className="muted-text">{f.note ?? "No email ID found"}</span>
          )}
        </span>
        <span>
          <span className="ico li" aria-hidden="true">in</span>
          <a href={linkedinHref} target="_blank" rel="noreferrer">
            {f.linkedinIsSearch || !f.linkedin ? "No confirmed profile · search LinkedIn ↗" : "LinkedIn profile ↗"}
          </a>
        </span>
      </div>

      <div className="contact-actions">
        <button
          className="mini-btn"
          onClick={() => onOpen("email")}
          disabled={!canEmail || !!busy}
          title={!config?.resend ? "Add RESEND_API_KEY to send email" : !canEmail ? "No email for this founder" : undefined}
        >
          ✉ {f.sentAt ? "Email again" : "Write email"}
        </button>
        <button className="mini-btn" onClick={() => onOpen("linkedin")} disabled={!!busy}>
          in · LinkedIn request
        </button>
        {!config?.resend && <span className="muted-text small">Sending email needs RESEND_API_KEY.</span>}
      </div>

      {composer && (
        <div className="composer">
          {drafting && !f.draft ? (
            <p className="muted-text">Gemini is writing a draft for {f.name.split(" ")[0]}…</p>
          ) : composer === "email" ? (
            <>
              <label>
                To
                <input
                  value={config?.testTo ? `${config.testTo} (test, instead of ${f.email ?? "the founder"})` : f.email ?? ""}
                  readOnly
                />
              </label>
              <label>
                Subject
                <input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>
              <label>
                Message
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} />
              </label>
              <div className="composer-actions">
                <button
                  className="btn"
                  onClick={() => onSend(subject, body)}
                  disabled={sending || drafting || !subject.trim() || !body.trim()}
                >
                  {sending ? "Sending…" : config?.testTo ? "Send test email" : "Send email"}
                </button>
                <button className="mini-btn" onClick={onRedraft} disabled={!!busy}>
                  {drafting ? "Rewriting…" : "↻ Rewrite"}
                </button>
                <button className="mini-btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                Connection note
                <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} rows={4} />
              </label>
              <span className={`counter${note.length >= 190 ? " warn" : ""}`}>{note.length}/200</span>
              <div className="composer-actions">
                <button className="btn" onClick={copyAndOpen} disabled={!note.trim() || drafting}>
                  {copied ? "Copied · LinkedIn opened" : "Copy note & open LinkedIn"}
                </button>
                <button className="mini-btn" onClick={onRedraft} disabled={!!busy}>
                  {drafting ? "Rewriting…" : "↻ Rewrite"}
                </button>
                <button className="mini-btn" onClick={onClose}>
                  Close
                </button>
              </div>
              <p className="muted-text small">
                On LinkedIn, click Connect → Add a note → paste. LinkedIn has no API for sending requests, so this last
                click is yours.
              </p>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function formulaText(r: Rubric) {
  const terms = [
    r.weights.upvotes ? `${r.weights.upvotes === 1 ? "" : `${r.weights.upvotes} × `}upvotes` : "",
    r.weights.makerReplies ? `${r.weights.makerReplies} × maker replies` : "",
    r.weights.fit ? `${r.weights.fit} × Gemini fit` : "",
  ].filter(Boolean);
  return terms.join(" + ") || "nothing (all weights are 0)";
}

function RubricDialog({
  rubric,
  sample,
  onSaved,
  onClose,
}: {
  rubric: Rubric;
  sample: Launch | null;
  onSaved: (r: Rubric, rescoring: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Rubric>(rubric);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const setWeight = (k: keyof Rubric["weights"], v: string) =>
    setDraft((d) => ({ ...d, weights: { ...d.weights, [k]: v === "" ? 0 : Number(v) } }));
  const setBand = (i: number, v: string) =>
    setDraft((d) => ({ ...d, fitBands: d.fitBands.map((b, j) => (j === i ? { ...b, description: v } : b)) }));
  const bandsChanged = draft.fitBands.some((b, i) => b.description.trim() !== rubric.fitBands[i]?.description);
  const example = sample ? scoreBreakdown(sample, draft) : null;

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/rubric", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setSaving(false);
    if (!res?.ok) return setError(data?.error ?? "Couldn't save the rubric. Check your connection and try again.");
    onSaved(data.rubric, !!data.rescoring);
    ref.current?.close();
  }

  const weightField = (k: keyof Rubric["weights"], label: string, hint: string) => (
    <label className="weight">
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <span className="times">×</span>
      <input type="number" min={0} max={k === "fit" ? 1000 : 100} step={0.5} value={draft.weights[k]} onChange={(e) => setWeight(k, e.target.value)} />
    </label>
  );

  return (
    <dialog
      ref={ref}
      className="dialog sk"
      aria-labelledby="rubric-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="dialog-body rubric">
        <button className="close" onClick={() => ref.current?.close()} aria-label="Close">
          ✕
        </button>
        <div>
          <h2 id="rubric-title">Scoring rubric</h2>
          <p className="muted-text">
            How launches are ranked and how Gemini rates partnership fit. Changes apply to everyone using this dashboard.
          </p>
        </div>

        <section>
          <h3>Ranking score</h3>
          <p className="muted-text small">
            The assignment asks to score by upvotes and maker comments (how responsive the team is). The weights are
            ours to choose.
          </p>
          <div className="weights">
            {weightField("upvotes", "Upvotes", "per upvote")}
            {weightField("makerReplies", "Maker replies", "per comment written by the makers")}
            {weightField("comments", "All comments", "used only when Product Hunt hides every maker")}
            {weightField("fit", "Gemini fit (0–10)", "optional: add partnership fit to the ranking")}
          </div>
          {example && sample && (
            <p className="score-why">
              <b>Example, {sample.name}:</b>{" "}
              {example.parts.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && " + "}
                  {p.count} × {p.weight}
                </span>
              ))}{" "}
              = <b>{example.total}</b>
            </p>
          )}
        </section>

        <section>
          <h3>Gemini fit rubric (0–10)</h3>
          <p className="muted-text small">
            Gemini uses these descriptions to rate each launch. Editing them makes Gemini re-score every launch over the
            next scans (about 80 per scan).
          </p>
          <div className="bands">
            {draft.fitBands.map((b, i) => (
              <label key={b.min} className="band">
                <span className="band-range">
                  {b.min}–{b.max}
                </span>
                <textarea rows={2} value={b.description} maxLength={400} onChange={(e) => setBand(i, e.target.value)} />
              </label>
            ))}
          </div>
          {bandsChanged && <p className="test-banner">Saving will re-score every launch&apos;s fit with Gemini.</p>}
        </section>

        <section>
          <h3>Telegram alerts</h3>
          <label className="weight">
            <span>
              <b>Minimum fit to alert</b>
              <small>launches below this stay on the dashboard but skip the Telegram digest</small>
            </span>
            <span className="times">≥</span>
            <input
              type="number"
              min={0}
              max={10}
              step={1}
              value={draft.minAlertFit}
              onChange={(e) => setDraft((d) => ({ ...d, minAlertFit: Number(e.target.value) }))}
            />
          </label>
        </section>

        {error && (
          <p className="reach-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save rubric"}
          </button>
          <button className="mini-btn" onClick={() => setDraft({ ...DEFAULT_RUBRIC, version: rubric.version })} disabled={saving}>
            Reset to defaults
          </button>
          <button className="mini-btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          {rubric.updatedAt && (
            <span className="muted-text small">
              Last changed {new Date(rubric.updatedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
    </dialog>
  );
}
