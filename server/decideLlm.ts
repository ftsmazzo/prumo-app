import type pg from "pg";
import { chatJson, openRouterConfigured } from "./ai/openrouter.js";
import type { DecideInput, DecisionAction } from "./decide.js";
import { recordTokenUsage } from "./tokens.js";

type LlmPayload = {
  actions?: Array<{
    type?: string;
    title?: string;
    startsAt?: string;
    endsAt?: string | null;
    dueOn?: string | null;
    commitmentId?: string;
    taskId?: string;
    status?: string;
    note?: string;
    rationale?: string;
  }>;
};

export type DecideLlmContext = {
  client: pg.PoolClient;
  tenantId: string;
  conversationId?: string | null;
  messageId?: string | null;
};

const SYSTEM = `Você é o motor operacional do Prumo (modo Pessoal).
Recebe o fichamento de UMA conversa WhatsApp e itens já abertos.
Decida ZERO ou mais ações. Preferir atualizar item aberto a criar duplicata.
Só proponha compromisso se houver horário/data claros. Só proponha tarefa se houver ação pendente clara.
Conversa social, elogio, "tudo bem", bronca familiar, sticker → actions: [].
title SEMPRE curto de secretária (ex.: "Reunião contrato", "Enviar proposta") — NUNCA cole a mensagem inteira.
Responda JSON: {"actions":[...]}
Cada action: type create_commitment|update_commitment|create_task|update_task,
title?, startsAt? (ISO), endsAt?, dueOn? (YYYY-MM-DD), commitmentId?, taskId?,
status? (planned|confirmed|done|cancelled|todo|doing), note?, rationale (curto pt-BR).
Sempre needsConfirm implícito: o sistema marca confirmar.`;

/** LLM só quando regras não acharão nada operacional. */
export async function decideWithLlm(
  input: DecideInput,
  ctx?: DecideLlmContext,
): Promise<DecisionAction[] | null> {
  if (!openRouterConfigured()) return null;

  const user = JSON.stringify({
    timezone: input.timezone,
    now: input.now.toISOString(),
    brief: input.briefSummary.slice(0, 3500),
    latest: input.latestTexts.slice(0, 8),
    openCommitments: input.openCommitments,
    openTasks: input.openTasks,
  });

  try {
    const { data, model, usage } = await chatJson<LlmPayload>({
      system: SYSTEM,
      user,
      temperature: 0.1,
    });
    if (ctx) {
      await recordTokenUsage(ctx.client, {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId ?? null,
        messageId: ctx.messageId ?? null,
        purpose: "decide_llm",
        model,
        prompt: usage?.prompt ?? 0,
        completion: usage?.completion ?? 0,
      });
    }
    return normalize(data, input);
  } catch (err) {
    console.warn("[decideLlm] falhou", err instanceof Error ? err.message : err);
    return null;
  }
}

function normalize(data: LlmPayload, input: DecideInput): DecisionAction[] {
  const out: DecisionAction[] = [];
  for (const raw of data.actions ?? []) {
    const type = raw.type;
    const rationale = (raw.rationale || "sugerido pela IA").slice(0, 400);
    if (type === "create_commitment" && raw.title && raw.startsAt) {
      const starts = Date.parse(raw.startsAt);
      if (Number.isNaN(starts)) continue;
      out.push({
        type: "create_commitment",
        title: raw.title.slice(0, 120),
        startsAt: new Date(starts).toISOString(),
        endsAt: raw.endsAt ?? new Date(starts + 60 * 60 * 1000).toISOString(),
        needsConfirm: true,
        rationale,
      });
      continue;
    }
    if (type === "update_commitment" && raw.commitmentId) {
      const open = input.openCommitments.find((c) => c.id === raw.commitmentId);
      if (!open) continue;
      out.push({
        type: "update_commitment",
        commitmentId: raw.commitmentId,
        patch: {
          title: raw.title,
          startsAt: raw.startsAt,
          status: raw.status,
          note: raw.note,
        },
        needsConfirm: true,
        rationale,
      });
      continue;
    }
    if (type === "create_task" && raw.title) {
      out.push({
        type: "create_task",
        title: raw.title.slice(0, 120),
        dueOn: raw.dueOn ?? null,
        needsConfirm: true,
        rationale,
      });
      continue;
    }
    if (type === "update_task" && raw.taskId) {
      const open = input.openTasks.find((t) => t.id === raw.taskId);
      if (!open) continue;
      out.push({
        type: "update_task",
        taskId: raw.taskId,
        patch: {
          title: raw.title,
          status: raw.status,
          dueOn: raw.dueOn,
          note: raw.note,
        },
        needsConfirm: true,
        rationale,
      });
    }
  }
  return out;
}
