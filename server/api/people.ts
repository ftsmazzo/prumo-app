import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";
import { cleanTags, isOperatorDisplayName, isOperatorPhone } from "../contacts.js";

const KIND = z.enum([
  "contact",
  "colleague",
  "unknown",
  "client",
  "vendor",
  "agent",
]);

export async function registerPeopleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/people", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select p.id, p.phone, p.name, p.kind, p.tags, p.note, p.relation,
                p.role_title, p.importance, p.vip, p.organization_id,
                p.name_source, p.created_at, p.updated_at,
                o.name as organization_name,
                (select count(*)::int from conversations c
                  where c.person_id = p.id and c.tenant_id = p.tenant_id) as conversation_count,
                (select count(*)::int from commitments c
                  where c.person_id = p.id and c.tenant_id = p.tenant_id
                    and c.status in ('planned','confirmed')) as open_commitments,
                (select count(*)::int from tasks t
                  where t.person_id = p.id and t.tenant_id = p.tenant_id
                    and t.status in ('todo','doing')) as open_tasks
           from people p
           left join organizations o on o.id = p.organization_id
          where p.tenant_id = $1
            and p.kind not in ('self', 'agent')
            and length(regexp_replace(p.phone, '\\D', '', 'g')) between 10 and 13
          order by
            case when p.vip then 0 else 1 end,
            case when p.kind = 'client' then 0 else 1 end,
            lower(coalesce(nullif(p.name,''), p.phone))
          limit 500`,
        [user.tenantId],
      );
      const items = rows.rows.filter((p) => {
        if (isOperatorPhone(String(p.phone))) return false;
        if (isOperatorDisplayName(String(p.name || "")) && String(p.name_source) !== "manual") {
          return false;
        }
        return true;
      });
      return { items };
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
        kind: KIND.optional(),
        roleTitle: z.string().max(80).optional(),
        vip: z.boolean().optional(),
        organizationId: z.string().uuid().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      if (body.data.organizationId) {
        const org = await client.query(
          `select 1 from organizations where id = $1 and tenant_id = $2`,
          [body.data.organizationId, user.tenantId],
        );
        if (!org.rows[0]) return reply.code(400).send({ error: "org_not_found" });
      }

      const tags = body.data.tags !== undefined ? cleanTags(body.data.tags) : null;
      const updated = await client.query(
        `update people set
           name = coalesce($3, name),
           name_source = case when $3 is not null then 'manual' else name_source end,
           note = coalesce($4, note),
           relation = coalesce($5, relation),
           tags = coalesce($6::text[], tags),
           kind = coalesce($7, kind),
           role_title = coalesce($8, role_title),
           vip = coalesce($9, vip),
           organization_id = case
             when $10::boolean then $11::uuid
             else organization_id
           end,
           importance = case
             when $9::boolean is true then 'critical'
             when $9::boolean is false and importance = 'critical' then 'high'
             when coalesce($7, kind) = 'client' and importance = 'normal' then 'high'
             else importance
           end,
           updated_at = now()
         where id = $1 and tenant_id = $2
         returning id, phone, name, kind, tags, note, relation,
                   role_title, importance, vip, organization_id, name_source`,
        [
          req.params.id,
          user.tenantId,
          body.data.name ?? null,
          body.data.note ?? null,
          body.data.relation ?? null,
          tags,
          body.data.kind ?? null,
          body.data.roleTitle ?? null,
          body.data.vip ?? null,
          body.data.organizationId !== undefined,
          body.data.organizationId ?? null,
        ],
      );
      if (!updated.rows[0]) return reply.code(404).send({ error: "not_found" });

      let organization_name: string | null = null;
      if (updated.rows[0].organization_id) {
        const org = await client.query<{ name: string }>(
          `select name from organizations where id = $1`,
          [updated.rows[0].organization_id],
        );
        organization_name = org.rows[0]?.name ?? null;
      }
      return { ...updated.rows[0], organization_name };
    });
  });
}
