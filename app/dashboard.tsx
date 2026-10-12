"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Launch } from "@/lib/types";
import { scanNow } from "./actions";

const TABS = ["All", "Project management", "HR tech", "Developer productivity", "Team communication"] as const;
type Tab = (typeof TABS)[number];
const DAY = 86_400_000;
const WINDOW = 7;

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));
const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

export default function Dashboard() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("All");
  const [showFiltered, setShowFiltered] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/launches", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLaunches(data.launches);
      setNotes(data.notes);
      setLastScan(data.lastScan);
    } catch (err) {
      setStatus(`Couldn't load launches: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function scan() {
    setScanning(true);
    setStatus("Checking Product Hunt and asking Gemini to sort new launches…");
    try {
      const data = await scanNow();
      if ("error" in data) setStatus(`Scan failed: ${data.error}`);
      else if (data.skipped) setStatus("A scan ran less than 3 minutes ago, so these results are current.");
      else
        setStatus(
          `Scan finished: ${data.found} launches checked, ${data.newCount} new, ${data.analyzed} sorted by Gemini` +
            (data.alerted ? `, ${data.alerted} sent to Telegram.` : ".") +
            (data.errors.length ? ` ${data.errors.length} errors (first: ${data.errors[0].slice(0, 160)})` : "")
        );
      await load();
    } catch {
      setStatus("Scan failed: the server didn't respond. Try again in a minute.");
    } finally {
      setScanning(false);
    }
  }

  const relevant = useMemo(() => launches.filter((l) => l.category !== "Not relevant"), [launches]);
  const filteredOut = launches.length - relevant.length;
  const pool = showFiltered ? launches : relevant;
  const visible = tab === "All" ? pool : pool.filter((l) => l.category === tab);
  const count = (t: Tab) => (t === "All" ? pool.length : pool.filter((l) => l.category === t).length);
  const closingSoon = relevant.filter((l) => WINDOW - daysSince(l.launchedAt) <= 2).length;

  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1 className="headline">
            {loading ? "Loading launches" : `${relevant.length} launches still inside their first week`}
          </h1>
          <p className="sub">
            Ranked by upvotes plus maker replies, filtered to project management, HR tech, developer
            productivity and team communication.{" "}
            {closingSoon > 0 && <strong>{closingSoon} close within 2 days.</strong>}
          </p>
        </div>
        <div className="scan">
          <button className="btn" onClick={scan} disabled={scanning}>
            {scanning ? "Scanning…" : "Scan Product Hunt now"}
          </button>
          <span className="meta">{lastScan ? `Last scan ${timeAgo(lastScan)}` : "No scans yet"}</span>
        </div>
      </header>

      {status && <p className="status" role="status">{status}</p>}

      <nav className="tabs" aria-label="Categories">
        {TABS.map((t) => (
          <button key={t} className="tab" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}<span className="n">{count(t)}</span>
          </button>
        ))}
      </nav>

      {visible.length === 0 ? (
        <div className="list empty">
          <p>
            {launches.length === 0
              ? "Nothing here yet. Run a scan to pull the last seven days of launches from Product Hunt."
              : "No launches in this category right now. Check another tab or scan again later."}
          </p>
          {launches.length === 0 && (
            <button className="btn" onClick={scan} disabled={scanning}>Scan Product Hunt now</button>
          )}
        </div>
      ) : (
        <ol className="list">
          {visible.map((l, i) => (
            <Row
              key={l.id}
              launch={l}
              rank={i + 1}
              expanded={open === l.id}
              onToggle={() => setOpen(open === l.id ? null : l.id)}
              note={notes[l.id] ?? ""}
              onNoteSaved={(n) => setNotes((prev) => ({ ...prev, [l.id]: n }))}
            />
          ))}
        </ol>
      )}

      {filteredOut > 0 && (
        <p className="toggle">
          <button className="btn btn-quiet" onClick={() => setShowFiltered(!showFiltered)}>
            {showFiltered ? "Hide" : "Show"} {filteredOut} launches Gemini marked not relevant
          </button>
        </p>
      )}
    </main>
  );
}

function Window({ launchedAt }: { launchedAt: string }) {
  const used = Math.min(WINDOW, daysSince(launchedAt) + 1);
  const left = WINDOW - used;
  const tone = left >= 3 ? "open" : left >= 1 ? "closing" : "last";
  const label = left === 0 ? "Last day to reach out" : `Day ${used} of ${WINDOW}, ${left} left`;
  return (
    <div className="window" data-tone={tone} aria-label={label}>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: WINDOW }, (_, i) => (
          <span key={i} className={`seg${i < used ? " used" : ""}`} />
        ))}
      </div>
      <span className="window-label">{label}</span>
    </div>
  );
}

function Row({
  launch: l, rank, expanded, onToggle, note, onNoteSaved,
}: {
  launch: Launch; rank: number; expanded: boolean; onToggle: () => void;
  note: string; onNoteSaved: (n: string) => void;
}) {
  const [draft, setDraft] = useState(note);
  const [saveState, setSaveState] = useState("");
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setDraft(note), [note]);

  function editNote(value: string) {
    setDraft(value);
    setSaveState("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: l.id, note: value }),
      });
      setSaveState(res.ok ? "Saved" : "Couldn't save. Your text is still here; keep typing to retry.");
      if (res.ok) onNoteSaved(value);
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
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    setCopied(ok ? "Copied" : "Couldn't copy. Select the text instead.");
    setTimeout(() => setCopied(""), 1800);
  }

  const founder = l.makers.length ? l.makers.join(", ") : null;
  const replies = l.scoreBasis === "maker" ? l.makerComments ?? 0 : l.commentsCount;

  return (
    <li className="row">
      <button className="row-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="rank">{rank}</span>
        <span className="product">
          {l.thumbnail ? <img className="thumb" src={l.thumbnail} alt="" /> : <span className="thumb" />}
          <span>
            <p className="name">
              {l.name}
              {l.category !== "Pending" && <span className="cat">{l.category}</span>}
              {l.analyzedAt && <span className="cat fit" title="Partnership fit, rated by Gemini">Fit {l.relevance}/10</span>}
            </p>
            <p className="one">{l.category === "Pending" ? `${l.tagline} (analysis pending)` : l.oneLiner}</p>
            <p className="founder">{founder ? `Founder: ${founder}` : "Founder: see Product Hunt page"}</p>
          </span>
        </span>
        <span className="stat"><b>{l.votes}</b><span>upvotes</span></span>
        <span className="stat comments">
          <b>{replies}</b>
          <span>{l.scoreBasis === "maker" ? "maker replies" : "comments"}</span>
        </span>
        <Window launchedAt={l.launchedAt} />
      </button>

      {expanded && (
        <div className="detail">
          <div className="panel">
            <h3>Suggested outreach angle</h3>
            {l.outreachAngle ? (
              <>
                <p className="angle">{l.outreachAngle}</p>
                <button className="btn btn-quiet" onClick={copyAngle}>{copied || "Copy angle"}</button>
              </>
            ) : (
              <p className="one">Gemini hasn't analyzed this launch yet. It will be picked up on the next scan.</p>
            )}
            <div className="links">
              <a href={l.url} target="_blank" rel="noreferrer">Product Hunt page</a>
              <a href={l.website} target="_blank" rel="noreferrer">Website</a>
              <span>Launched {new Date(l.launchedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              <span>Score {l.score}</span>
            </div>
          </div>
          <div className="panel">
            <h3><label htmlFor={`note-${l.id}`}>Your notes</label></h3>
            <textarea
              id={`note-${l.id}`}
              value={draft}
              onChange={(e) => editNote(e.target.value)}
              placeholder="Fit, who to contact, whether you've reached out…"
            />
            <div className="saved" aria-live="polite">{saveState}</div>
          </div>
        </div>
      )}
    </li>
  );
}
