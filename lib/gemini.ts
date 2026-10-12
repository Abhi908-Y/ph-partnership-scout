import { MY_PRODUCT } from "./config";
import { CATEGORIES, type RawPost } from "./types";

export interface Analysis {
  id: string;
  category: string;
  relevance: number;
  oneLiner: string;
  outreachAngle: string;
}

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      category: { type: "STRING", enum: [...CATEGORIES, "Not relevant"] },
      relevance: { type: "INTEGER" },
      oneLiner: { type: "STRING" },
      outreachAngle: { type: "STRING" },
    },
    required: ["id", "category", "relevance", "oneLiner", "outreachAngle"],
  },
};

export async function analyzeLaunches(posts: RawPost[]): Promise<Analysis[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  // Gemini 3.x: keep the default temperature and use a low thinking level so batches stay fast.
  // Older 2.5 models don't accept thinkingLevel.
  const modelConfig = model.startsWith("gemini-3")
    ? { thinkingConfig: { thinkingLevel: "low" } }
    : { temperature: 0.4 };

  const input = posts.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    topics: p.topics,
  }));

  const prompt = `You are helping Kavya, partnerships lead at a B2B SaaS company.
Her product: ${MY_PRODUCT}

She partners with newly launched tools in four adjacent categories: ${CATEGORIES.join(", ")}.

For each Product Hunt launch below, return:
- id: copied exactly
- category: one of the four categories, or "Not relevant" if it is not a tool used by teams at work
- relevance: integer 0-10, how strong a partnership fit it is for an async standup tool
- oneLiner: one plain sentence, at most 20 words, saying what the product does
- outreachAngle: 1-2 sentences Kavya can use as her opening hook. Name a concrete way her async standup tool complements theirs (an integration, a data hand-off, a bundle, co-marketing to a shared audience). Be specific to this product. No flattery, no generic "let's collaborate".

Launches:
${JSON.stringify(input)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { ...modelConfig, responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);

  const text: string =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "[]";
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  return Array.isArray(parsed) ? parsed : [];
}
