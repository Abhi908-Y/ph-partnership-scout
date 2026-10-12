import { MAKER_COMMENT_WEIGHT, MIN_ALERT_FIT, WINDOW_DAYS } from "./config";
import { analyzeLaunches } from "./gemini";
import { fetchRecentLaunches } from "./producthunt";
import { getLastScan, getLaunches, removeLaunches, saveLaunches, setLastScan } from "./store";
import { sendDigest } from "./telegram";
import { CATEGORIES, type Category, type Launch, type RawPost } from "./types";

const MIN_INTERVAL_MS = 3 * 60_000;
const MAX_ANALYZE_PER_SCAN = 80;
const BATCH = 8;
const PARALLEL = 4;

export function scoreOf(p: RawPost) {
  return p.makerComments !== null ? p.votes + MAKER_COMMENT_WEIGHT * p.makerComments : p.votes + p.commentsCount;
}

const daysSince = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;
const isCategory = (c: string): c is Category => (CATEGORIES as readonly string[]).includes(c);

export type ScanResult =
  | { skipped: true; lastScan: string }
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
    return { skipped: true, lastScan: last };
  }
  const startedAt = new Date().toISOString();
  await setLastScan(startedAt);

  const { posts, errors } = await fetchRecentLaunches();
  const all = new Map<string, Launch>(Object.entries(await getLaunches()));
  let newCount = 0;

  for (const p of posts) {
    const prev = all.get(p.id);
    const fresh = { ...p, score: scoreOf(p), scoreBasis: p.makerComments === null ? ("all" as const) : ("maker" as const) };
    if (prev) {
      all.set(p.id, { ...prev, ...fresh });
    } else {
      newCount++;
      all.set(p.id, { ...fresh, category: "Pending", oneLiner: p.tagline, outreachAngle: "", relevance: 0, firstSeenAt: startedAt });
    }
  }

  // Drop anything outside the outreach window.
  const expired = [...all.values()].filter((l) => daysSince(l.launchedAt) >= WINDOW_DAYS).map((l) => l.id);
  expired.forEach((id) => all.delete(id));

  // Analyze unprocessed launches with Gemini, highest score first.
  const pending = [...all.values()]
    .filter((l) => !l.analyzedAt)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ANALYZE_PER_SCAN);
  const batches: Launch[][] = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));

  let analyzed = 0;
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const results = await Promise.allSettled(batches.slice(i, i + PARALLEL).map((b) => analyzeLaunches(b)));
    for (const r of results) {
      if (r.status === "rejected") {
        errors.push(`gemini: ${(r.reason as Error).message}`);
        continue;
      }
      for (const a of r.value) {
        const l = all.get(String(a.id));
        if (!l) continue;
        all.set(l.id, {
          ...l,
          category: isCategory(a.category) ? a.category : "Not relevant",
          relevance: Math.max(0, Math.min(10, Number(a.relevance) || 0)),
          oneLiner: a.oneLiner || l.tagline,
          outreachAngle: a.outreachAngle || "",
          analyzedAt: startedAt,
        });
        analyzed++;
      }
    }
  }

  // One Telegram digest for relevant launches (fit >= MIN_ALERT_FIT) not yet alerted.
  const toAlert = [...all.values()]
    .filter((l) => l.analyzedAt && !l.alertedAt && isCategory(l.category) && l.relevance >= MIN_ALERT_FIT)
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
