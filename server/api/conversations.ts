import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";
import { cleanTags } from "../contacts.js";

export async function registerConversationsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/conversations", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const q = z
      .object({
        q: z.string().optional(),
        tag: z.string().optional(),
      })
      .safeParse(req.query);
    const search = q.success ? q.data.q?.trim() : undefined;
    const tag = q.success ? q.data.tag?.trim() : undefined;

    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select c.id, c.peer_phone, c.peer_push_name, c.title, c.last_message_at,
                c.message_count, c.person_id, c.tags, c.micro_summary,
                p.name as person_name, p.tags as person_tags, p.note as person_note,
                b.summary as brief_summary, b.micro_summary as brief_micro,
                b.payload as brief_payload, b.updated_at as brief_updated_at, b.version as brief_version
           from conversations c
           left join people p on p.id = c.person_id
           left join conversation_briefs b on b.conversation_id = c.id
          where c.tenant_id = $1
            and coalesce(p.kind, 'contact') not in ('self', 'agent')
            and ($2::text is null or $2 = ''
                 or c.title ilike '%'||$2||'%'
                 or c.peer_phone ilike '%'||$2||'%'
                 or coalesce(p.name,'') ilike '%'||$2||'%'
                 or c.micro_summary ilike '%'||$2||'%'
                 or exists (
                   select 1 from messages m
                    where m.conversation_id = c.id and m.text ilike '%'||$2||'%'
                    limit 1
                 ))
            and ($3::text is null or $3 = '' or $3 = any(c.tags))
          order by c.last_message_at desc
          limit 100`,
        [user.tenantId, search ?? null, tag ?? null],
      );
      return {
        items: rows.rows.map((r) => {
          const payload = (r.brief_payload || {}) as {
            openItems?: Array<{ kind: string; label: string }>;
          };
          return {
            id: r.id,
            peer_phone: r.peer_phone,
            peer_push_name: r.peer_push_name,
            title: r.title,
            last_message_at: r.last_message_at,
            message_count: r.message_count,
            person_id: r.person_id,
            person_name: r.person_name,
            person_tags: r.person_tags,
            person_note: r.person_note,
            tags: r.tags || [],
            micro_summary: r.micro_summary || r.brief_micro || "",
            brief_version: r.brief_version,
            open_items: payload.openItems || [],
            briefPreview: String(r.micro_summary || r.brief_micro || "")
              .slice(0, 220),
          };
        }),
      };
    });
  });

  /** Busca no histórico bruto (estilo RAG leve) — antes de :id para não capturar "search". */
  app.get("/api/conversations/search", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const q = z.object({ q: z.string().min(2).max(120) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "q_required" });

    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select m.id, m.text, m.direction, m.provider_timestamp, m.conversation_id,
                c.title, c.micro_summary, p.name as person_name
           from messages m
           join conversations c on c.id = m.conversation_id
           left join people p on p.id = c.person_id
          where m.tenant_id = $1
            and m.text ilike '%'||$2||'%'
          order by m.provider_timestamp desc
          limit 40`,
        [user.tenantId, q.data.q],
      );
      return { items: rows.rows };
    });
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const q = z.object({ before: z.string().optional(), limit: z.coerce.number().optional() }).safeParse(req.query);
    const limit = Math.min(q.success && q.data.limit ? q.data.limit : 80, 200);

    return withTenant(user.tenantId, async (client) => {
      const conv = await client.query(
        `select c.id, c.peer_phone, c.peer_push_name, c.title, c.last_message_at,
                c.message_count, c.person_id, c.tags, c.micro_summary,
                p.name as person_name, p.tags as person_tags, p.note as person_note,
                p.relation as person_relation
           from conversations c
           left join people p on p.id = c.person_id
          where c.id = $1 and c.tenant_id = $2`,
        [req.params.id, user.tenantId],
      );
      if (!conv.rows[0]) return reply.code(404).send({ error: "not_found" });

      const brief = await client.query(
        `select summary, micro_summary, open_threads, payload, version, updated_at
           from conversation_briefs where conversation_id = $1`,
        [req.params.id],
      );

      const messages = await client.query(
        `select id, direction, push_name, text, provider_timestamp, message_type
           from messages
          where conversation_id = $1 and tenant_id = $2
          order by provider_timestamp desc
          limit $3`,
        [req.params.id, user.tenantId, limit],
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
        brief: brief.rows[0]
          ? {
              ...brief.rows[0],
              openItems: (brief.rows[0].payload as { openItems?: unknown })?.openItems ?? [],
            }
          : null,
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
        tags: z.array(z.string()).optional(),
        note: z.string().max(500).optional(),
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
      if (body.data.tags) {
        await client.query(
          `update conversations set tags = $3::text[], updated_at = now()
            where id = $1 and tenant_id = $2`,
          [req.params.id, user.tenantId, cleanTags(body.data.tags)],
        );
      }
      if (body.data.personName && conv.rows[0].person_id) {
        await client.query(
          `update people set name = $3, name_source = 'manual', updated_at = now()
            where id = $1 and tenant_id = $2`,
          [conv.rows[0].person_id, user.tenantId, body.data.personName],
        );
        await client.query(
          `update conversations set title = $3, peer_push_name = $3, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [req.params.id, user.tenantId, body.data.personName],
        );
      }
      if (body.data.note !== undefined && conv.rows[0].person_id) {
        await client.query(
          `update people set note = $3, updated_at = now()
            where id = $1 and tenant_id = $2`,
          [conv.rows[0].person_id, user.tenantId, body.data.note],
        );
      }
      return { ok: true };
    });
  });

}
