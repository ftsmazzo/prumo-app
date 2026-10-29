import type pg from "pg";
import { cleanTags } from "./contacts.js";
import { ficharConversation } from "./fichar.js";

export type BriefUpdate = {
  summary: string;
  microSummary: string;
  openThreads: string[];
  recentTurns: string[];
  tags: string[];
  openItems: Array<{ kind: string; label: string; ownerAction?: boolean }>;
  recentCount: number;
  ficharSource: string;
  ficharError?: string;
};

/**
 * Fichamento: histórico bruto fica em messages.
 * summary/micro_summary vêm do Fichador (LLM) — nunca cola de mensagem.
 */
export async function refreshConversationBrief(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    limit?: number;
    messageId?: string | null;
  },
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

  const recentTurns = chronological.slice(-14).map((m) => {
    const who = m.direction === "out" ? "eu" : "contato";
    return `${who}: ${String(m.text).replace(/\s+/g, " ").slice(0, 220)}`;
  });

  const openThreads = chronological
    .filter((m) => m.direction === "in" && m.text)
    .slice(-5)
    .map((m) => String(m.text).replace(/\s+/g, " ").slice(0, 160));

  const meta = await client.query<{
    person_id: string | null;
    tags: string[];
    person_name: string | null;
    peer_push_name: string | null;
    prev_summary: string | null;
    prev_micro: string | null;
    person_kind: string | null;
    role_title: string | null;
    importance: string | null;
    vip: boolean | null;
    org_name: string | null;
  }>(
    `select c.person_id, c.tags, p.name as person_name, c.peer_push_name,
            b.summary as prev_summary, coalesce(c.micro_summary, b.micro_summary) as prev_micro,
            p.kind as person_kind, p.role_title, p.importance,
            coalesce(p.vip, false) as vip, o.name as org_name
       from conversations c
       left join people p on p.id = c.person_id
       left join organizations o on o.id = p.organization_id
       left join conversation_briefs b on b.conversation_id = c.id
      where c.id = $1`,
    [opts.conversationId],
  );

  if (meta.rows[0]?.person_kind === "agent" || meta.rows[0]?.person_kind === "self") {
    return {
      summary: "",
      microSummary: "",
      openThreads: [],
      recentTurns: [],
      tags: [],
      openItems: [],
      recentCount: chronological.length,
      ficharSource: "skipped_agent",
    };
  }

  const personName =
    meta.rows[0]?.person_name?.trim() || meta.rows[0]?.peer_push_name?.trim() || null;
  const contactContext = [
    personName,
    meta.rows[0]?.person_kind === "client" ? "Cliente" : null,
    meta.rows[0]?.vip ? "VIP" : null,
    meta.rows[0]?.role_title && meta.rows[0]?.org_name
      ? `${meta.rows[0].role_title} · ${meta.rows[0].org_name}`
      : meta.rows[0]?.org_name,
  ]
    .filter(Boolean)
    .join(" · ");

  const fichado = await ficharConversation(client, {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    personName: contactContext || personName,
    threadLines: lines,
    previousSummary: meta.rows[0]?.prev_summary,
    previousMicro: meta.rows[0]?.prev_micro,
    messageId: opts.messageId ?? null,
  });

  const existingTags = meta.rows[0]?.tags ?? [];
  const tags = cleanTags([...existingTags, ...fichado.tags]);

  const payload: Record<string, unknown> = {
    recentCount: chronological.length,
    recentTurns,
    openItems: fichado.openItems,
    themes: fichado.themes,
    tone: fichado.tone,
    ficharSource: fichado.source,
    ficharError: fichado.error || null,
    contactHint: fichado.contactHint,
    transcriptTail: lines.slice(-24),
    updatedFrom: "organize",
  };

  // Preserva contactProposal já aplicada/pendente (não zerar no re-fichar).
  await client.query(
    `insert into conversation_briefs (
       tenant_id, conversation_id, person_id, summary, micro_summary, open_threads, payload, version, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,1,now())
     on conflict (conversation_id) do update
       set summary = excluded.summary,
           micro_summary = excluded.micro_summary,
           open_threads = excluded.open_threads,
           payload = excluded.payload ||
             case
               when conversation_briefs.payload ? 'contactProposal'
                 then jsonb_build_object('contactProposal', conversation_briefs.payload->'contactProposal')
               else '{}'::jsonb
             end,
           person_id = coalesce(excluded.person_id, conversation_briefs.person_id),
           version = conversation_briefs.version + 1,
           updated_at = now()`,
    [
      opts.tenantId,
      opts.conversationId,
      meta.rows[0]?.person_id ?? null,
      fichado.summary,
      fichado.microSummary,
      openThreads,
      JSON.stringify(payload),
    ],
  );

  await client.query(
    `update conversations
        set micro_summary = $3,
            tags = $4::text[],
            updated_at = now()
      where id = $1 and tenant_id = $2`,
    [opts.conversationId, opts.tenantId, fichado.microSummary, tags],
  );

  // Motor de contato: vínculo/cliente a partir do fio (sem formulário).
  try {
    const { resolveContactContext } = await import("./contactPropose.js");
    const contact = await resolveContactContext(client, {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      personId: meta.rows[0]?.person_id ?? null,
      personName,
      thread: lines.join("\n"),
      llmHint: fichado.contactHint,
    });
    if (contact.applied || contact.proposed) {
      payload.contactResolution = contact;
    }
  } catch (err) {
    console.warn(
      "[organize] contactPropose falhou",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    summary: fichado.summary,
    microSummary: fichado.microSummary,
    openThreads,
    recentTurns,
    tags,
    openItems: fichado.openItems,
    recentCount: chronological.length,
    ficharSource: fichado.source,
    ficharError: fichado.error,
  };
}
