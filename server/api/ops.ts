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
      const commitments = await client.query(
        `select id, title, status, starts_at, ends_at, needs_confirm, person_id, conversation_id
           from commitments
          where tenant_id = $1
            and starts_at >= date_trunc('day', now())
            and starts_at < date_trunc('day', now()) + interval '1 day'
            and status in ('planned', 'confirmed')
          order by starts_at`,
        [user.tenantId],
      );
      const tasks = await client.query(
        `select id, title, status, due_on, needs_confirm, person_id, conversation_id
           from tasks
          where tenant_id = $1
            and status in ('todo', 'doing')
            and (due_on is null or due_on <= (now() at time zone 'America/Sao_Paulo')::date + 1)
          order by needs_confirm desc, due_on nulls last, created_at`,
        [user.tenantId],
      );
      const pending = await client.query(
        `select * from (
           select id, title, status, starts_at as at, 'commitment' as kind from commitments
            where tenant_id = $1 and needs_confirm = true and status in ('planned', 'confirmed')
           union all
           select id, title, status, due_on::timestamptz, 'task' from tasks
            where tenant_id = $1 and needs_confirm = true and status in ('todo', 'doing')
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
        `select id, title, status, starts_at, ends_at, location, note, needs_confirm,
                person_id, conversation_id
           from commitments
          where tenant_id = $1
            and starts_at >= $2::date
            and starts_at < ($3::date + interval '1 day')
          order by starts_at`,
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
        `select id, title, status, due_on, note, needs_confirm, person_id, conversation_id
           from tasks
          where tenant_id = $1 and status in ('todo', 'doing', 'done')
          order by
            case status when 'todo' then 0 when 'doing' then 1 else 2 end,
            needs_confirm desc,
            due_on nulls last,
            created_at desc
          limit 100`,
        [user.tenantId],
      );
      return { items: rows.rows };
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
