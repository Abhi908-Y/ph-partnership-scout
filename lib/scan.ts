import { WINDOW_DAYS } from "./config";
import { analyzeLaunches } from "./gemini";
import { fetchRecentLaunches } from "./producthunt";
import { scoreWith, type Rubric } from "./rubric";
import {
  acquireScanLock,
  getBookmarks,
  getLastScan,
  getLaunches,
  getRubric,
  releaseScanLock,
  removeLaunches,
  saveLaunches,
  setLastScan,
} from "./store";
import { sendDigest } from "./telegram";
import { CATEGORIES, type Category, type Launch, type RawPost } from "./types";

const MIN_INTERVAL_MS = 3 * 60_000;
const MAX_ANALYZE_PER_SCAN = 80;
const BATCH = 8;
const PARALLEL = 4;

/** Ranking score under the dashboard-editable rubric (default: upvotes + 5 × maker replies). */
export function scoreOf(p: RawPost & { relevance?: number; analyzedAt?: string }, rubric: Rubric) {
  return scoreWith(p, rubric);
}

const daysSince = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;
const isCategory = (c: string): c is Category => (CATEGORIES as readonly string[]).includes(c);

export type ScanResult =
  | { skipped: true; reason: "recent" | "running"; lastScan: string }
  | {
      skipped: false;
      lastScan: string;
      found: number;
      newCount: number;
      analyzed: number;
      alerted: number;
      expired: number;
      errors: string[];
    };

export async function runScan({ force }: { force: boolean }): Promise<ScanResult> {
  const last = await getLastScan();
  if (!force && last && Date.now() - Date.parse(last) < MIN_INTERVAL_MS) {
    return { skipped: true, reason: "recent", lastScan: last };
  }
  // Only one scan at a time: the cron scan and a "Scan now" click could otherwise both send the
  // same Telegram digest and pay for the same Gemini analysis twice.
  const lock = await acquireScanLock();
  if (!lock) return { skipped: true, reason: "running", lastScan: last ?? new Date().toISOString() };
  try {
    return await scanOnce();
  } finally {
    await releaseScanLock(lock).catch(() => {});
  }
}

async function scanOnce(): Promise<ScanResult> {
  const startedAt = new Date().toISOString();
  await setLastScan(startedAt);

  const rubric = await getRubric();
  const { posts, errors } = await fetchRecentLaunches();
  const all = new Map<string, Launch>(Object.entries(await getLaunches()));
  let newCount = 0;

  for (const p of posts) {
    const prev = all.get(p.id);
    const fresh = { ...p, score: scoreOf({ ...prev, ...p }, rubric), scoreBasis: p.makerComments === null ? ("all" as const) : ("maker" as const) };
    if (prev) {
      all.set(p.id, { ...prev, ...fresh });
    } else {
      newCount++;
      all.set(p.id, { ...fresh, category: "Pending", oneLiner: p.tagline, outreachAngle: "", relevance: 0, firstSeenAt: startedAt });
    }
  }

  // Drop anything outside the outreach window from this scan. Bookmarked launches stay in the
  // database (untouched, not re-scored or re-alerted) so they remain in Kavya's Saved tab.
  const bookmarked = new Set(await getBookmarks());
  const outOfWindow = [...all.values()].filter((l) => daysSince(l.launchedAt) >= WINDOW_DAYS).map((l) => l.id);
  outOfWindow.forEach((id) => all.delete(id));
  const expired = outOfWindow.filter((id) => !bookmarked.has(id));

  // Analyze with Gemini: new launches first, then ones scored under an older rubric (or before
  // summaries existed), highest score first within each group.
  const stale = (l: Launch) => !l.summary || (l.rubricVersion ?? 1) !== rubric.version;
  const pending = [...all.values()]
    .filter((l) => !l.analyzedAt || stale(l))
    .sort((a, b) => Number(!!a.analyzedAt) - Number(!!b.analyzedAt) || b.score - a.score)
    .slice(0, MAX_ANALYZE_PER_SCAN);
  const batches: Launch[][] = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));

  let analyzed = 0;
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const results = await Promise.allSettled(batches.slice(i, i + PARALLEL).map((b) => analyzeLaunches(b, rubric)));
    for (const r of results) {
      if (r.status === "rejected") {
        errors.push(`gemini: ${(r.reason as Error).message}`);
        continue;
      }
      for (const a of r.value) {
        const l = all.get(String(a.id));
        if (!l) continue;
        const relevance = Math.max(0, Math.min(10, Number(a.relevance) || 0));
        all.set(l.id, {
          ...l,
          category: isCategory(a.category) ? a.category : "Not relevant",
          relevance,
          score: scoreOf({ ...l, relevance, analyzedAt: startedAt }, rubric),
          rubricVersion: rubric.version,
          oneLiner: a.oneLiner || l.tagline,
          summary: a.summary || undefined,
          outreachAngle: a.outreachAngle || "",
          analyzedAt: startedAt,
        });
        analyzed++;
      }
    }
  }

  // One Telegram digest for relevant launches (fit >= the rubric's threshold) not yet alerted.
  const toAlert = [...all.values()]
    .filter((l) => l.analyzedAt && !l.alertedAt && isCategory(l.category) && l.relevance >= rubric.minAlertFit)
    .sort((a, b) => b.score - a.score);
  let alerted = 0;
  if (toAlert.length && (await sendDigest(toAlert))) {
    alerted = toAlert.length;
    for (const l of toAlert) all.set(l.id, { ...l, alertedAt: startedAt });
  }

  await removeLaunches(expired);
  await saveLaunches([...all.values()]);

  if (errors.length) console.error("[scan] errors:", errors);

  return { skipped: false, lastScan: startedAt, found: posts.length, newCount, analyzed, alerted, expired: expired.length, errors };
}
