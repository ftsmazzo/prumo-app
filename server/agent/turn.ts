import type pg from "pg";
import { chatJson, openRouterConfigured } from "../ai/openrouter.js";
import { enqueueJobSafe } from "../jobs.js";
import { recordTokenUsage } from "../tokens.js";
import { gateAgentReply } from "./gates.js";
import {
  toolCompleteTask,
  toolConfirmPending,
  toolCreateCommitment,
  toolCreateTask,
  toolRescheduleTomorrow,
  toolSearchHistory,
  toolToday,
  type ToolResult,
} from "./tools.js";

export type AgentTurnResult =
  | { status: "ignored"; reason: string }
  | { status: "replied"; body: string; outboundId: string };

function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  const ta = da.slice(-11);
  const tb = db.slice(-11);
  return ta === tb || da.endsWith(tb) || db.endsWith(ta);
}

type LlmPlan = {
  reply?: string;
  tool?: string | null;
  title?: string;
  startsAt?: string;
  dueOn?: string | null;
  hint?: string;
};

/** Evidência do gate = comando do usuário + saída SQL das tools (nunca a reply livre da LLM). */
type ResolvedTurn = { text: string; evidence: string };

const SYSTEM = `Você é o Prumo, secretário pessoal no WhatsApp. Responda em português curto e natural (não robótico).
Escolha UMA ferramenta SQL ou só responda.
JSON: {"tool":"today"|"confirm"|"reschedule"|"complete"|"create_commitment"|"create_task"|"search"|null,"title":"...","startsAt":"ISO se create_commitment","dueOn":"YYYY-MM-DD se create_task","hint":"trecho para achar item ou busca","reply":"texto se tool=null"}
Regras:
- Perguntas sobre agenda/tarefas do dia → today
- Confirmar o que está pendente → confirm
- Remarcar → reschedule (+ hint)
- Concluir tarefa → complete (+ hint)
- Lembrar o que combinou / buscar no histórico → search (+ hint)
- Criar compromisso com horário → create_commitment (title curto tipo secretária + startsAt ISO America/Sao_Paulo)
- Criar tarefa/ação que o dono pediu agora → create_task (title curto; dueOn YYYY-MM-DD se souber)
- Pendências do motor (needs_confirm) → confirm quando ele aceitar
- Você decide com o motor: o claro já veio pra confirmar; não invente tarefa de ruído
- Sem ação clara → tool null e reply útil
Nunca invente telefone, link ou valor.`;

/** Processa mensagem no canal agent_*: whitelist → atalho ou LN → tools → gates → outbound. */
export async function runAgentTurn(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    channelId: string;
    messageId: string;
    fromPhone: string;
    text: string | null;
  },
): Promise<AgentTurnResult> {
  const allowed = await client.query<{ phone: string }>(
    `select phone from agent_recipients
      where tenant_id = $1 and channel_id = $2 and can_command = true`,
    [opts.tenantId, opts.channelId],
  );
  if (!allowed.rows.some((r) => phonesMatch(r.phone, opts.fromPhone))) {
    return { status: "ignored", reason: "not_whitelisted" };
  }

  const text = (opts.text || "").trim();
  if (!text) return { status: "ignored", reason: "empty" };

  const result = await resolveTurn(client, opts.tenantId, text, opts.messageId);
  const gated = gateAgentReply({
    reply: result.text,
    evidenceText: `${text}\n${result.evidence}`,
  });

  const out = await client.query<{ id: string }>(
    `insert into outbound_messages (tenant_id, channel_id, to_phone, body, state)
     values ($1,$2,$3,$4,'pending') returning id`,
    [opts.tenantId, opts.channelId, digits(opts.fromPhone), gated.text],
  );

  await enqueueJobSafe(client, {
    tenantId: opts.tenantId,
    type: "send_outbound",
    payload: { outboundId: out.rows[0].id, channelId: opts.channelId },
    dedupeKey: `send_outbound:${out.rows[0].id}`,
  });

  return { status: "replied", body: gated.text, outboundId: out.rows[0].id };
}

function fromTool(r: ToolResult): ResolvedTurn {
  if (r.ok) return { text: r.text, evidence: r.evidence };
  return { text: r.text, evidence: "" };
}

async function resolveTurn(
  client: pg.PoolClient,
  tenantId: string,
  text: string,
  messageId: string,
): Promise<ResolvedTurn> {
  const lower = text.toLowerCase();

  // Atalhos baratos (sempre, com ou sem OpenRouter)
  if (/^(hoje|agenda)\b/.test(lower) || /o que tenho/.test(lower)) {
    return fromTool(await toolToday(client, tenantId));
  }
  if (/^confirm/.test(lower) || lower === "1" || /^(sim|ok|isso|pode|confirma)$/.test(lower)) {
    return fromTool(await toolConfirmPending(client, tenantId));
  }
  if (/^(n[aã]o|desfaz|desfaz contato|erra(do)?|ignora)$/.test(lower) || /desfaz contato/.test(lower)) {
    const { rejectPendingContactProposal, undoLastAutoContactLink } = await import(
      "../contactPropose.js"
    );
    const rejected = await rejectPendingContactProposal(client, tenantId);
    if (rejected.ok) return { text: rejected.text, evidence: rejected.evidence };
    const undone = await undoLastAutoContactLink(client, tenantId);
    if (undone.ok) return { text: undone.text, evidence: undone.evidence };
    return { text: rejected.text, evidence: "" };
  }
  if (/remarca/.test(lower)) {
    return fromTool(
      await toolRescheduleTomorrow(
        client,
        tenantId,
        text.replace(/remarca(r)?|para|amanh[aã]|\+1\s*dia|compromisso/gi, " ").trim() ||
          undefined,
      ),
    );
  }
  if (/conclu|finalize/.test(lower)) {
    return fromTool(
      await toolCompleteTask(
        client,
        tenantId,
        text.replace(/conclu(i|ir)?|a tarefa|finalize/gi, " ").trim() || undefined,
      ),
    );
  }
  if (/^(busca|procur|lembra|o que combinei|hist[oó]rico)\b/.test(lower)) {
    return fromTool(
      await toolSearchHistory(
        client,
        tenantId,
        text.replace(/^(busca|procur[ae]?|lembra|o que combinei|no hist[oó]rico)\s*/i, "").trim() ||
          text,
      ),
    );
  }
  if (/^ajuda$|^help$/.test(lower)) {
    return {
      text: "Pode falar natural: o que tenho hoje, confirma (agenda ou contexto de contato), desfaz contato, remarca X, conclui Y, busca… O motor tenta vincular empresa/cliente sozinho a partir do WhatsApp.",
      evidence: "",
    };
  }

  if (!openRouterConfigured()) {
    return {
      text: "Não entendi. Digite ajuda, hoje, confirmar, remarcar ou concluir.",
      evidence: "",
    };
  }

  try {
    const { data, model, usage } = await chatJson<LlmPlan>({
      system: SYSTEM,
      user: JSON.stringify({ now: new Date().toISOString(), timezone: "America/Sao_Paulo", text }),
      temperature: 0.2,
    });
    await recordTokenUsage(client, {
      tenantId,
      messageId,
      purpose: "agent_turn",
      model,
      prompt: usage?.prompt ?? 0,
      completion: usage?.completion ?? 0,
    });

    const tool = data.tool ?? null;
    if (tool === "today") return fromTool(await toolToday(client, tenantId));
    if (tool === "confirm") return fromTool(await toolConfirmPending(client, tenantId));
    if (tool === "reschedule") {
      return fromTool(await toolRescheduleTomorrow(client, tenantId, data.hint || undefined));
    }
    if (tool === "complete") {
      return fromTool(await toolCompleteTask(client, tenantId, data.hint || undefined));
    }
    if (tool === "create_commitment" && data.title && data.startsAt) {
      return fromTool(
        await toolCreateCommitment(client, tenantId, {
          title: data.title,
          startsAt: data.startsAt,
        }),
      );
    }
    if (tool === "create_task" && data.title) {
      return fromTool(
        await toolCreateTask(client, tenantId, {
          title: data.title,
          dueOn: data.dueOn ?? null,
        }),
      );
    }
    if (tool === "search") {
      return fromTool(await toolSearchHistory(client, tenantId, data.hint || text));
    }
    const reply = (data.reply || "").trim();
    if (reply) return { text: reply, evidence: "" };
  } catch (err) {
    console.warn("[agent] LN falhou", err instanceof Error ? err.message : err);
  }

  return {
    text: "Não consegui processar agora. Tente: hoje, confirmar, ou diga o que quer anotar.",
    evidence: "",
  };
}
