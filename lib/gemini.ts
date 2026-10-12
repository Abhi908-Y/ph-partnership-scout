import { MY_PRODUCT } from "./config";
import { chatJson } from "./llm";
import { fitRubricText, type Rubric } from "./rubric";
import { CATEGORIES, type RawPost } from "./types";

export interface Analysis {
  id: string;
  category: string;
  relevance: number;
  oneLiner: string;
  summary: string;
  outreachAngle: string;
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    launches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES, "Not relevant"] },
          relevance: { type: "integer" },
          oneLiner: { type: "string" },
          summary: { type: "string" },
          outreachAngle: { type: "string" },
        },
        required: ["id", "category", "relevance", "oneLiner", "summary", "outreachAngle"],
        additionalProperties: false,
      },
    },
  },
  required: ["launches"],
  additionalProperties: false,
};

export async function analyzeLaunches(posts: RawPost[], rubric: Rubric): Promise<Analysis[]> {
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
- relevance: integer 0-10, how strong a partnership fit it is for an async standup tool, using this rubric:
${fitRubricText(rubric)}
- oneLiner: one plain sentence, at most 20 words, saying what the product does
- summary: two plain sentences: what the product does, and who it is for. No marketing language.
- outreachAngle: 1-2 sentences Kavya can use as her opening hook. Name a concrete way her async standup tool complements theirs (an integration, a data hand-off, a bundle, co-marketing to a shared audience). Be specific to this product. No flattery, no generic "let's collaborate".

Launches:
${JSON.stringify(input)}`;

  const parsed = await chatJson<{ launches: Analysis[] }>(prompt, "launch_analysis", ANALYSIS_SCHEMA);
  return Array.isArray(parsed?.launches) ? parsed.launches : [];
}
