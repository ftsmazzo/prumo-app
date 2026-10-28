import type pg from "pg";

export type JobRow = {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/** Enfileira job; se dedupe_key já está pending/running, não duplica (ou adia run_at). */
export async function enqueueJobSafe(
  client: pg.PoolClient | { query: pg.Pool["query"] },
  opts: {
    tenantId: string;
    type: string;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
    runAt?: Date;
    /** Se já existe pending com a mesma dedupe_key, empurra run_at (debounce de conversa). */
    bumpExistingRunAt?: boolean;
  },
): Promise<"inserted" | "duplicate" | "bumped"> {
  if (opts.dedupeKey) {
    const existing = await client.query<{ id: string; state: string }>(
      `select id, state from jobs
       where tenant_id = $1 and dedupe_key = $2 and state in ('pending', 'running')
       limit 1`,
      [opts.tenantId, opts.dedupeKey],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (opts.bumpExistingRunAt && row.state === "pending" && opts.runAt) {
        await client.query(
          `update jobs
              set run_at = greatest(run_at, $2::timestamptz),
                  payload = $3::jsonb,
                  updated_at = now()
            where id = $1`,
          [row.id, opts.runAt.toISOString(), JSON.stringify(opts.payload)],
        );
        return "bumped";
      }
      return "duplicate";
    }
  }
  await client.query(
    `insert into jobs (tenant_id, type, payload, dedupe_key, run_at)
     values ($1, $2, $3::jsonb, $4, coalesce($5::timestamptz, now()))`,
    [
      opts.tenantId,
      opts.type,
      JSON.stringify(opts.payload),
      opts.dedupeKey ?? null,
      opts.runAt?.toISOString() ?? null,
    ],
  );
  return "inserted";
}

export async function claimJobs(client: pg.PoolClient, limit = 5): Promise<JobRow[]> {
  const result = await client.query<JobRow>(
    `with next as (
       select id from jobs
       where state = 'pending' and run_at <= now()
       order by run_at, id
       for update skip locked
       limit $1
     )
     update jobs j
        set state = 'running',
            attempts = j.attempts + 1,
            updated_at = now()
       from next
      where j.id = next.id
      returning j.id, j.tenant_id, j.type, j.payload, j.attempts`,
    [limit],
  );
  return result.rows;
}

export async function completeJob(client: pg.PoolClient, id: string): Promise<void> {
  await client.query(
    `update jobs set state = 'done', updated_at = now(), last_error = null where id = $1`,
    [id],
  );
}

export async function failJob(
  client: pg.PoolClient,
  id: string,
  error: string,
  opts: { retryInSeconds?: number } = {},
): Promise<void> {
  const retryInSeconds = opts.retryInSeconds;
  if (retryInSeconds && retryInSeconds > 0) {
    await client.query(
      `update jobs
          set state = 'pending',
              run_at = now() + ($2 || ' seconds')::interval,
              last_error = $3,
              updated_at = now()
        where id = $1`,
      [id, String(retryInSeconds), error.slice(0, 2000)],
    );
    return;
  }
  await client.query(
    `update jobs set state = 'failed', last_error = $2, updated_at = now() where id = $1`,
    [id, error.slice(0, 2000)],
  );
}
