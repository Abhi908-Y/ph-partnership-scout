import { MY_PRODUCT, WINDOW_DAYS } from "./config";
import { geminiJson } from "./gemini";
import { roleOf } from "./roles";
import type { ContactsRecord, FounderContact, Launch, OutreachConfig, OutreachDraft } from "./types";

/** Resend's shared test sender: it can only deliver to the Resend account owner's own address. */
const RESEND_TEST_FROM = "Kavya <onboarding@resend.dev>";
const MAX_EMAILS_PER_DAY = 25;
export const LINKEDIN_NOTE_MAX = 200;

export function outreachConfig(): OutreachConfig {
  return {
    hunter: !!process.env.HUNTER_API_KEY,
    resend: !!process.env.RESEND_API_KEY,
    testTo: process.env.OUTREACH_TEST_TO?.trim() || null,
  };
}

/** Product Hunt's `website` is a producthunt.com/r/… redirect; follow it to the company's own domain. */
export async function resolveDomain(website: string): Promise<string | null> {
  let url = website;
  for (let hop = 0; hop < 4; hop++) {
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
    if (!host.endsWith("producthunt.com")) return host;
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) }).catch(() => null);
    const next = res?.headers.get("location");
    if (!next) return null;
    url = new URL(next, url).href;
  }
  return null;
}

const linkedinSearch = (name: string, company: string) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`)}`;

/** A Hunter error that applies to every lookup (bad key, quota), so the whole search stops. */
class HunterAccountError extends Error {}

type HunterResult = Pick<FounderContact, "email" | "emailScore" | "emailStatus" | "linkedin" | "note">;

async function hunterFind(domain: string, name: string): Promise<HunterResult> {
  const parts = name.trim().split(/\s+/);
  const params = new URLSearchParams({ domain, max_duration: "10" });
  if (parts.length >= 2) {
    params.set("first_name", parts[0]);
    params.set("last_name", parts[parts.length - 1]);
  } else {
    params.set("full_name", name);
  }
  const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`, {
    headers: { "X-API-KEY": process.env.HUNTER_API_KEY ?? "" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HunterAccountError("Hunter rejected the API key. Check HUNTER_API_KEY.");
  if (res.status === 429) throw new HunterAccountError("Hunter's monthly search limit is used up.");
  if (res.status === 403) throw new HunterAccountError("Hunter rate limit hit. Wait a minute and try again.");
  if (res.status === 451) return { note: "This person asked Hunter not to process their data, so no email is shown." };
  if (!res.ok) {
    const code = json?.errors?.[0]?.id ?? res.status;
    return { note: code === "invalid_domain" ? `Hunter can't search ${domain}.` : `Hunter error (${code}).` };
  }
  const d = json.data ?? {};
  return {
    email: d.email || undefined,
    emailScore: typeof d.score === "number" ? d.score : undefined,
    emailStatus: d.verification?.status || undefined,
    linkedin: d.linkedin_url || undefined,
    note: d.email ? undefined : "No email found for this founder.",
  };
}

/**
 * Looks up every visible founder's work email and LinkedIn with Hunter. Without HUNTER_API_KEY it
 * still lists the founders with LinkedIn search links, so LinkedIn notes work before email lookup does.
 */
export async function findContacts(launch: Launch): Promise<ContactsRecord> {
  const hasHunter = !!process.env.HUNTER_API_KEY;
  const domain = await resolveDomain(launch.website);
  const people = launch.makerProfiles?.length
    ? launch.makerProfiles
    : launch.makers.map((name) => ({ name, headline: undefined }));

  // Parallel lookups keep this well inside the function time limit; Hunter allows 15 requests/second.
  const founders: FounderContact[] = await Promise.all(
    people.map(async (p) => {
      const found: HunterResult = !hasHunter
        ? { note: "Add HUNTER_API_KEY to look up this founder's email." }
        : domain
          ? await hunterFind(domain, p.name)
          : { note: "Couldn't work out the company's website domain." };
      return {
        name: p.name,
        role: roleOf(p.headline),
        ...found,
        linkedin: found.linkedin ?? linkedinSearch(p.name, launch.name),
        linkedinIsSearch: !found.linkedin,
      };
    })
  );
  return { domain, foundAt: new Date().toISOString(), founders };
}

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING" },
    body: { type: "STRING" },
    linkedinNote: { type: "STRING" },
  },
  required: ["subject", "body", "linkedinNote"],
};

/** Gemini writes a personal email and LinkedIn note for one founder. */
export async function draftOutreach(launch: Launch, founder: FounderContact): Promise<OutreachDraft> {
  const sender = process.env.OUTREACH_SENDER_NAME || "Kavya";
  const company = process.env.MY_COMPANY_NAME;
  const day = Math.min(WINDOW_DAYS, Math.floor((Date.now() - Date.parse(launch.launchedAt)) / 86_400_000) + 1);
  const firstName = founder.name.split(/\s+/)[0];

  const prompt = `Write partnership outreach from ${sender}, partnerships lead at ${company ?? "a B2B SaaS company"}.
Her product: ${MY_PRODUCT}

Recipient: ${founder.name} (${founder.role}) of ${launch.name}, which launched on Product Hunt ${day} day(s) ago.
What ${launch.name} does: ${launch.summary || launch.oneLiner || launch.tagline}
Partnership angle to build on: ${launch.outreachAngle}

Return:
- subject: under 8 words, specific to ${launch.name}, no clickbait, no emoji.
- body: a plain-text email of 80-130 words. Open with "Hi ${firstName}," then one line congratulating them on the Product Hunt launch, then the partnership idea in concrete terms, then one low-effort ask (a 15-minute call this week). Sign off as "${sender}"${company ? ` from ${company}` : ""}. Put a blank line (two newline characters) after the greeting, between paragraphs, and before the sign-off. No flattery, no buzzwords, no placeholders like [Name], and don't invent facts about either company.
- linkedinNote: a LinkedIn connection note of at most ${LINKEDIN_NOTE_MAX} characters, addressed to ${firstName}, mentioning ${launch.name}'s launch and the partnership idea in one short line.`;

  const d = await geminiJson<OutreachDraft>(prompt, DRAFT_SCHEMA);
  return {
    subject: d.subject.trim(),
    body: d.body.trim(),
    linkedinNote: d.linkedinNote.trim().slice(0, LINKEDIN_NOTE_MAX),
  };
}

/**
 * Sends one email through Resend. In test mode (OUTREACH_TEST_TO set) the email goes to that
 * address instead of the founder, marked with who it would have reached.
 */
export async function sendOutreachEmail(founder: FounderContact, subject: string, body: string, sentToday: number) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Add RESEND_API_KEY to send email.");
  if (!founder.email) throw new Error(`No email is known for ${founder.name}.`);
  if (sentToday > MAX_EMAILS_PER_DAY) throw new Error(`Daily limit of ${MAX_EMAILS_PER_DAY} emails reached. Try again tomorrow.`);

  const { testTo } = outreachConfig();
  const to = testTo ?? founder.email;
  const finalSubject = testTo ? `[TEST] ${subject}` : subject;
  const finalBody = testTo
    ? `[Test mode: in real use this email goes to ${founder.name} <${founder.email}>]\n\n${body}`
    : body;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.OUTREACH_FROM || RESEND_TEST_FROM,
      to: [to],
      subject: finalSubject,
      text: finalBody,
      ...(process.env.OUTREACH_REPLY_TO ? { reply_to: process.env.OUTREACH_REPLY_TO } : {}),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${json?.message ?? JSON.stringify(json).slice(0, 200)}`);
  return { id: String(json.id ?? ""), to };
}
