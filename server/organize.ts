import type pg from "pg";
import { cleanTags, suggestTagsFromText } from "./contacts.js";

export type BriefUpdate = {
  summary: string;
  microSummary: string;
  openThreads: string[];
  recentTurns: string[];
  tags: string[];
  openItems: Array<{ kind: string; label: string }>;
  recentCount: number;
};

/**
 * Fichamento: histórico bruto fica em messages; aqui vai evidência curta para decidir/agente.
 */
export async function refreshConversationBrief(
  client: pg.PoolClient,
  opts: { tenantId: string; conversationId: string; limit?: number },
): Promise<BriefUpdate> {
  const limit = opts.limit ?? 80;
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
      : lines.slice(-20).join("\n").slice(0, 5000);

  const recentTurns = chronological.slice(-12).map((m) => {
    const who = m.direction === "out" ? "eu" : "contato";
    return `${who}: ${String(m.text).replace(/\s+/g, " ").slice(0, 220)}`;
  });

  const openThreads = chronological
    .filter((m) => m.direction === "in" && m.text)
    .slice(-5)
    .map((m) => String(m.text).replace(/\s+/g, " ").slice(0, 160));

  const openItems = extractOpenItems(recentTurns);
  const microSummary = craftMicroSummary(recentTurns, openItems);
  const suggested = suggestTagsFromText([...recentTurns, summary].join("\n"));

  const person = await client.query<{ person_id: string | null; tags: string[] }>(
    `select c.person_id, c.tags from conversations c where c.id = $1`,
    [opts.conversationId],
  );
  const existingTags = person.rows[0]?.tags ?? [];
  const tags = cleanTags([...existingTags, ...suggested]);

  const payload = {
    recentCount: chronological.length,
    recentTurns,
    openItems,
    themes: openItems.map((i) => ({ label: i.label, status: "open" })),
    updatedFrom: "organize",
  };

  await client.query(
    `insert into conversation_briefs (
       tenant_id, conversation_id, person_id, summary, micro_summary, open_threads, payload, version, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,1,now())
     on conflict (conversation_id) do update
       set summary = excluded.summary,
           micro_summary = excluded.micro_summary,
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
      microSummary,
      openThreads,
      JSON.stringify(payload),
    ],
  );

  await client.query(
    `update conversations
        set micro_summary = $3,
            tags = case
              when cardinality(tags) = 0 then $4::text[]
              else (select array_agg(distinct x) from unnest(tags || $4::text[]) as x)
            end,
            updated_at = now()
      where id = $1 and tenant_id = $2`,
    [opts.conversationId, opts.tenantId, microSummary, tags],
  );

  return {
    summary,
    microSummary,
    openThreads,
    recentTurns,
    tags,
    openItems,
    recentCount: chronological.length,
  };
}

function extractOpenItems(
  turns: string[],
): Array<{ kind: string; label: string }> {
  const items: Array<{ kind: string; label: string }> = [];
  const blob = turns.join("\n");
  if (/reuni|marcar|amanh[aã].*\d|às \d|as \d/i.test(blob)) {
    items.push({ kind: "maybe_meeting", label: "possível reunião/horário" });
  }
  if (/eu:.*(manda|envia|preciso que você|me passa)/i.test(blob)) {
    items.push({ kind: "followup", label: "aguardando resposta do contato" });
  }
  if (/contato:.*(preciso|pode|envia|manda|lembra)/i.test(blob)) {
    items.push({ kind: "followup", label: "pedido do contato a você" });
  }
  if (/boleto|pix|nota fiscal|pagar/i.test(blob)) {
    items.push({ kind: "note", label: "tema financeiro citado" });
  }
  return items.slice(0, 5);
}

/** Micro-resumo: referência curta para o agente, não dump. */
function craftMicroSummary(
  turns: string[],
  openItems: Array<{ kind: string; label: string }>,
): string {
  if (turns.length === 0) return "";
  const last = turns.slice(-4);
  const head = last.map((t) => t.replace(/^(eu|contato):\s*/i, "").slice(0, 90)).join(" → ");
  const pend = openItems.length
    ? ` Pendências: ${openItems.map((i) => i.label).join("; ")}.`
    : "";
  return `${head}.${pend}`.replace(/\s+/g, " ").trim().slice(0, 320);
}
