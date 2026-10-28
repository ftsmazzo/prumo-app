import type pg from "pg";
import { attachMessageToConversation } from "../conversations.js";
import { enqueueJobSafe } from "../jobs.js";
import type { IncomingMessage } from "./evolution.js";
import { parseMessagesUpsert } from "./evolution.js";

/** Debounce: agrupa rajada de mensagens antes de organizar/decidir. */
const ORGANIZE_DEBOUNCE_MS = 8_000;

export type StoreResult = {
  received: number;
  stored: number;
  duplicates: number;
  ignored: number;
  jobs: number;
};

export async function storeMessages(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    channelId: string;
    channelKind: string;
    data: unknown;
    listenGroups: boolean;
  },
): Promise<StoreResult> {
  const parsed = parseMessagesUpsert(opts.data, { listenGroups: opts.listenGroups });
  let stored = 0;
  let jobs = 0;

  for (const { message, raw } of parsed.messages) {
    const inserted = await insertMessage(client, opts.tenantId, opts.channelId, message, raw);
    if (!inserted) continue;
    stored += 1;

    // Escuta 1:1 → ancora na conversa (evidência). Não cria compromisso aqui.
    if (opts.channelKind.startsWith("listen_") && !message.isGroup) {
      const conv = await attachMessageToConversation(client, {
        tenantId: opts.tenantId,
        channelId: opts.channelId,
        messageId: inserted,
        peerPhone: message.contactPhone,
        pushName: message.pushName,
        providerTimestamp: message.providerTimestamp,
      });
      const runAt = new Date(Date.now() + ORGANIZE_DEBOUNCE_MS);
      const outcome = await enqueueJobSafe(client, {
        tenantId: opts.tenantId,
        type: "organize_and_decide",
        payload: {
          conversationId: conv.id,
          messageId: inserted,
          channelId: opts.channelId,
        },
        dedupeKey: `organize:${conv.id}`,
        runAt,
        bumpExistingRunAt: true,
      });
      if (outcome === "inserted" || outcome === "bumped") jobs += 1;
      continue;
    }

    const jobType = jobTypeFor(opts.channelKind, message);
    if (!jobType) continue;
    const outcome = await enqueueJobSafe(client, {
      tenantId: opts.tenantId,
      type: jobType,
      payload: {
        messageId: inserted,
        channelId: opts.channelId,
        channelKind: opts.channelKind,
      },
      dedupeKey: `${jobType}:${inserted}`,
    });
    if (outcome === "inserted") jobs += 1;
  }

  return {
    received: parsed.messages.length,
    stored,
    duplicates: parsed.messages.length - stored,
    ignored: parsed.ignored.length,
    jobs,
  };
}

function jobTypeFor(channelKind: string, message: IncomingMessage): string | null {
  if (channelKind.startsWith("agent_")) return "agent_turn";
  if (channelKind.startsWith("listen_") && message.isGroup) return "extract_items";
  return null;
}

async function insertMessage(
  client: pg.PoolClient,
  tenantId: string,
  channelId: string,
  message: IncomingMessage,
  raw: Record<string, unknown>,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `insert into messages (
       tenant_id, channel_id, provider_message_id, direction, remote_jid,
       contact_phone, push_name, message_type, text, media, provider_timestamp, raw
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb)
     on conflict (channel_id, provider_message_id) do nothing
     returning id`,
    [
      tenantId,
      channelId,
      message.providerMessageId,
      message.direction,
      message.remoteJid,
      message.contactPhone,
      message.pushName,
      message.messageType,
      message.text,
      message.media ? JSON.stringify(message.media) : null,
      message.providerTimestamp.toISOString(),
      JSON.stringify(raw),
    ],
  );
  return result.rows[0]?.id ?? null;
}
