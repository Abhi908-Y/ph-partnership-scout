// Turns a free-text Product Hunt headline ("ceo@velozity", "Co-Founder & CTO at Coddy")
// into a short title for display. Falls back to "Maker": everyone listed is on the making team.

const C_LEVEL = /\b(ceo|cto|coo|cpo|cmo|cfo|cro)\b/gi;
const SPECIALTIES: [RegExp, string][] = [
  [/\b(product manager|product manger|pm)\b/i, "Product Manager"],
  [/\bdesigner\b/i, "Designer"],
  [/\b(engineer|developer|dev|devops|programmer)\b/i, "Engineer"],
  [/\b(researcher|scientist)\b/i, "Researcher"],
  [/\b(growth|marketer|marketing)\b/i, "Growth"],
];

export function roleOf(headline?: string): string {
  if (!headline) return "Maker";
  const h = headline.replace(/@/g, " @ ");
  const cLevel = [...new Set([...h.matchAll(C_LEVEL)].map((m) => m[1].toUpperCase()))];
  const founder = /\bco-?\s?founder\b/i.test(h)
    ? "Co-founder"
    : /\bfounder\b/i.test(h)
      ? "Founder"
      : /\bfounding\b/i.test(h)
        ? "Founding team"
        : null;

  const parts = [founder, ...cLevel].filter(Boolean) as string[];
  if (parts.length) return parts.slice(0, 2).join(" & ");
  for (const [re, label] of SPECIALTIES) if (re.test(h)) return label;
  return "Maker";
}
