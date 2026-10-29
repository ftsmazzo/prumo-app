import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";

export async function registerConversationsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/conversations", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select c.id, c.peer_phone, c.peer_push_name, c.title, c.last_message_at,
                c.message_count, c.person_id,
                p.name as person_name, p.tags as person_tags, p.note as person_note,
                b.summary as brief_summary, b.updated_at as brief_updated_at
           from conversations c
           left join people p on p.id = c.person_id
           left join conversation_briefs b on b.conversation_id = c.id
          where c.tenant_id = $1
          order by c.last_message_at desc
          limit 100`,
        [user.tenantId],
      );
      return {
        items: rows.rows.map((r) => ({
          ...r,
          briefPreview: String(r.brief_summary || "")
            .split("\n")
            .slice(-3)
            .join(" · ")
            .slice(0, 220),
        })),
      };
    });
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const conv = await client.query(
        `select c.id, c.peer_phone, c.peer_push_name, c.title, c.last_message_at,
                c.message_count, c.person_id,
                p.name as person_name, p.tags as person_tags, p.note as person_note,
                p.relation as person_relation
           from conversations c
           left join people p on p.id = c.person_id
          where c.id = $1 and c.tenant_id = $2`,
        [req.params.id, user.tenantId],
      );
      if (!conv.rows[0]) return reply.code(404).send({ error: "not_found" });

      const brief = await client.query(
        `select summary, open_threads, payload, version, updated_at
           from conversation_briefs where conversation_id = $1`,
        [req.params.id],
      );

      const messages = await client.query(
        `select id, direction, push_name, text, provider_timestamp, message_type
           from messages
          where conversation_id = $1 and tenant_id = $2
          order by provider_timestamp desc
          limit 60`,
        [req.params.id, user.tenantId],
      );

      const commitments = await client.query(
        `select id, title, status, starts_at, needs_confirm
           from commitments
          where conversation_id = $1 and tenant_id = $2
            and status in ('planned','confirmed')
          order by starts_at`,
        [req.params.id, user.tenantId],
      );
      const tasks = await client.query(
        `select id, title, status, due_on, needs_confirm
           from tasks
          where conversation_id = $1 and tenant_id = $2
            and status in ('todo','doing')
          order by created_at desc`,
        [req.params.id, user.tenantId],
      );

      return {
        conversation: conv.rows[0],
        brief: brief.rows[0] ?? null,
        messages: [...messages.rows].reverse(),
        commitments: commitments.rows,
        tasks: tasks.rows,
      };
    });
  });

  app.patch<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        personName: z.string().min(1).max(120).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const conv = await client.query<{ id: string; person_id: string | null }>(
        `select id, person_id from conversations where id = $1 and tenant_id = $2`,
        [req.params.id, user.tenantId],
      );
      if (!conv.rows[0]) return reply.code(404).send({ error: "not_found" });

      if (body.data.title) {
        await client.query(
          `update conversations set title = $3, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [req.params.id, user.tenantId, body.data.title],
        );
      }
      if (body.data.personName && conv.rows[0].person_id) {
        await client.query(
          `update people set name = $3, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [conv.rows[0].person_id, user.tenantId, body.data.personName],
        );
        await client.query(
          `update conversations set title = $3, peer_push_name = $3, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [req.params.id, user.tenantId, body.data.personName],
        );
      }
      return { ok: true };
    });
  });
}
