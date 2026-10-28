/** Cliente mínimo OpenRouter — só JSON curto para decidir create|update. */

export class AiError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`,
    "Content-Type": "application/json",
    "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "Prumo",
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim() || process.env.APP_URL?.trim();
  if (referer) h["HTTP-Referer"] = referer;
  return h;
}

function baseUrl(): string {
  return process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
}

function model(): string {
  return process.env.AI_MODEL_STRUCTURE?.trim() || "google/gemini-2.5-flash-lite";
}

export async function chatJson<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ data: T; model: string; usage?: { prompt: number; completion: number } }> {
  if (!openRouterConfigured()) {
    throw new AiError("OpenRouter não configurado. Defina OPENROUTER_API_KEY.", 503);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: headers(),
      signal: controller.signal,
      body: JSON.stringify({
        model: model(),
        temperature: opts.temperature ?? 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    const raw = await res.text();
    let parsed: {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      throw new AiError(
        parsed.error?.message || `OpenRouter HTTP ${res.status}`,
        res.status >= 400 && res.status < 600 ? res.status : 502,
      );
    }
    const content = parsed.choices?.[0]?.message?.content?.trim() || "";
    if (!content) throw new AiError("Resposta LLM vazia");
    return {
      data: JSON.parse(content) as T,
      model: parsed.model || model(),
      usage: {
        prompt: parsed.usage?.prompt_tokens ?? 0,
        completion: parsed.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
