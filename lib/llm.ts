// Gemini Flash through the OpenRouter gateway (the only AI access this project has).
// Every request is pinned to Google's own infrastructure and only "google/" models are used.

const BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3.7-flash";
const GOOGLE_ONLY = { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false };

type Message = { role: "system" | "user" | "assistant"; content: string };

interface ChatOptions {
  messages: Message[];
  /** JSON Schema for a structured reply (root must be an object). */
  schema?: { name: string; schema: object };
  /** Run an OpenRouter web search (Exa) on the last user message first. */
  webSearch?: { maxResults: number };
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  /** Pages the web search returned, with their text when available. */
  citations: { url: string; title?: string; content?: string }[];
  costUsd: number;
}

/** GEMINI_MODEL may be "gemini-3.7-flash" or "google/gemini-3.7-flash"; only Google models are allowed. */
function configuredModel(): string {
  const raw = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const id = raw.startsWith("google/") ? raw : `google/${raw}`;
  if (!/^google\/gemini-[\w.-]*flash/.test(id)) throw new Error(`GEMINI_MODEL must be a Gemini Flash model, got "${raw}".`);
  return id;
}

let modelCheck: Promise<string> | null = null;

/** Confirms the model still exists on OpenRouter; otherwise swaps in the newest Gemini Flash and logs it. */
function resolveModel(): Promise<string> {
  modelCheck ??= (async () => {
    const wanted = configuredModel();
    const res = await fetch(`${BASE}/models`, { cache: "no-store" }).catch(() => null);
    const ids: string[] = res?.ok ? ((await res.json()).data ?? []).map((m: { id: string }) => m.id) : [];
    if (!ids.length || ids.includes(wanted)) return wanted;
    const fallback = ids
      .filter((id) => /^google\/gemini-[\d.]+-flash$/.test(id))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (!fallback) return wanted;
    console.warn(`[llm] ${wanted} is no longer on OpenRouter; using ${fallback} instead.`);
    return fallback;
  })().catch((err) => {
    modelCheck = null;
    throw err;
  });
  return modelCheck;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
  const model = await resolveModel();

  const body = {
    model,
    messages: opts.messages,
    provider: { ...GOOGLE_ONLY, ...(opts.schema ? { require_parameters: true } : {}) },
    reasoning: { effort: "low" },
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.schema
      ? { response_format: { type: "json_schema", json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } } }
      : {}),
    // Exa, because Google's native search was skipped when combined with structured output.
    ...(opts.webSearch ? { plugins: [{ id: "web", engine: "exa", max_results: opts.webSearch.maxResults }] } : {}),
  };

  // Retry rate limits and server errors up to 3 times with backoff; stop on 402 (out of credits).
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    }).catch((err: Error) => ({ ok: false, status: 599, json: async () => ({ error: { message: err.message } }) }) as const);
    const json = await res.json().catch(() => ({}));
    const choiceError = json?.choices?.[0]?.error;

    if (res.status === 402) throw new Error("OpenRouter credits are used up. Top up at openrouter.ai to keep using Gemini.");
    const retryable = res.status === 429 || res.status >= 500 || (res.ok && choiceError);
    if (retryable && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok || choiceError) {
      throw new Error(`Gemini via OpenRouter ${res.status}: ${JSON.stringify(json?.error ?? choiceError ?? json).slice(0, 300)}`);
    }

    const message = json.choices?.[0]?.message ?? {};
    const costUsd = Number(json.usage?.cost ?? 0);
    console.log(`[llm] ${json.model ?? model} via ${json.provider ?? "?"}: $${costUsd.toFixed(4)}`);
    return {
      text: String(message.content ?? ""),
      citations: (message.annotations ?? [])
        .filter((a: { type?: string }) => a.type === "url_citation")
        .map((a: { url_citation: { url: string; title?: string; content?: string } }) => a.url_citation),
      costUsd,
    };
  }
}

/** Parses a JSON reply, tolerating a ```json fence. */
export function parseJson<T>(text: string): T {
  return JSON.parse(text.replace(/```json|```/g, "").trim()) as T;
}

/** Structured call: returns the parsed object that matches `schema`. */
export async function chatJson<T>(prompt: string, name: string, schema: object): Promise<T> {
  const { text } = await chat({ messages: [{ role: "user", content: prompt }], schema: { name, schema } });
  return parseJson<T>(text);
}
