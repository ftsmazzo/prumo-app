import type pg from "pg";
import { applyDecisions } from "./apply.js";
import { decideFromEvidence } from "./decide.js";
import { refreshConversationBrief } from "./organize.js";

/**
 * Pipeline fase 2: organiza evidência da conversa → decide → propõe create|update.
 * Mensagem ≠ compromisso. Brief ≠ tarefa.
 */
export async function organizeAndDecide(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    messageId?: string | null;
    timezone?: string;
  },
): Promise<{ actions: number; proposed: number; applied: number }> {
  const brief = await refreshConversationBrief(client, {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
  });

  const conv = await client.query<{ person_id: string | null; timezone: string }>(
    `select c.person_id, coalesce(t.timezone, 'America/Sao_Paulo') as timezone
       from conversations c
       join tenants t on t.id = c.tenant_id
      where c.id = $1`,
    [opts.conversationId],
  );
  const personId = conv.rows[0]?.person_id ?? null;
  const timezone = opts.timezone ?? conv.rows[0]?.timezone ?? "America/Sao_Paulo";

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

  const actions = decideFromEvidence({
    timezone,
    now: new Date(),
    briefSummary: brief.summary,
    latestTexts: brief.openThreads,
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
  });

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
  };
}
