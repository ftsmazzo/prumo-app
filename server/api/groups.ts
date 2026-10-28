import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";

export async function registerGroupsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/groups", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select id, jid, name, follow, interval_min, last_message_at
           from groups where tenant_id = $1
          order by follow desc, name`,
        [user.tenantId],
      );
      return { items: rows.rows };
    });
  });

  app.patch<{ Params: { id: string } }>("/api/groups/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        follow: z.boolean().optional(),
        intervalMin: z.number().int().min(5).max(1440).optional(),
        name: z.string().max(120).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const updated = await client.query(
        `update groups set
           follow = coalesce($3, follow),
           interval_min = coalesce($4, interval_min),
           name = coalesce($5, name),
           updated_at = now()
         where id = $1 and tenant_id = $2
         returning id, jid, name, follow, interval_min`,
        [
          req.params.id,
          user.tenantId,
          body.data.follow ?? null,
          body.data.intervalMin ?? null,
          body.data.name ?? null,
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "not_found" });
      return updated.rows[0];
    });
  });

  app.get("/api/search", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const q = z.object({ q: z.string().min(2).max(200) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });

    return withTenant(user.tenantId, async (client) => {
      const items = await client.query(
        `select e.id, e.kind, e.value, e.message_id, e.group_id, e.conversation_id, e.created_at,
                m.push_name, m.provider_timestamp
           from extracted_items e
           join messages m on m.id = e.message_id
          where e.tenant_id = $1 and e.value ilike '%' || $2 || '%'
          order by e.created_at desc
          limit 40`,
        [user.tenantId, q.data.q],
      );
      return { items: items.rows };
    });
  });
}
