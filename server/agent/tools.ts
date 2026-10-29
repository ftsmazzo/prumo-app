import type pg from "pg";
import { ensureSecretaryTitle } from "../polish.js";

export type ToolResult = { ok: true; text: string; evidence: string } | { ok: false; text: string };

/** Tools SQL do agente — números vêm do banco, não da LLM. */
export async function toolToday(
  client: pg.PoolClient,
  tenantId: string,
): Promise<ToolResult> {
  const pending = await client.query<{
    kind: string;
    title: string;
    at: Date | null;
    who: string | null;
  }>(
    `select * from (
       select 'compromisso' as kind, c.title, c.starts_at as at,
              coalesce(p.name, '') as who
         from commitments c
         left join people p on p.id = c.person_id
        where c.tenant_id = $1 and c.needs_confirm = true and c.status in ('planned', 'confirmed')
       union all
       select 'tarefa', t.title, t.due_on::timestamptz,
              coalesce(p.name, '')
         from tasks t
         left join people p on p.id = t.person_id
        where t.tenant_id = $1 and t.needs_confirm = true and t.status in ('todo', 'doing')
     ) p order by at nulls last limit 10`,
    [tenantId],
  );

  const commitments = await client.query<{ title: string; starts_at: Date; who: string | null }>(
    `select c.title, c.starts_at, coalesce(p.name, '') as who
       from commitments c
       left join people p on p.id = c.person_id
      where c.tenant_id = $1
        and c.needs_confirm = false
        and c.starts_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
        and c.starts_at < date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + interval '1 day'
        and c.status in ('planned', 'confirmed')
      order by c.starts_at`,
    [tenantId],
  );
  const tasks = await client.query<{ title: string; due_on: string | null; who: string | null }>(
    `select t.title, t.due_on::text, coalesce(p.name, '') as who
       from tasks t
       left join people p on p.id = t.person_id
      where t.tenant_id = $1
        and t.needs_confirm = false
        and t.status in ('todo', 'doing')
        and (t.due_on is null or t.due_on <= (now() at time zone 'America/Sao_Paulo')::date + 1)
      order by t.due_on nulls last
      limit 12`,
    [tenantId],
  );

  const withWho = (title: string, who: string | null) =>
    who && who.trim() && !title.toLowerCase().includes(who.trim().toLowerCase().split(/\s+/)[0]!)
      ? `${title} · ${who.trim()}`
      : title;

  const lines: string[] = [];
  if (pending.rows.length) {
    lines.push("Para confirmar:");
    for (const p of pending.rows) {
      lines.push(`- [${p.kind}] ${withWho(p.title, p.who)}`);
    }
  }
  if (commitments.rows.length === 0) {
    lines.push(pending.rows.length ? "Hoje (confirmados): nenhum." : "Hoje sem compromissos confirmados.");
  } else {
    lines.push("Hoje:");
    for (const c of commitments.rows) {
      const t = new Date(c.starts_at).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
      lines.push(`- ${t} ${withWho(c.title, c.who)}`);
    }
  }
  if (tasks.rows.length) {
    lines.push("Tarefas:");
    for (const t of tasks.rows) {
      lines.push(`- ${withWho(t.title, t.who)}${t.due_on ? ` · ${t.due_on}` : ""}`);
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
  const when = next.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const text = `Remarquei "${row.rows[0].title}" para ${when}.`;
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
  const text = `Concluí "${row.rows[0].title}".`;
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
    const text = `Confirmado: "${c.rows[0].title}".`;
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
    const text = `Confirmada a tarefa "${t.rows[0].title}".`;
    return { ok: true, text, evidence: text };
  }
  return { ok: false, text: "Nada pendente para confirmar." };
}

export async function toolCreateCommitment(
  client: pg.PoolClient,
  tenantId: string,
  opts: { title: string; startsAt: string; endsAt?: string | null },
): Promise<ToolResult> {
  const title = ensureSecretaryTitle(opts.title, opts.title, "commitment");
  const starts = Date.parse(opts.startsAt);
  if (Number.isNaN(starts)) return { ok: false, text: "Não entendi a data/hora do compromisso." };
  const endsAt = opts.endsAt ?? new Date(starts + 60 * 60 * 1000).toISOString();
  const r = await client.query<{ id: string }>(
    `insert into commitments (
       tenant_id, title, starts_at, ends_at, status, needs_confirm, note
     ) values ($1,$2,$3,$4,'planned',true,$5)
     returning id`,
    [tenantId, title, new Date(starts).toISOString(), endsAt, opts.title.slice(0, 500)],
  );
  const when = new Date(starts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const text = `Anotei a proposta "${title}" em ${when}. Responda confirmar para liberar na agenda.`;
  return { ok: true, text, evidence: `${text}\nid=${r.rows[0].id}` };
}

function parseDueOn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  return s;
}

export async function toolCreateTask(
  client: pg.PoolClient,
  tenantId: string,
  opts: { title: string; dueOn?: string | null },
): Promise<ToolResult> {
  const title = ensureSecretaryTitle(opts.title, opts.title, "task");
  const dueOn = parseDueOn(opts.dueOn);
  const r = await client.query<{ id: string }>(
    `insert into tasks (
       tenant_id, title, due_on, status, needs_confirm, note
     ) values ($1,$2,$3::date,'todo',true,$4)
     returning id`,
    [tenantId, title, dueOn, opts.title.slice(0, 500)],
  );
  const text = `Anotei a proposta "${title}"${dueOn ? ` (prazo ${dueOn})` : ""}. Responda confirmar para liberar.`;
  return { ok: true, text, evidence: `${text}\nid=${r.rows[0].id}` };
}
