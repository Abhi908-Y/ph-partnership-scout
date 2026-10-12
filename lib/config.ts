export const WINDOW_DAYS = 7;
export const MAKER_COMMENT_WEIGHT = 5;

export const MY_PRODUCT =
  process.env.MY_PRODUCT_DESCRIPTION ??
  "A B2B SaaS tool that helps remote teams run async standups: team members post short written or video updates on their own schedule, blockers are surfaced automatically, and managers get a daily digest in Slack or email instead of a live meeting.";

// Product Hunt topic slugs mapped to Kavya's four adjacent categories (all verified against the API;
// PH has no "project-management" or "team-collaboration" topic). Gemini filters out off-topic posts.
// Each topic costs ~100 of Product Hunt's 6,250 complexity points per 15 min. Override with PH_TOPICS.
const DEFAULT_TOPICS = [
  "task-management", // Project management
  "productivity",
  "human-resources", // HR tech
  "hiring",
  "developer-tools", // Developer productivity
  "software-engineering",
  "meetings", // Team communication
  "messaging",
  "remote-work",
];

export function topicSlugs(): string[] {
  const env = process.env.PH_TOPICS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_TOPICS;
}
