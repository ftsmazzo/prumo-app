import { pathToFileURL } from "node:url";
import { env } from "./config.js";
import { db, getPool } from "./db.js";
import { claimJobs, completeJob, failJob, type JobRow } from "./jobs.js";
import { migrate } from "./migrate.js";

const MAX_ATTEMPTS = 5;

export type JobHandler = (job: JobRow) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  ingest_followup: async (job) => {
    console.info("[worker] ingest_followup (fase 2 opera depois)", job.payload);
  },
  extract_items: async (job) => {
    console.info("[worker] extract_items (fase 4)", job.payload);
  },
  agent_turn: async (job) => {
    console.info("[worker] agent_turn (fase 3)", job.payload);
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
        await handler(job);
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
