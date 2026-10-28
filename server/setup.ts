import type { FastifyInstance } from "fastify";
import { getPool } from "./db.js";
import { secretMatches } from "./security.js";

type Kind = "listen_personal" | "agent_personal";

async function channelByKind(kind: Kind, secret: string) {
  const pool = getPool();
  const rows = await pool.query<{
    id: string;
    tenant_id: string;
    status: string;
    secret_hash: string;
    instance_name: string | null;
  }>(
    `select id, tenant_id, status, secret_hash, instance_name
       from channels
      where kind = $1
      order by created_at
      limit 5`,
    [kind],
  );
  return rows.rows.find((r) => secretMatches(secret, r.secret_hash)) ?? null;
}

function headerSecret(headers: Record<string, unknown>): string | undefined {
  const direct = headers["x-webhook-secret"];
  if (typeof direct === "string" && direct) return direct;
  return undefined;
}

/** Devolve canal se o header bater com o segredo do canal. */
export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  for (const kind of ["listen_personal", "agent_personal"] as const) {
    const path =
      kind === "listen_personal" ? "/api/setup/listen-personal" : "/api/setup/agent-personal";
    app.get(path, async (req, reply) => {
      const secret = headerSecret(req.headers as Record<string, unknown>);
      if (!secret) return reply.code(401).send({ error: "unauthorized" });
      const match = await channelByKind(kind, secret);
      if (!match) return reply.code(401).send({ error: "unauthorized" });
      const base = process.env.APP_URL ?? "";
      return {
        kind,
        channelId: match.id,
        tenantId: match.tenant_id,
        status: match.status,
        instanceName: match.instance_name,
        webhookPath: `/webhooks/evolution/${match.id}`,
        webhookUrl: `${base}/webhooks/evolution/${match.id}`,
      };
    });
  }

  app.get("/api/setup/inbox", async (req, reply) => {
    const secret = headerSecret(req.headers as Record<string, unknown>);
    if (!secret) return reply.code(401).send({ error: "unauthorized" });

    const listen = await channelByKind("listen_personal", secret);
    const agent = listen ? null : await channelByKind("agent_personal", secret);
    const channel = listen ?? agent;
    if (!channel) return reply.code(401).send({ error: "unauthorized" });

    const pool = getPool();
    const counts = await pool.query<{ n: string; status: string }>(
      `select status, count(*)::text as n from channels where tenant_id = $1 group by status`,
      [channel.tenant_id],
    );
    const messages = await pool.query<{
      id: string;
      direction: string;
      contact_phone: string;
      push_name: string | null;
      text: string | null;
      message_type: string;
      provider_timestamp: string;
      created_at: string;
    }>(
      `select id, direction, contact_phone, push_name, text, message_type,
              provider_timestamp::text, created_at::text
         from messages
        where tenant_id = $1
        order by created_at desc
        limit 10`,
      [channel.tenant_id],
    );
    const jobs = await pool.query<{ type: string; state: string; n: string }>(
      `select type, state, count(*)::text as n
         from jobs where tenant_id = $1
         group by type, state
         order by type, state`,
      [channel.tenant_id],
    );
    const total = await pool.query<{ n: string }>(
      `select count(*)::text as n from messages where tenant_id = $1`,
      [channel.tenant_id],
    );
    const conversations = await pool.query<{
      id: string;
      title: string;
      peer_phone: string;
      message_count: number;
      last_message_at: string;
      brief: string | null;
    }>(
      `select c.id, c.title, c.peer_phone, c.message_count,
              c.last_message_at::text,
              left(coalesce(b.summary, ''), 280) as brief
         from conversations c
         left join conversation_briefs b on b.conversation_id = c.id
        where c.tenant_id = $1
        order by c.last_message_at desc
        limit 10`,
      [channel.tenant_id],
    );
    const decisions = await pool.query<{
      id: string;
      action: string;
      status: string;
      rationale: string;
      created_at: string;
    }>(
      `select id, action, status, rationale, created_at::text
         from decision_events
        where tenant_id = $1
        order by created_at desc
        limit 10`,
      [channel.tenant_id],
    );
    const commitments = await pool.query<{
      id: string;
      title: string;
      status: string;
      starts_at: string;
      needs_confirm: boolean;
    }>(
      `select id, title, status, starts_at::text, needs_confirm
         from commitments where tenant_id = $1
        order by starts_at desc limit 10`,
      [channel.tenant_id],
    );
    const tasks = await pool.query<{
      id: string;
      title: string;
      status: string;
      needs_confirm: boolean;
    }>(
      `select id, title, status, needs_confirm
         from tasks where tenant_id = $1
        order by created_at desc limit 10`,
      [channel.tenant_id],
    );

    return {
      channelId: channel.id,
      channelStatus: channel.status,
      messageTotal: Number(total.rows[0]?.n ?? 0),
      channels: counts.rows,
      jobs: jobs.rows,
      latest: messages.rows,
      conversations: conversations.rows,
      decisions: decisions.rows,
      commitments: commitments.rows,
      tasks: tasks.rows,
    };
  });
}
