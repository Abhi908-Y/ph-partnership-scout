import { MY_PRODUCT, WINDOW_DAYS } from "./config";
import { chat, chatJson, parseJson } from "./llm";
import { roleOf } from "./roles";
import type { ContactsRecord, FounderContact, Launch, OutreachConfig, OutreachDraft } from "./types";

/** Resend's shared test sender: it can only deliver to the Resend account owner's own address. */
const RESEND_TEST_FROM = "Kavya <onboarding@resend.dev>";
const MAX_EMAILS_PER_DAY = 25;
export const LINKEDIN_NOTE_MAX = 200;

export function outreachConfig(): OutreachConfig {
  return {
    search: !!process.env.OPENROUTER_API_KEY,
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

const WEBMAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|proton|protonmail|aol)\./;
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4);

/** True when an email's domain plausibly belongs to the launch (getvelozity.com ~ velozity.ai, "AUDR by Chargebee" ~ chargebee.com). */
function companyDomain(emailDomain: string, launchDomain: string | null, launchName: string): boolean {
  const label = emailDomain.split(".").slice(-2)[0] ?? "";
  if (!label || WEBMAIL.test(emailDomain)) return false;
  const brand = [...words(launchName), ...(launchDomain ? [launchDomain.split(".").slice(-2)[0]] : [])];
  return brand.some((b) => b === label || b.includes(label) || (label.includes(b) && b.length >= 4));
}

const SEARCH_SYSTEM = `You extract contact details from web search results. Reply with JSON only:
{"linkedin": string|null, "email": string|null, "companyEmail": string|null}
- linkedin: a linkedin.com/in/ profile URL of the named person that appears in the results.
- email: an address belonging to that person that appears verbatim in the results.
- companyEmail: a contact address of the named company that appears verbatim in the results.
Use null otherwise. Never guess or construct anything.`;

/**
 * Searches the web (Gemini Flash + Exa via OpenRouter) for one founder's LinkedIn and email, then keeps
 * only what the search results actually contain, so a made-up address or profile never reaches the UI.
 */
async function searchFounder(name: string, role: string, launch: Launch, domain: string | null) {
  const { text, citations } = await chat({
    messages: [
      { role: "system", content: SEARCH_SYSTEM },
      // The last user message is the search query, so keep it short and specific.
      { role: "user", content: [name, role !== "Maker" ? role : "", launch.name, domain ?? "", "LinkedIn"].filter(Boolean).join(" ") },
    ],
    webSearch: { maxResults: 6 },
    maxTokens: 300,
  });

  let found: { linkedin?: string | null; email?: string | null; companyEmail?: string | null } = {};
  try {
    found = parseJson(text);
  } catch {
    // Unparseable reply: fall through with nothing found.
  }
  const urls = citations.map((c) => c.url.toLowerCase());
  const corpus = citations.map((c) => `${c.url} ${c.title ?? ""} ${c.content ?? ""}`).join("\n").toLowerCase();
  const nameParts = words(name);

  const handle = found.linkedin?.match(/linkedin\.com\/in\/([^/?#\s]+)/i)?.[1];
  const linkedin =
    handle && urls.some((u) => u.includes(`/in/${handle.toLowerCase()}`)) ? `https://www.linkedin.com/in/${handle}` : undefined;

  const seen = (email: string) => (corpus.trim() ? corpus.includes(email.toLowerCase()) : true);
  const valid = (email?: string | null) => (email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? email.trim() : null);

  const personal = valid(found.email);
  const personalOk =
    personal &&
    seen(personal) &&
    (companyDomain(personal.split("@")[1], domain, launch.name) ||
      nameParts.some((p) => personal.split("@")[0].toLowerCase().includes(p)));
  const company = valid(found.companyEmail);
  const companyOk = company && seen(company) && companyDomain(company.split("@")[1], domain, launch.name);

  return {
    linkedin,
    email: personalOk ? personal : companyOk ? company : undefined,
    emailKind: personalOk ? ("personal" as const) : companyOk ? ("company" as const) : undefined,
  };
}

/**
 * Finds every visible founder's LinkedIn profile and any public email. Without OPENROUTER_API_KEY it
 * still lists the founders with LinkedIn search links, so drafts and LinkedIn notes keep working.
 */
export async function findContacts(launch: Launch): Promise<ContactsRecord> {
  const canSearch = !!process.env.OPENROUTER_API_KEY;
  const domain = await resolveDomain(launch.website);
  const people = launch.makerProfiles?.length
    ? launch.makerProfiles
    : launch.makers.map((name) => ({ name, headline: undefined }));

  const founders: FounderContact[] = await Promise.all(
    people.map(async (p) => {
      const role = roleOf(p.headline);
      const found = canSearch
        ? await searchFounder(p.name, role, launch, domain).catch((err) => {
            console.error(`[outreach] search failed for ${p.name}:`, (err as Error).message);
            return { linkedin: undefined, email: undefined, emailKind: undefined };
          })
        : { linkedin: undefined, email: undefined, emailKind: undefined };
      return {
        name: p.name,
        role,
        email: found.email,
        emailKind: found.emailKind,
        note: found.email ? undefined : "No email ID found",
        linkedin: found.linkedin ?? linkedinSearch(p.name, launch.name),
        linkedinIsSearch: !found.linkedin,
      };
    })
  );
  // A company inbox found while searching one founder applies to the others who have no own address.
  const companyEmail = founders.find((f) => f.emailKind === "company")?.email;
  if (companyEmail) {
    for (const f of founders) {
      if (!f.email) Object.assign(f, { email: companyEmail, emailKind: "company", note: undefined });
    }
  }
  return { domain, foundAt: new Date().toISOString(), founders };
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    linkedinNote: { type: "string" },
  },
  required: ["subject", "body", "linkedinNote"],
  additionalProperties: false,
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

  const d = await chatJson<OutreachDraft>(prompt, "outreach_draft", DRAFT_SCHEMA);
  return {
    subject: d.subject.trim(),
    body: d.body.trim(),
    linkedinNote: d.linkedinNote.trim().slice(0, LINKEDIN_NOTE_MAX),
  };
}

/**
 * Sends one email through Resend. In test mode (OUTREACH_TEST_TO set) the email goes to that
 * address instead of the founder, so a draft can be sent even when no founder email was found.
 */
export async function sendOutreachEmail(founder: FounderContact, subject: string, body: string, sentToday: number) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Add RESEND_API_KEY to send email.");
  const { testTo } = outreachConfig();
  if (!testTo && !founder.email) throw new Error(`No email is known for ${founder.name}.`);
  if (sentToday > MAX_EMAILS_PER_DAY) throw new Error(`Daily limit of ${MAX_EMAILS_PER_DAY} emails reached. Try again tomorrow.`);

  const to = testTo ?? founder.email!;
  const realTo = founder.email ? `${founder.name} <${founder.email}>` : `${founder.name} (no email ID found)`;
  const finalSubject = testTo ? `[TEST] ${subject}` : subject;
  const finalBody = testTo ? `[Test mode: in real use this email goes to ${realTo}]\n\n${body}` : body;

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
