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
    ownerAction?: boolean;
  }>;
};

export type DecideLlmContext = {
  client: pg.PoolClient;
  tenantId: string;
  conversationId?: string | null;
  messageId?: string | null;
};

const SYSTEM = `Você é o motor operacional do Prumo (modo Pessoal — secretário do DONO).
Recebe: MICRO/RESUMO/ITENS do Fichador (já interpretados) + turnos recentes + itens abertos.

Decida ZERO ou mais ações. Preferir atualizar/cancelar a criar. Preferir actions: [] a inventar.

REGRAS DE DIREÇÃO (críticas):
- Só crie tarefa se ITENS marcar "ação SUA" OU o fio deixar claro que o dono aceitou fazer algo.
- Se o contato assume ("vou fazer", "estou montando") ou o dono só ficou à disposição → NÃO crie tarefa.
- Oferta condicional ("se precisar faço") ≠ tarefa.
- Se a última fala do dono corrige proposta anterior → update status cancelled.
- Compromisso só com data/hora claras; title SEMPRE com o nome do contato.
- title curto de secretária — NUNCA cole mensagem nem micro-resumo inteiro.
- Sem obrigação clara do dono → actions: [].

Responda JSON: {"actions":[...]}
Cada action: type create_commitment|update_commitment|create_task|update_task,
title?, startsAt? (ISO), endsAt?, dueOn? (YYYY-MM-DD), commitmentId?, taskId?,
status? (planned|confirmed|done|cancelled|todo|doing), note?, rationale (curto pt-BR),
ownerAction (true só se a pendência for do dono).
Sempre needsConfirm implícito.`;

/** LLM com contexto de pessoa + fio bilateral. */
export async function decideWithLlm(
  input: DecideInput,
  ctx?: DecideLlmContext,
): Promise<DecisionAction[] | null> {
  if (!openRouterConfigured()) return null;

  const user = JSON.stringify({
    timezone: input.timezone,
    now: input.now.toISOString(),
    contact: {
      name: input.personName,
      note: input.personNote,
    },
    // micro-resumo + fichamento; o fio bruto completo fica no SQL (busca sob demanda).
    brief: input.briefSummary.slice(0, 4500),
    turns: input.latestTexts.slice(-12),
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
  const who = input.personName?.trim();
  for (const raw of data.actions ?? []) {
    const type = raw.type;
    const rationale = (raw.rationale || "sugerido pela IA").slice(0, 400);
    if (type === "create_commitment" && raw.title && raw.startsAt) {
      const starts = Date.parse(raw.startsAt);
      if (Number.isNaN(starts)) continue;
      let title = raw.title.slice(0, 120);
      if (who && !title.toLowerCase().includes(who.toLowerCase().split(/\s+/)[0]!)) {
        title = `${title} com ${who}`.slice(0, 120);
      }
      out.push({
        type: "create_commitment",
        title,
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
      // Recusa tarefa se a IA marcar que não é ação do dono.
      if (raw.ownerAction === false) continue;
      let title = raw.title.slice(0, 120);
      if (who && !/aguard/i.test(title) && !title.toLowerCase().includes(who.toLowerCase().split(/\s+/)[0]!)) {
        title = `${title} (${who})`.slice(0, 120);
      }
      out.push({
        type: "create_task",
        title,
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
