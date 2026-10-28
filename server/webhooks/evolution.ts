import type { FastifyInstance } from "fastify";
import { getPool } from "../db.js";
import { normalizeEvent, UPSERT_EVENT } from "../ingestion/evolution.js";
import { storeMessages } from "../ingestion/store.js";
import { secretMatches } from "../security.js";

const UNKNOWN_HASH = "0".repeat(64);

type ChannelAuth = {
  id: string;
  tenant_id: string;
  kind: string;
  secret_hash: string;
  listen_groups: boolean;
  status: string;
};

export async function registerEvolutionWebhook(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { channelId: string } }>(
    "/webhooks/evolution/:channelId",
    async (req, reply) => {
      const channelId = req.params.channelId;
      const secret = headerSecret(req.headers);

      const pool = getPool();
      const authResult = await pool.query<ChannelAuth>(
        `select id, tenant_id, kind, secret_hash, listen_groups, status
         from channels where id = $1`,
        [channelId],
      );
      const auth = authResult.rows[0];
      const expected = auth?.secret_hash ?? UNKNOWN_HASH;
      const ok = secretMatches(secret, expected);
      if (!auth || !secret || !ok) {
        req.log.warn({ channelId }, "webhook auth failed");
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (auth.status === "disabled") {
        return reply.code(403).send({ error: "channel_disabled" });
      }

      const body = req.body as Record<string, unknown>;
      const event = normalizeEvent(body?.event);
      if (event !== UPSERT_EVENT) {
        return { status: "ignored", event: event.slice(0, 64) };
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.tenant_id', $1, true)", [auth.tenant_id]);
        const result = await storeMessages(client, {
          tenantId: auth.tenant_id,
          channelId: auth.id,
          channelKind: auth.kind,
          data: body?.data,
          listenGroups: auth.listen_groups,
        });
        if (auth.status !== "active") {
          await client.query(`update channels set status = 'active' where id = $1`, [auth.id]);
        }
        await client.query("commit");
        req.log.info(
          {
            channelId,
            received: result.received,
            stored: result.stored,
            duplicates: result.duplicates,
            ignored: result.ignored,
            jobs: result.jobs,
          },
          "webhook stored",
        );
        return result;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  );
}

function headerSecret(headers: Record<string, unknown>): string | undefined {
  const direct = headers["x-webhook-secret"] ?? headers["x-hub-signature"];
  if (typeof direct === "string" && direct) return direct;
  if (Array.isArray(direct) && typeof direct[0] === "string") return direct[0];
  const apikey = headers.apikey ?? headers["x-api-key"];
  if (typeof apikey === "string" && apikey) return apikey;
  return undefined;
}
