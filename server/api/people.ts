import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";

function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9_-]+/g, "")
      .slice(0, 32);
    if (s && !out.includes(s) && out.length < 12) out.push(s);
  }
  return out;
}

export async function registerPeopleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/people", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select p.id, p.phone, p.name, p.kind, p.tags, p.note, p.relation,
                p.created_at, p.updated_at,
                (select count(*)::int from conversations c
                  where c.person_id = p.id and c.tenant_id = p.tenant_id) as conversation_count,
                (select count(*)::int from commitments c
                  where c.person_id = p.id and c.tenant_id = p.tenant_id
                    and c.status in ('planned','confirmed')) as open_commitments,
                (select count(*)::int from tasks t
                  where t.person_id = p.id and t.tenant_id = p.tenant_id
                    and t.status in ('todo','doing')) as open_tasks
           from people p
          where p.tenant_id = $1 and p.kind <> 'self'
          order by lower(coalesce(nullif(p.name,''), p.phone))
          limit 500`,
        [user.tenantId],
      );
      return { items: rows.rows };
    });
  });

  app.patch<{ Params: { id: string } }>("/api/people/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        note: z.string().max(500).optional(),
        relation: z.string().max(80).optional(),
        tags: z.array(z.string()).optional(),
        kind: z.enum(["contact", "colleague", "unknown"]).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const tags = body.data.tags !== undefined ? cleanTags(body.data.tags) : null;
      const updated = await client.query(
        `update people set
           name = coalesce($3, name),
           note = coalesce($4, note),
           relation = coalesce($5, relation),
           tags = coalesce($6::text[], tags),
           kind = coalesce($7, kind),
           updated_at = now()
         where id = $1 and tenant_id = $2
         returning id, phone, name, kind, tags, note, relation`,
        [
          req.params.id,
          user.tenantId,
          body.data.name ?? null,
          body.data.note ?? null,
          body.data.relation ?? null,
          tags,
          body.data.kind ?? null,
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "not_found" });
      return updated.rows[0];
    });
  });
}
