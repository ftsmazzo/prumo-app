import { pathToFileURL } from "node:url";
import { env } from "./config.js";
import { db, getPool } from "./db.js";
import { claimJobs, completeJob, failJob, type JobRow } from "./jobs.js";
import { migrate } from "./migrate.js";
import { sendOutbound } from "./agent/outbound.js";
import { runAgentTurn } from "./agent/turn.js";
import { organizeAndDecide } from "./organizeDecide.js";

const MAX_ATTEMPTS = 5;

export type JobHandler = (job: JobRow, client: import("pg").PoolClient) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  organize_and_decide: async (job, client) => {
    const conversationId = String(job.payload.conversationId ?? "");
    if (!conversationId) throw new Error("organize_and_decide: missing conversationId");
    const result = await organizeAndDecide(client, {
      tenantId: job.tenant_id,
      conversationId,
      messageId: job.payload.messageId ? String(job.payload.messageId) : null,
    });
    console.info("[worker] organize_and_decide", { conversationId, ...result });
  },
  extract_items: async (job, client) => {
    const messageId = String(job.payload.messageId ?? "");
    if (!messageId) throw new Error("extract_items: missing messageId");
    const msg = await client.query<{
      text: string | null;
      conversation_id: string | null;
      remote_jid: string;
      channel_id: string;
    }>(
      `select text, conversation_id, remote_jid, channel_id from messages where id = $1`,
      [messageId],
    );
    if (!msg.rows[0]) throw new Error("extract_items: message missing");
    const { persistExtractedItems } = await import("./extract.js");
    const n = await persistExtractedItems(client, {
      tenantId: job.tenant_id,
      messageId,
      conversationId: msg.rows[0].conversation_id,
      text: msg.rows[0].text,
    });
    console.info("[worker] extract_items", { messageId, n });
  },
  agent_turn: async (job, client) => {
    const messageId = String(job.payload.messageId ?? "");
    const channelId = String(job.payload.channelId ?? "");
    if (!messageId || !channelId) throw new Error("agent_turn: missing message/channel");
    const msg = await client.query<{ contact_phone: string; text: string | null }>(
      `select contact_phone, text from messages where id = $1`,
      [messageId],
    );
    if (!msg.rows[0]) throw new Error("agent_turn: message not found");
    const result = await runAgentTurn(client, {
      tenantId: job.tenant_id,
      channelId,
      messageId,
      fromPhone: msg.rows[0].contact_phone,
      text: msg.rows[0].text,
    });
    console.info("[worker] agent_turn", result);
  },
  send_outbound: async (job, client) => {
    const outboundId = String(job.payload.outboundId ?? "");
    if (!outboundId) throw new Error("send_outbound: missing outboundId");
    const result = await sendOutbound(client, {
      tenantId: job.tenant_id,
      outboundId,
    });
    console.info("[worker] send_outbound", result);
    // Com AGENT_SEND desligado, failed é esperado — não requeue.
    if (result.state === "failed" && (process.env.AGENT_SEND === "1" || process.env.AGENT_SEND === "true")) {
      throw new Error("send_outbound failed");
    }
  },
  ingest_followup: async (job) => {
    console.info("[worker] ingest_followup deprecated→organize_and_decide", job.payload);
  },
};

export async function processOnce(limit = 5): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  let claimed: JobRow[] = [];
  try {
    await client.query("begin");
    claimed = await claimJobs(client, limit);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  for (const job of claimed) {
    const jobClient = await pool.connect();
    try {
      await jobClient.query("begin");
      await jobClient.query("select set_config('app.tenant_id', $1, true)", [job.tenant_id]);
      const handler = handlers[job.type];
      if (!handler) {
        await failJob(jobClient, job.id, `unknown job type: ${job.type}`);
      } else {
        await handler(job, jobClient);
        await completeJob(jobClient, job.id);
      }
      await jobClient.query("commit");
    } catch (err) {
      await jobClient.query("rollback");
      const retry = job.attempts < MAX_ATTEMPTS ? Math.min(60, 2 ** job.attempts) : undefined;
      const failClient = await pool.connect();
      try {
        await failJob(failClient, job.id, err instanceof Error ? err.message : String(err), {
          retryInSeconds: retry,
        });
      } finally {
        failClient.release();
      }
    } finally {
      jobClient.release();
    }
  }
  return claimed.length;
}

export function startWorkerLoop(intervalMs = 2000): NodeJS.Timeout {
  console.info(`[worker] started interval=${intervalMs}ms`);
  return setInterval(() => {
    processOnce().catch((err) => console.error("[worker] tick failed", err));
  }, intervalMs);
}

async function main() {
  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  await migrate(db());
  startWorkerLoop();
}

const entry = process.argv[1];
const isMain = Boolean(entry) && import.meta.url === pathToFileURL(entry as string).href;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
