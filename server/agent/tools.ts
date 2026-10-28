import type pg from "pg";

export type ToolResult = { ok: true; text: string; evidence: string } | { ok: false; text: string };

/** Tools SQL do agente — números vêm do banco, não da LLM. */
export async function toolToday(
  client: pg.PoolClient,
  tenantId: string,
): Promise<ToolResult> {
  const commitments = await client.query<{ title: string; starts_at: Date; needs_confirm: boolean }>(
    `select title, starts_at, needs_confirm from commitments
      where tenant_id = $1
        and starts_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
        and starts_at < date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + interval '1 day'
        and status in ('planned', 'confirmed')
      order by starts_at`,
    [tenantId],
  );
  const tasks = await client.query<{ title: string; status: string; due_on: string | null }>(
    `select title, status, due_on::text from tasks
      where tenant_id = $1 and status in ('todo', 'doing')
      order by needs_confirm desc, due_on nulls last
      limit 15`,
    [tenantId],
  );

  const lines: string[] = [];
  if (commitments.rows.length === 0) lines.push("Hoje sem compromissos.");
  else {
    lines.push("Compromissos de hoje:");
    for (const c of commitments.rows) {
      const t = new Date(c.starts_at).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
      lines.push(`- ${t} ${c.title}${c.needs_confirm ? " (confirmar)" : ""}`);
    }
  }
  if (tasks.rows.length) {
    lines.push("Tarefas abertas:");
    for (const t of tasks.rows) {
      lines.push(`- ${t.title}${t.due_on ? ` · ${t.due_on}` : ""}`);
    }
  }
  const text = lines.join("\n");
  return { ok: true, text, evidence: text };
}

export async function toolRescheduleTomorrow(
  client: pg.PoolClient,
  tenantId: string,
  hint?: string,
): Promise<ToolResult> {
  const row = await client.query<{ id: string; title: string; starts_at: Date }>(
    `select id, title, starts_at from commitments
      where tenant_id = $1 and status in ('planned', 'confirmed')
        and ($2::text is null or title ilike '%' || $2 || '%')
      order by
        case when needs_confirm then 0 else 1 end,
        abs(extract(epoch from (starts_at - now())))
      limit 1`,
    [tenantId, hint?.trim() || null],
  );
  if (!row.rows[0]) return { ok: false, text: "Não achei compromisso para remarcar." };
  const cur = new Date(row.rows[0].starts_at);
  const next = new Date(cur);
  next.setDate(next.getDate() + 1);
  await client.query(
    `update commitments set starts_at = $3, updated_at = now()
      where id = $1 and tenant_id = $2`,
    [row.rows[0].id, tenantId, next.toISOString()],
  );
  const text = `Remarquei "${row.rows[0].title}" para ${next.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;
  return { ok: true, text, evidence: text };
}

export async function toolCompleteTask(
  client: pg.PoolClient,
  tenantId: string,
  hint?: string,
): Promise<ToolResult> {
  const row = await client.query<{ id: string; title: string }>(
    `select id, title from tasks
      where tenant_id = $1 and status in ('todo', 'doing')
        and ($2::text is null or title ilike '%' || $2 || '%')
      order by needs_confirm desc, created_at desc
      limit 1`,
    [tenantId, hint?.trim() || null],
  );
  if (!row.rows[0]) return { ok: false, text: "Não achei tarefa aberta para concluir." };
  await client.query(
    `update tasks set status = 'done', needs_confirm = false, updated_at = now()
      where id = $1 and tenant_id = $2`,
    [row.rows[0].id, tenantId],
  );
  const text = `Concluí a tarefa "${row.rows[0].title}".`;
  return { ok: true, text, evidence: text };
}

export async function toolConfirmPending(
  client: pg.PoolClient,
  tenantId: string,
): Promise<ToolResult> {
  const c = await client.query<{ id: string; title: string }>(
    `select id, title from commitments
      where tenant_id = $1 and needs_confirm = true and status in ('planned', 'confirmed')
      order by starts_at limit 1`,
    [tenantId],
  );
  if (c.rows[0]) {
    await client.query(
      `update commitments set needs_confirm = false, status = 'confirmed', updated_at = now()
        where id = $1 and tenant_id = $2`,
      [c.rows[0].id, tenantId],
    );
    const text = `Confirmei o compromisso "${c.rows[0].title}".`;
    return { ok: true, text, evidence: text };
  }
  const t = await client.query<{ id: string; title: string }>(
    `select id, title from tasks
      where tenant_id = $1 and needs_confirm = true and status in ('todo', 'doing')
      order by created_at limit 1`,
    [tenantId],
  );
  if (t.rows[0]) {
    await client.query(
      `update tasks set needs_confirm = false, updated_at = now()
        where id = $1 and tenant_id = $2`,
      [t.rows[0].id, tenantId],
    );
    const text = `Confirmei a tarefa "${t.rows[0].title}".`;
    return { ok: true, text, evidence: text };
  }
  return { ok: false, text: "Nada pendente para confirmar." };
}
