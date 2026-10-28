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
}
