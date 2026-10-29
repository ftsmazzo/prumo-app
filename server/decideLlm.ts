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

const SYSTEM = `Você é o motor operacional do Prumo (secretário com PODER DE DECISÃO).
Recebe: MICRO/RESUMO/ITENS do Fichador + turnos + itens abertos + contexto do contato (cliente/empresa).

Missão: quando compromisso ou tarefa estiverem EXPRESSOS e claros, PROPOR (needs_confirm).
O dono só aceita. Não fique em cima do muro quando está óbvio.

QUANDO PROPOR (criar/atualizar):
- Compromisso com data/hora claras (reunião, call, almoço) → create/update_commitment.
- Tarefa/ação que o DONO assumiu ou que o fio deixa inequívoca como pendência DELE
  ("vou subir", "me manda que eu faço", "preciso revisar", "te devolvo amanhã") → create_task.
- Contato pediu algo e o dono concordou → create_task do dono.
- Preferir atualizar item aberto do mesmo assunto a duplicar.
- title curto de secretária + nome do contato. Nunca cole mensagem.

QUANDO NÃO PROPOR (actions: []):
- Ambíguo / contato fazendo o trabalho / oferta ("se precisar") / só contexto técnico
  (ex.: "atualizei o link do repo" sem pedir nada a você).
- Papo social sem obrigação.
- Inventar tarefa "por ser cliente" — cliente importa pro aviso, não pra inventar canônico.

Direção: ownerAction só se a pendência for do dono. Sem obrigação clara → [].

JSON: {"actions":[...]}
type create_commitment|update_commitment|create_task|update_task;
title?, startsAt? ISO, endsAt?, dueOn? YYYY-MM-DD, commitmentId?, taskId?,
status?, note?, rationale (pt-BR curto), ownerAction boolean.
needsConfirm sempre implícito.`;

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
      // note já carrega Cliente · VIP · cargo · empresa quando houver.
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
