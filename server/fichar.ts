/**
 * Fichador — compreensão do fio (herança Prumo).
 * NÃO cola mensagem. NÃO cria compromisso/tarefa — só interpreta.
 */

import { chatJson, openRouterConfigured } from "./ai/openrouter.js";
import { cleanTags, suggestTagsFromText } from "./contacts.js";
import { recordTokenUsage } from "./tokens.js";
import type pg from "pg";

export type FichadoOpenItem = {
  kind: "social" | "maybe_meeting" | "followup" | "note";
  label: string;
  /** true = pendência do dono (Você); false = do contato / só contexto */
  ownerAction: boolean;
};

export type FichadoResult = {
  summary: string;
  microSummary: string;
  openItems: FichadoOpenItem[];
  themes: Array<{ label: string; status: "open" | "decided" | "idle" }>;
  tags: string[];
  tone: string;
  source: "llm" | "fallback";
  error?: string;
};

type LlmOut = {
  summary?: string;
  microSummary?: string;
  micro_summary?: string;
  themes?: Array<{ label?: string; status?: string }>;
  openItems?: Array<{ kind?: string; label?: string; ownerAction?: boolean; owner_action?: boolean }>;
  open_items?: Array<{ kind?: string; label?: string; ownerAction?: boolean; owner_action?: boolean }>;
  tags?: string[];
  tone?: string;
};

const SYSTEM = `Você é o Fichador do Prumo: secretário que LÊ O FIO e compreende o assunto.
"eu" = o dono (Você). "contato"/nome = a outra pessoa. Nunca cole o chat.
Responda só JSON:
{
  "summary": "4 a 8 frases em PT-BR: o que está em jogo, o que cada um disse/decidiu, estado atual. Cumulativo se houver fichamento anterior. NÃO cole falas.",
  "microSummary": "1 a 2 frases densas para o card/agente. Ex.: 'Junior monta o EcommFlow no GitHub; você apontou que é scaffold e ele vai codar com Claude. Sem ação sua agora.'",
  "themes": [{ "label": "tema específico", "status": "open"|"decided"|"idle" }],
  "openItems": [{ "kind": "social"|"maybe_meeting"|"followup"|"note", "label": "demanda concreta", "ownerAction": true|false }],
  "tags": ["tech","comercial",...],
  "tone": "social"|"operational"|"mixed"|"empty"
}
Direção (crítico):
- ownerAction=true SÓ se a próxima ação for do DONO (Você precisa fazer algo) e isso estiver claro no fio.
- Atualização técnica do contato (link, repo, "já subi") sem pedido a você → note ou openItems com ownerAction=false — NÃO invente pendência sua.
- Se o contato pediu e o dono já recusou, esclareceu ou o contato assumiu ("vou fazer") → ownerAction=false.
- Pedido hipotético / oferta ("se precisar faço") NÃO vira tarefa do dono.
- note = conhecimento útil (stack, link, processo), não to-do.
- maybe_meeting = encontro entre pessoas com horário.
Nunca invente fora do fio. Português do Brasil.`;

export async function ficharConversation(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    personName: string | null;
    threadLines: string[];
    previousSummary?: string | null;
    previousMicro?: string | null;
    messageId?: string | null;
  },
): Promise<FichadoResult> {
  const thread = opts.threadLines.join("\n").slice(0, 9000);
  const heuristicTags = suggestTagsFromText(thread);

  if (!openRouterConfigured() || opts.threadLines.length < 2) {
    return fallbackFichado(thread, heuristicTags);
  }

  try {
    const { data, model, usage } = await chatJson<LlmOut>({
      system: SYSTEM,
      user: JSON.stringify({
        contact: opts.personName,
        previousSummary: opts.previousSummary || null,
        previousMicro: opts.previousMicro || null,
        thread,
      }),
      temperature: 0.15,
      timeoutMs: 35_000,
    });
    try {
      await recordTokenUsage(client, {
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        messageId: opts.messageId ?? null,
        purpose: "fichar",
        model,
        prompt: usage?.prompt ?? 0,
        completion: usage?.completion ?? 0,
      });
    } catch (tokenErr) {
      console.warn(
        "[fichar] token_usage falhou (resumo mantido)",
        tokenErr instanceof Error ? tokenErr.message : tokenErr,
      );
    }

    const summary = cleanSummary(data.summary || "");
    const micro = cleanMicro(data.microSummary || data.micro_summary || data.summary || "");
    if (isBadSummary(summary) && isBadSummary(micro)) {
      console.warn("[fichar] LLM respondeu mas resumo inválido", {
        summary: summary.slice(0, 80),
        micro: micro.slice(0, 80),
        keys: Object.keys(data || {}),
      });
      return {
        ...fallbackFichado(thread, heuristicTags),
        error: `llm_bad_summary keys=${Object.keys(data || {}).join(",")}`,
      };
    }

    const openItems = normalizeItems(data.openItems || data.open_items);
    const themes = (data.themes || [])
      .filter((t) => t.label)
      .map((t) => ({
        label: String(t.label).slice(0, 80),
        status: (["open", "decided", "idle"].includes(String(t.status))
          ? t.status
          : "open") as "open" | "decided" | "idle",
      }))
      .slice(0, 8);

    return {
      summary: summary || micro,
      microSummary: micro || summary.slice(0, 280),
      openItems,
      themes,
      tags: cleanTags([...(data.tags || []), ...heuristicTags]),
      tone: data.tone || "mixed",
      source: "llm",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[fichar] falhou", msg);
    return { ...fallbackFichado(thread, heuristicTags), error: msg.slice(0, 240) };
  }
}

function normalizeItems(
  raw: LlmOut["openItems"] | LlmOut["open_items"],
): FichadoOpenItem[] {
  const out: FichadoOpenItem[] = [];
  for (const it of raw || []) {
    const kind = it.kind;
    if (!kind || !["social", "maybe_meeting", "followup", "note"].includes(kind)) continue;
    const label = String(it.label || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (!label || label.length < 8) continue;
    // Evita rótulos genéricos inúteis
    if (/pedido do contato|possível reuni|tema financeiro citado/i.test(label)) continue;
    out.push({
      kind: kind as FichadoOpenItem["kind"],
      label,
      ownerAction: Boolean(it.ownerAction ?? it.owner_action),
    });
  }
  return out.slice(0, 6);
}

function cleanSummary(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 1200);
}

function cleanMicro(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function isBadSummary(s: string): boolean {
  if (!s || s.length < 28) return true;
  if (/→|voce consegue|consegui kkk/i.test(s) && s.split("→").length >= 3) return true;
  return /conversa em andamento|sem texto|aguardando entendimento/i.test(s);
}

/** Sem LLM: NÃO inventa pendência; no máximo um note genérico. */
function fallbackFichado(thread: string, tags: string[]): FichadoResult {
  const compact = thread
    .split("\n")
    .slice(-6)
    .map((l) => l.replace(/^\[[^\]]+\]\s*/, "").slice(0, 100))
    .join(" ");
  return {
    summary:
      compact.length > 40
        ? `Fio recente (sem IA): ${compact.slice(0, 400)}. Reprocessar com OpenRouter para fichamento real.`
        : "Sem texto suficiente para fichar.",
    microSummary: "Fichamento automático fraco — aguardando IA ou mais mensagens.",
    openItems: [],
    themes: [],
    tags,
    tone: "empty",
    source: "fallback",
  };
}
