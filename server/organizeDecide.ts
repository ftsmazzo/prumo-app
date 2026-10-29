import type pg from "pg";
import { applyDecisions } from "./apply.js";
import { decideFromEvidence, type DecisionAction } from "./decide.js";
import { decideWithLlm } from "./decideLlm.js";
import { refreshConversationBrief } from "./organize.js";
import { openRouterConfigured } from "./ai/openrouter.js";

/**
 * Pipeline: organiza evidência → regras conservadoras → LLM com pessoa/fio → apply.
 * Mensagem ≠ compromisso. Brief ≠ tarefa. Direção: só pendência do dono.
 */
export async function organizeAndDecide(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    messageId?: string | null;
    timezone?: string;
  },
): Promise<{ actions: number; proposed: number; applied: number; source: string }> {
  const brief = await refreshConversationBrief(client, {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    messageId: opts.messageId ?? null,
  });

  const conv = await client.query<{
    person_id: string | null;
    timezone: string;
    person_name: string | null;
    person_note: string | null;
    peer_push_name: string | null;
  }>(
    `select c.person_id, coalesce(t.timezone, 'America/Sao_Paulo') as timezone,
            p.name as person_name, p.note as person_note, c.peer_push_name
       from conversations c
       join tenants t on t.id = c.tenant_id
       left join people p on p.id = c.person_id
      where c.id = $1`,
    [opts.conversationId],
  );
  const personId = conv.rows[0]?.person_id ?? null;
  const timezone = opts.timezone ?? conv.rows[0]?.timezone ?? "America/Sao_Paulo";
  const personName =
    conv.rows[0]?.person_name?.trim() ||
    conv.rows[0]?.peer_push_name?.trim() ||
    null;

  const openCommitments = await client.query<{
    id: string;
    title: string;
    starts_at: Date;
    status: string;
  }>(
    `select id, title, starts_at, status from commitments
      where tenant_id = $1
        and conversation_id = $2
        and status in ('planned', 'confirmed')
      order by starts_at
      limit 20`,
    [opts.tenantId, opts.conversationId],
  );

  const openTasks = await client.query<{
    id: string;
    title: string;
    status: string;
    due_on: string | null;
  }>(
    `select id, title, status, due_on::text from tasks
      where tenant_id = $1
        and conversation_id = $2
        and status in ('todo', 'doing')
      order by created_at
      limit 20`,
    [opts.tenantId, opts.conversationId],
  );

  const openItemsText = brief.openItems
    .map(
      (i) =>
        `- [${i.kind}] ${i.label}${i.ownerAction ? " (ação SUA)" : " (não é ação sua)"}`,
    )
    .join("\n");

  const decideInput = {
    timezone,
    now: new Date(),
    // Fichamento LLM primeiro; turns só como evidência auxiliar (não título).
    briefSummary: [
      `MICRO: ${brief.microSummary}`,
      `RESUMO: ${brief.summary}`,
      openItemsText ? `ITENS:\n${openItemsText}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    latestTexts: brief.recentTurns.length ? brief.recentTurns : brief.openThreads,
    personName,
    personNote: conv.rows[0]?.person_note ?? null,
    openCommitments: openCommitments.rows.map((c) => ({
      id: c.id,
      title: c.title,
      startsAt: new Date(c.starts_at).toISOString(),
      status: c.status,
    })),
    openTasks: openTasks.rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueOn: t.due_on,
    })),
  };

  let actions: DecisionAction[] = decideFromEvidence(decideInput);
  let source = "rules";

  // LLM tem prioridade quando configurada — regras são fallback / horário óbvio.
  if (openRouterConfigured()) {
    const llmActions = await decideWithLlm(decideInput, {
      client,
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      messageId: opts.messageId ?? null,
    });
    if (llmActions && llmActions.length > 0) {
      actions = llmActions;
      source = "llm";
    } else if (actions.length === 1 && actions[0]?.type === "noop") {
      source = "rules";
    }
  }

  const applied = await applyDecisions(client, {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    personId,
    messageId: opts.messageId ?? null,
    actions,
  });

  return {
    actions: actions.length,
    proposed: applied.filter((a) => a.status === "proposed").length,
    applied: applied.filter((a) => a.status === "applied").length,
    source,
  };
}
