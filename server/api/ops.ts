import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { confirmDecisionEvent } from "../apply.js";
import { requireUser, withTenant } from "../auth.js";
import { enqueueJobSafe } from "../jobs.js";

export async function registerOpsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/today", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    return withTenant(user.tenantId, async (client) => {
      // Confirmados no dia — itens needs_confirm ficam só em pendingConfirm.
      const commitments = await client.query(
        `select c.id, c.title, c.status, c.starts_at, c.ends_at, c.needs_confirm,
                c.person_id, c.conversation_id, p.name as person_name
           from commitments c
           left join people p on p.id = c.person_id
          where c.tenant_id = $1
            and c.needs_confirm = false
            and c.starts_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
                 at time zone 'America/Sao_Paulo'
            and c.starts_at < date_trunc('day', now() at time zone 'America/Sao_Paulo')
                 at time zone 'America/Sao_Paulo' + interval '1 day'
            and c.status in ('planned', 'confirmed')
          order by c.starts_at`,
        [user.tenantId],
      );
      const tasks = await client.query(
        `select t.id, t.title, t.status, t.due_on, t.needs_confirm,
                t.person_id, t.conversation_id, p.name as person_name
           from tasks t
           left join people p on p.id = t.person_id
          where t.tenant_id = $1
            and t.needs_confirm = false
            and t.status in ('todo', 'doing')
            and (t.due_on is null or t.due_on <= (now() at time zone 'America/Sao_Paulo')::date + 1)
          order by t.due_on nulls last, t.created_at`,
        [user.tenantId],
      );
      const pending = await client.query(
        `select * from (
           select c.id, c.title, c.status, c.starts_at as at, 'commitment' as kind,
                  c.person_id, c.conversation_id, p.name as person_name
             from commitments c
             left join people p on p.id = c.person_id
            where c.tenant_id = $1 and c.needs_confirm = true and c.status in ('planned', 'confirmed')
           union all
           select t.id, t.title, t.status, t.due_on::timestamptz, 'task',
                  t.person_id, t.conversation_id, p.name
             from tasks t
             left join people p on p.id = t.person_id
            where t.tenant_id = $1 and t.needs_confirm = true and t.status in ('todo', 'doing')
         ) p
         order by at nulls last
         limit 30`,
        [user.tenantId],
      );
      return {
        commitments: commitments.rows,
        tasks: tasks.rows,
        pendingConfirm: pending.rows,
      };
    });
  });

  app.get("/api/commitments", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .safeParse(req.query);
    const from = q.success && q.data.from ? q.data.from : new Date().toISOString().slice(0, 10);
    const toDate = new Date(from);
    toDate.setDate(toDate.getDate() + 14);
    const to = q.success && q.data.to ? q.data.to : toDate.toISOString().slice(0, 10);

    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select c.id, c.title, c.status, c.starts_at, c.ends_at, c.location, c.note, c.needs_confirm,
                c.person_id, c.conversation_id, p.name as person_name
           from commitments c
           left join people p on p.id = c.person_id
          where c.tenant_id = $1
            and c.starts_at >= $2::date
            and c.starts_at < ($3::date + interval '1 day')
          order by c.starts_at`,
        [user.tenantId, from, to],
      );
      return { items: rows.rows };
    });
  });

  app.patch<{ Params: { id: string } }>("/api/commitments/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        status: z.enum(["planned", "confirmed", "done", "cancelled"]).optional(),
        note: z.string().max(2000).optional(),
        needsConfirm: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const updated = await client.query(
        `update commitments set
           title = coalesce($3, title),
           starts_at = coalesce($4::timestamptz, starts_at),
           ends_at = case when $5::boolean then $6::timestamptz else ends_at end,
           status = coalesce($7, status),
           note = coalesce($8, note),
           needs_confirm = coalesce($9, needs_confirm),
           updated_at = now()
         where id = $1 and tenant_id = $2
         returning id, title, status, starts_at, ends_at, needs_confirm`,
        [
          req.params.id,
          user.tenantId,
          body.data.title ?? null,
          body.data.startsAt ?? null,
          body.data.endsAt !== undefined,
          body.data.endsAt ?? null,
          body.data.status ?? null,
          body.data.note ?? null,
          body.data.needsConfirm ?? null,
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "not_found" });
      return updated.rows[0];
    });
  });

  app.get("/api/tasks", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select t.id, t.title, t.status, t.due_on, t.note, t.needs_confirm,
                t.person_id, t.conversation_id, p.name as person_name
           from tasks t
           left join people p on p.id = t.person_id
          where t.tenant_id = $1 and t.status in ('todo', 'doing', 'done')
          order by
            case t.status when 'todo' then 0 when 'doing' then 1 else 2 end,
            t.needs_confirm desc,
            t.due_on nulls last,
            t.created_at desc
          limit 100`,
        [user.tenantId],
      );
      return { items: rows.rows };
    });
  });

  /** Descarta propostas ruins e reprocessa conversas com o motor novo. */
  app.post("/api/ops/reset-pending", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const c = await client.query(
        `update commitments set status = 'cancelled', needs_confirm = false, updated_at = now()
          where tenant_id = $1 and needs_confirm = true and status in ('planned','confirmed')
          returning id, conversation_id`,
        [user.tenantId],
      );
      const t = await client.query(
        `update tasks set status = 'cancelled', needs_confirm = false, updated_at = now()
          where tenant_id = $1 and needs_confirm = true and status in ('todo','doing')
          returning id, conversation_id`,
        [user.tenantId],
      );
      const convIds = new Set<string>();
      for (const row of [...c.rows, ...t.rows]) {
        if (row.conversation_id) convIds.add(String(row.conversation_id));
      }
      // Também reprocessa conversas recentes mesmo sem pending.
      const recent = await client.query<{ id: string }>(
        `select id from conversations where tenant_id = $1
          order by last_message_at desc limit 40`,
        [user.tenantId],
      );
      for (const r of recent.rows) convIds.add(r.id);

      let enqueued = 0;
      for (const id of convIds) {
        const outcome = await enqueueJobSafe(client, {
          tenantId: user.tenantId,
          type: "organize_and_decide",
          payload: { conversationId: id, reason: "reset_pending" },
          dedupeKey: `organize:${id}`,
          runAt: new Date(Date.now() + 2_000),
          bumpExistingRunAt: true,
        });
        if (outcome === "inserted" || outcome === "bumped") enqueued += 1;
      }
      return {
        cancelledCommitments: c.rowCount ?? c.rows.length,
        cancelledTasks: t.rowCount ?? t.rows.length,
        conversations: convIds.size,
        enqueued,
      };
    });
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        status: z.enum(["todo", "doing", "done", "cancelled"]).optional(),
        dueOn: z.string().nullable().optional(),
        note: z.string().max(2000).optional(),
        needsConfirm: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const updated = await client.query(
        `update tasks set
           title = coalesce($3, title),
           status = coalesce($4, status),
           due_on = case when $5::boolean then $6::date else due_on end,
           note = coalesce($7, note),
           needs_confirm = coalesce($8, needs_confirm),
           updated_at = now()
         where id = $1 and tenant_id = $2
         returning id, title, status, due_on, needs_confirm`,
        [
          req.params.id,
          user.tenantId,
          body.data.title ?? null,
          body.data.status ?? null,
          body.data.dueOn !== undefined,
          body.data.dueOn ?? null,
          body.data.note ?? null,
          body.data.needsConfirm ?? null,
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "not_found" });
      return updated.rows[0];
    });
  });

  app.post<{ Params: { id: string } }>("/api/decisions/:id/confirm", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const result = await confirmDecisionEvent(client, {
        tenantId: user.tenantId,
        eventId: req.params.id,
      });
      if (!result.ok) return reply.code(404).send({ error: "not_found_or_not_proposed" });
      return result;
    });
  });

  /** Métrica de token do piloto (fase 5). */
  app.get("/api/ops/tokens", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const summary = await client.query<{
        purpose: string;
        calls: string;
        prompt_tokens: string;
        completion_tokens: string;
        total_tokens: string;
      }>(
        `select purpose,
                count(*)::text as calls,
                coalesce(sum(prompt_tokens),0)::text as prompt_tokens,
                coalesce(sum(completion_tokens),0)::text as completion_tokens,
                coalesce(sum(total_tokens),0)::text as total_tokens
           from token_usage
          where tenant_id = $1
            and created_at >= now() - interval '7 days'
          group by purpose
          order by purpose`,
        [user.tenantId],
      );
      const recent = await client.query(
        `select purpose, model, prompt_tokens, completion_tokens, total_tokens, created_at
           from token_usage
          where tenant_id = $1
          order by created_at desc
          limit 20`,
        [user.tenantId],
      );
      return { last7Days: summary.rows, recent: recent.rows };
    });
  });

  /** Reescreve títulos que ainda são dump de mensagem (fase 5 — calibrar). */
  app.post("/api/ops/polish-titles", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { ensureSecretaryTitle, isMessageDump } = await import("../polish.js");
    return withTenant(user.tenantId, async (client) => {
      const commitments = await client.query<{ id: string; title: string; note: string }>(
        `select id, title, note from commitments
          where tenant_id = $1
            and (char_length(title) > 72 or title ~ '^.+:\\s')
          order by updated_at desc
          limit 200`,
        [user.tenantId],
      );
      let c = 0;
      for (const row of commitments.rows) {
        const source = row.note || row.title;
        if (!isMessageDump(row.title, source) && row.title.length <= 72) continue;
        const title = ensureSecretaryTitle(row.title, source, "commitment");
        if (title === row.title) continue;
        await client.query(
          `update commitments set title = $3, note = case when note = '' then $4 else note end, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [row.id, user.tenantId, title, row.title.slice(0, 500)],
        );
        c += 1;
      }
      const tasks = await client.query<{ id: string; title: string; note: string }>(
        `select id, title, note from tasks
          where tenant_id = $1
            and (char_length(title) > 72 or title ~ '^.+:\\s')
          order by updated_at desc
          limit 200`,
        [user.tenantId],
      );
      let t = 0;
      for (const row of tasks.rows) {
        const source = row.note || row.title;
        if (!isMessageDump(row.title, source) && row.title.length <= 72) continue;
        const title = ensureSecretaryTitle(row.title, source, "task");
        if (title === row.title) continue;
        await client.query(
          `update tasks set title = $3, note = case when note = '' then $4 else note end, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [row.id, user.tenantId, title, row.title.slice(0, 500)],
        );
        t += 1;
      }
      return { commitments: c, tasks: t };
    });
  });

  /** Reenfileira organize_and_decide em todas as conversas (piloto / após ligar LLM). */
  app.post("/api/ops/reorganize", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const convs = await client.query<{ id: string }>(
        `select id from conversations where tenant_id = $1 order by last_message_at desc limit 100`,
        [user.tenantId],
      );
      let enqueued = 0;
      for (const c of convs.rows) {
        const outcome = await enqueueJobSafe(client, {
          tenantId: user.tenantId,
          type: "organize_and_decide",
          payload: { conversationId: c.id, reason: "manual_reorganize" },
          dedupeKey: `organize:${c.id}`,
          runAt: new Date(Date.now() + 2_000),
          bumpExistingRunAt: true,
        });
        if (outcome === "inserted" || outcome === "bumped") enqueued += 1;
      }
      return { conversations: convs.rows.length, enqueued };
    });
  });
}
