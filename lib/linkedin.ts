// LinkedIn helpers shared by the server (lookup) and the dashboard (fallback links).

/**
 * Fallback when no profile could be confirmed: a Google search for the person's LinkedIn. LinkedIn's own
 * people search needs a login and returns nothing when the (days-old) product name is in the query.
 */
export function linkedinSearchUrl(name: string, company: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${name}" ${company} linkedin`)}`;
}

/** Lowercase, accent-free words, for comparing names and titles. */
export function nameWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Generic words that appear in product names but say nothing about which company a page is about.
const GENERIC = new Set(
  "browser agent agents studio labs cloud tool tools platform team teams work workspace chat data solopreneurs pro plus beta public launch".split(" ")
);

/** Words that identify the company: distinctive product-name words plus the domain name ("getvelozity" → "velozity"). */
export function brandWords(launchName: string, domain: string | null): string[] {
  const fromName = nameWords(launchName).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const label = domain?.split(".").slice(-2)[0]?.replace(/^(get|try|use|join|go|hello|with)(?=.{4,})/, "") ?? "";
  return [...new Set([...fromName, ...(label.length >= 4 ? [label] : [])])];
}

interface Citation {
  url: string;
  title?: string;
  content?: string;
}

/**
 * A LinkedIn profile is accepted only when (1) it appears in the search results, (2) its page shows the
 * founder's full name, and (3) a page by that same person (profile or post) mentions the company.
 * This rejects same-name strangers, which the search returns often for common names.
 */
export function confirmedProfile(
  candidate: string | null | undefined,
  founderName: string,
  brands: string[],
  citations: Citation[]
): string | undefined {
  const handle = candidate?.match(/linkedin\.com\/in\/([^/?#\s]+)/i)?.[1]?.toLowerCase();
  if (!handle) return undefined;
  const byPerson = citations.filter((c) => {
    const u = c.url.toLowerCase();
    return u.includes(`/in/${handle}`) || u.includes(`/posts/${handle}_`);
  });
  const profile = byPerson.find((c) => c.url.toLowerCase().includes(`/in/${handle}`)) ?? byPerson[0];
  if (!profile) return undefined;

  const wanted = nameWords(founderName);
  const shown = new Set(nameWords(`${profile.title ?? ""} ${handle.replace(/-/g, " ")}`));
  const nameOk = wanted.length > 0 && wanted.every((w) => shown.has(w));
  const companyOk = byPerson.some((c) => {
    const text = `${c.url} ${c.title ?? ""} ${c.content ?? ""}`.toLowerCase();
    return brands.some((b) => text.includes(b));
  });
  return nameOk && companyOk ? `https://www.linkedin.com/in/${handle}` : undefined;
}
