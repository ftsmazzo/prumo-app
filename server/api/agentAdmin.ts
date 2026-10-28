import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, withTenant } from "../auth.js";

export async function registerAgentAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agent/recipients", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `select r.id, r.phone, r.label, r.can_command, c.kind, c.instance_name
           from agent_recipients r
           join channels c on c.id = r.channel_id
          where r.tenant_id = $1
          order by r.created_at`,
        [user.tenantId],
      );
      return { items: rows.rows };
    });
  });

  app.post("/api/agent/recipients", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        phone: z.string().min(10).max(20),
        label: z.string().max(80).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    return withTenant(user.tenantId, async (client) => {
      const channel = await client.query<{ id: string }>(
        `select id from channels where tenant_id = $1 and kind = 'agent_personal' limit 1`,
        [user.tenantId],
      );
      if (!channel.rows[0]) return reply.code(400).send({ error: "no_agent_channel" });
      const phone = body.data.phone.replace(/\D/g, "");
      const row = await client.query(
        `insert into agent_recipients (tenant_id, channel_id, phone, can_command, label)
         values ($1,$2,$3,true,$4)
         on conflict (channel_id, phone) do update
           set can_command = true, label = excluded.label
         returning id, phone, label, can_command`,
        [user.tenantId, channel.rows[0].id, phone, body.data.label ?? ""],
      );
      return row.rows[0];
    });
  });
}
