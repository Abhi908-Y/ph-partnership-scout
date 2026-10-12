export const CATEGORIES = [
  "Project management",
  "HR tech",
  "Developer productivity",
  "Team communication",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Kavya's outreach progress per launch, set from the dashboard. */
export const OUTREACH_STATUSES = ["new", "contacted", "replied", "partner"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];
export type Classification = Category | "Not relevant" | "Pending";

export interface RawPost {
  id: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  website: string;
  thumbnail?: string;
  votes: number;
  commentsCount: number;
  /** Comments written by the product's makers (PH `makerReplies`). null when every maker name is redacted. */
  makerComments: number | null;
  /** Visible maker names; redacted ones are dropped. */
  makers: string[];
  /** Visible makers with their Product Hunt headline (role) and username, for the detail view. */
  makerProfiles?: { name: string; headline?: string; username?: string }[];
  /** Makers whose identity Product Hunt redacted. */
  makersHidden?: number;
  topics: string[];
  launchedAt: string;
}

export interface Launch extends RawPost {
  category: Classification;
  oneLiner: string;
  /** Gemini's 2-sentence summary of what the product does and who it's for. */
  summary?: string;
  outreachAngle: string;
  relevance: number;
  score: number;
  /** "maker" = votes + weighted maker comments; "all" = fallback using total comments */
  scoreBasis: "maker" | "all";
  firstSeenAt: string;
  analyzedAt?: string;
  /** Rubric version Gemini used for category/fit; a newer rubric triggers re-scoring. */
  rubricVersion?: number;
  alertedAt?: string;
}

/** A Gemini-written outreach draft for one founder. */
export interface OutreachDraft {
  subject: string;
  body: string;
  /** LinkedIn connection note, at most 200 characters (the free-account limit). */
  linkedinNote: string;
}

/** Contact details found for one founder, plus drafts and what was sent. */
export interface FounderContact {
  name: string;
  role: string;
  email?: string;
  /** "personal" = the founder's own address; "company" = a public contact address of the company. */
  emailKind?: "personal" | "company";
  linkedin?: string;
  /** True when `linkedin` is a LinkedIn people-search link rather than a known profile. */
  linkedinIsSearch?: boolean;
  /** Why no email is shown (not found, opted out, ...). */
  note?: string;
  draft?: OutreachDraft;
  sentAt?: string;
  sentTo?: string;
  sentSubject?: string;
}

export interface ContactsRecord {
  domain: string | null;
  foundAt: string;
  founders: FounderContact[];
}

/** What the dashboard needs to know about outreach setup (no secrets). */
export interface OutreachConfig {
  /** Web search for LinkedIn/email is available (OPENROUTER_API_KEY set). */
  search: boolean;
  resend: boolean;
  /** When set, every email is delivered to this address instead of the founder. */
  testTo: string | null;
}
