import type pg from "pg";

export type BriefUpdate = {
  summary: string;
  openThreads: string[];
  recentCount: number;
};

/**
 * Atualiza o fichamento da conversa a partir das mensagens.
 * Isso NÃO cria compromisso/tarefa — só organiza evidência para a decisão.
 */
export async function refreshConversationBrief(
  client: pg.PoolClient,
  opts: { tenantId: string; conversationId: string; limit?: number },
): Promise<BriefUpdate> {
  const limit = opts.limit ?? 40;
  const msgs = await client.query<{
    direction: string;
    push_name: string | null;
    text: string | null;
    provider_timestamp: Date;
  }>(
    `select direction, push_name, text, provider_timestamp
       from messages
      where conversation_id = $1 and text is not null and text <> ''
      order by provider_timestamp desc
      limit $2`,
    [opts.conversationId, limit],
  );

  const chronological = [...msgs.rows].reverse();
  const lines = chronological.map((m) => {
    const who = m.direction === "out" ? "eu" : m.push_name || "contato";
    const when = new Date(m.provider_timestamp).toISOString().slice(0, 16).replace("T", " ");
    return `[${when}] ${who}: ${String(m.text).replace(/\s+/g, " ").slice(0, 280)}`;
  });

  const summary =
    lines.length === 0
      ? "(sem texto ainda)"
      : lines.slice(-12).join("\n").slice(0, 4000);

  const openThreads = chronological
    .filter((m) => m.direction === "in" && m.text)
    .slice(-5)
    .map((m) => String(m.text).replace(/\s+/g, " ").slice(0, 160));

  const person = await client.query<{ person_id: string | null }>(
    `select person_id from conversations where id = $1`,
    [opts.conversationId],
  );

  await client.query(
    `insert into conversation_briefs (
       tenant_id, conversation_id, person_id, summary, open_threads, payload, version, updated_at
     ) values ($1,$2,$3,$4,$5,$6::jsonb,1,now())
     on conflict (conversation_id) do update
       set summary = excluded.summary,
           open_threads = excluded.open_threads,
           payload = excluded.payload,
           person_id = coalesce(excluded.person_id, conversation_briefs.person_id),
           version = conversation_briefs.version + 1,
           updated_at = now()`,
    [
      opts.tenantId,
      opts.conversationId,
      person.rows[0]?.person_id ?? null,
      summary,
      openThreads,
      JSON.stringify({ recentCount: chronological.length, updatedFrom: "organize" }),
    ],
  );

  return { summary, openThreads, recentCount: chronological.length };
}
