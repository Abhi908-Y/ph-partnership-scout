export const CATEGORIES = [
  "Project management",
  "HR tech",
  "Developer productivity",
  "Team communication",
] as const;

export type Category = (typeof CATEGORIES)[number];
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
  topics: string[];
  launchedAt: string;
}

export interface Launch extends RawPost {
  category: Classification;
  oneLiner: string;
  outreachAngle: string;
  relevance: number;
  score: number;
  /** "maker" = votes + weighted maker comments; "all" = fallback using total comments */
  scoreBasis: "maker" | "all";
  firstSeenAt: string;
  analyzedAt?: string;
  alertedAt?: string;
}
