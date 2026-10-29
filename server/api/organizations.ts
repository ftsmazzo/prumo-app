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
      const { foldKey, repairMojibake } = await import("../textFix.js");
      const name = repairMojibake(body.data.name.trim());
      const note = repairMojibake(body.data.note ?? "");
      const tags = cleanTags(body.data.tags ?? []);
      const key = foldKey(name);

      const all = await client.query<{ id: string; name: string; note: string; tags: string[] }>(
        `select id, name, note, tags from organizations where tenant_id = $1`,
        [user.tenantId],
      );
      const hit = all.rows.find((o) => foldKey(repairMojibake(o.name)) === key);
      if (hit) {
        return {
          id: hit.id,
          name: hit.name,
          note: hit.note,
          tags: hit.tags,
          existing: true,
        };
      }

      const inserted = await client.query(
        `insert into organizations (tenant_id, name, note, tags)
         values ($1, $2, $3, $4::text[])
         returning id, name, note, tags, created_at`,
        [user.tenantId, name, note, tags],
      );
      return reply.code(201).send(inserted.rows[0]);
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
