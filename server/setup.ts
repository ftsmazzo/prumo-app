import type { FastifyInstance } from "fastify";
import { getPool } from "./db.js";
import { secretMatches } from "./security.js";

/** Devolve o canal listen_personal se o header bater com o segredo do canal (ou bootstrap). */
export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/setup/listen-personal", async (req, reply) => {
    const secretHeader = req.headers["x-webhook-secret"];
    const secret = typeof secretHeader === "string" ? secretHeader : undefined;
    if (!secret) return reply.code(401).send({ error: "unauthorized" });

    const pool = getPool();
    const rows = await pool.query<{
      id: string;
      tenant_id: string;
      status: string;
      secret_hash: string;
    }>(
      `select id, tenant_id, status, secret_hash
         from channels
        where kind = 'listen_personal'
        order by created_at
        limit 5`,
    );

    const match = rows.rows.find((r) => secretMatches(secret, r.secret_hash));
    if (!match) return reply.code(401).send({ error: "unauthorized" });

    return {
      channelId: match.id,
      tenantId: match.tenant_id,
      status: match.status,
      webhookPath: `/webhooks/evolution/${match.id}`,
      webhookUrl: `${process.env.APP_URL ?? ""}/webhooks/evolution/${match.id}`,
    };
  });
}
