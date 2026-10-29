import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";
import { cleanTags } from "../contacts.js";

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/organizations", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select o.id, o.name, o.note, o.tags, o.created_at, o.updated_at,
                (select count(*)::int from people p
                  where p.organization_id = o.id) as people_count
           from organizations o
          where o.tenant_id = $1
          order by lower(o.name)
          limit 200`,
        [user.tenantId],
      );
      return { items: rows.rows };
    });
  });

  app.post("/api/organizations", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        name: z.string().min(1).max(160),
        note: z.string().max(500).optional(),
        tags: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const tags = cleanTags(body.data.tags ?? []);
      const inserted = await client.query(
        `insert into organizations (tenant_id, name, note, tags)
         values ($1, $2, $3, $4::text[])
         on conflict do nothing
         returning id, name, note, tags, created_at`,
        [user.tenantId, body.data.name.trim(), body.data.note ?? "", tags],
      );
      if (inserted.rows[0]) return reply.code(201).send(inserted.rows[0]);
      const existing = await client.query(
        `select id, name, note, tags, created_at from organizations
          where tenant_id = $1 and lower(name) = lower($2)`,
        [user.tenantId, body.data.name.trim()],
      );
      return existing.rows[0] ?? reply.code(409).send({ error: "conflict" });
    });
  });

  app.patch<{ Params: { id: string } }>("/api/organizations/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        name: z.string().min(1).max(160).optional(),
        note: z.string().max(500).optional(),
        tags: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const tags = body.data.tags !== undefined ? cleanTags(body.data.tags) : null;
      const updated = await client.query(
        `update organizations set
           name = coalesce($3, name),
           note = coalesce($4, note),
           tags = coalesce($5::text[], tags),
           updated_at = now()
         where id = $1 and tenant_id = $2
         returning id, name, note, tags`,
        [
          req.params.id,
          user.tenantId,
          body.data.name ?? null,
          body.data.note ?? null,
          tags,
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "not_found" });
      return updated.rows[0];
    });
  });
}
