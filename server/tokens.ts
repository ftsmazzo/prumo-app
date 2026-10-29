import type pg from "pg";

export async function recordTokenUsage(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId?: string | null;
    messageId?: string | null;
    purpose: string;
    model: string;
    prompt: number;
    completion: number;
  },
): Promise<void> {
  const total = (opts.prompt || 0) + (opts.completion || 0);
  await client.query(
    `insert into token_usage (
       tenant_id, conversation_id, message_id, purpose, model,
       prompt_tokens, completion_tokens, total_tokens
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      opts.tenantId,
      opts.conversationId ?? null,
      opts.messageId ?? null,
      opts.purpose,
      opts.model,
      opts.prompt || 0,
      opts.completion || 0,
      total,
    ],
  );
}
