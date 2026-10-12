// The scoring rubric, editable from the dashboard and stored in Neon (meta key "rubric").
// Pure code: used by both the server (scan, Telegram, Gemini prompt) and the browser (ranking).

export interface FitBand {
  /** Inclusive score range, fixed: 9-10, 6-8, 3-5, 0-2. */
  min: number;
  max: number;
  description: string;
}

export interface Rubric {
  weights: {
    /** Points per upvote. */
    upvotes: number;
    /** Points per comment written by the makers (the assignment's responsiveness signal). */
    makerReplies: number;
    /** Points per comment of any kind, used only when Product Hunt hides every maker. */
    comments: number;
    /** Points per point of Gemini's 0-10 partnership fit. */
    fit: number;
  };
  /** How Gemini should assign the 0-10 partnership fit. */
  fitBands: FitBand[];
  /** Launches below this fit are left out of the Telegram digest. */
  minAlertFit: number;
  /** Bumped whenever fitBands change, so existing launches get re-scored by Gemini. */
  version: number;
  updatedAt?: string;
}

export const DEFAULT_RUBRIC: Rubric = {
  weights: { upvotes: 1, makerReplies: 5, comments: 1, fit: 0 },
  fitBands: [
    {
      min: 9,
      max: 10,
      description:
        "Direct integration fit: a tool teams use daily where async standup updates or blockers could flow in (project management, team chat, developer workflow).",
    },
    {
      min: 6,
      max: 8,
      description:
        "Same buyers (remote teams, engineering or people managers). A bundle or co-marketing makes sense; a deep integration is a stretch.",
    },
    { min: 3, max: 5, description: "Loose overlap: used at work, but not by the teams that run standups." },
    { min: 0, max: 2, description: "Not a team or work tool, or a direct competitor to async standups." },
  ],
  minAlertFit: 5,
  version: 1,
};

const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Fills gaps with defaults and clamps values, so a bad save can't break scoring. */
export function normalizeRubric(input: unknown): Rubric {
  const r = (input ?? {}) as Partial<Rubric>;
  const w = (r.weights ?? {}) as Partial<Rubric["weights"]>;
  const d = DEFAULT_RUBRIC;
  return {
    weights: {
      upvotes: clampNum(w.upvotes, 0, 100, d.weights.upvotes),
      makerReplies: clampNum(w.makerReplies, 0, 100, d.weights.makerReplies),
      comments: clampNum(w.comments, 0, 100, d.weights.comments),
      fit: clampNum(w.fit, 0, 1000, d.weights.fit),
    },
    fitBands: d.fitBands.map((band, i) => ({
      ...band,
      description: String(r.fitBands?.[i]?.description ?? band.description).trim().slice(0, 400) || band.description,
    })),
    minAlertFit: Math.round(clampNum(r.minAlertFit, 0, 10, d.minAlertFit)),
    version: Math.max(1, Math.round(clampNum(r.version, 1, 1e6, d.version))),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
  };
}

export interface ScoreInput {
  votes: number;
  commentsCount: number;
  /** null when every maker is hidden by Product Hunt. */
  makerComments: number | null;
  relevance?: number;
  analyzedAt?: string;
}

export interface ScoreBreakdown {
  total: number;
  parts: { label: string; count: number; weight: number; points: number }[];
}

/** Ranking score under the current rubric, with each term for display. */
export function scoreBreakdown(l: ScoreInput, r: Rubric): ScoreBreakdown {
  const parts = [{ label: "upvotes", count: l.votes, weight: r.weights.upvotes }];
  if (l.makerComments !== null) parts.push({ label: "maker replies", count: l.makerComments, weight: r.weights.makerReplies });
  else parts.push({ label: "comments (makers hidden)", count: l.commentsCount, weight: r.weights.comments });
  if (r.weights.fit && l.analyzedAt) parts.push({ label: "Gemini fit", count: l.relevance ?? 0, weight: r.weights.fit });
  const withPoints = parts.map((p) => ({ ...p, points: p.count * p.weight }));
  return { total: Math.round(withPoints.reduce((s, p) => s + p.points, 0) * 10) / 10, parts: withPoints };
}

export const scoreWith = (l: ScoreInput, r: Rubric) => scoreBreakdown(l, r).total;

export const bandFor = (fit: number, r: Rubric) => r.fitBands.find((b) => fit >= b.min && fit <= b.max);

/** The fit instructions Gemini receives. */
export function fitRubricText(r: Rubric): string {
  return r.fitBands.map((b) => `  ${b.min}-${b.max}: ${b.description}`).join("\n");
}
