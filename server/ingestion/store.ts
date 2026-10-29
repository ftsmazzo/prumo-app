import type pg from "pg";
import { attachMessageToConversation } from "../conversations.js";
import { enqueueJobSafe } from "../jobs.js";
import { shouldSkipPeerOnListen } from "../peerFilter.js";
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
      const skip = await shouldSkipPeerOnListen(client, {
        tenantId: opts.tenantId,
        peerPhone: message.contactPhone,
        pushName: message.pushName,
      });
      if (skip.skip) {
        // Mensagem fica gravada no bruto; não vira contato/fichamento (ex.: Secretaria).
        console.info("[ingest] skip peer on listen", skip.reason, message.contactPhone);
        continue;
      }
      const conv = await attachMessageToConversation(client, {
        tenantId: opts.tenantId,
        channelId: opts.channelId,
        messageId: inserted,
        peerPhone: message.contactPhone,
        pushName: message.pushName,
        direction: message.direction,
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

    // Grupo: grava sempre; extrai só se follow=true (opt-in).
    if (opts.channelKind.startsWith("listen_") && message.isGroup) {
      const group = await upsertGroup(client, {
        tenantId: opts.tenantId,
        channelId: opts.channelId,
        jid: message.remoteJid,
        name: message.pushName,
        at: message.providerTimestamp,
      });
      if (group.follow) {
        const outcome = await enqueueJobSafe(client, {
          tenantId: opts.tenantId,
          type: "extract_items",
          payload: {
            messageId: inserted,
            channelId: opts.channelId,
            groupId: group.id,
          },
          dedupeKey: `extract:${inserted}`,
        });
        if (outcome === "inserted") jobs += 1;
      }
      continue;
    }

    if (opts.channelKind.startsWith("agent_")) {
      const outcome = await enqueueJobSafe(client, {
        tenantId: opts.tenantId,
        type: "agent_turn",
        payload: {
          messageId: inserted,
          channelId: opts.channelId,
          channelKind: opts.channelKind,
        },
        dedupeKey: `agent_turn:${inserted}`,
      });
      if (outcome === "inserted") jobs += 1;
    }
  }

  return {
    received: parsed.messages.length,
    stored,
    duplicates: parsed.messages.length - stored,
    ignored: parsed.ignored.length,
    jobs,
  };
}

async function upsertGroup(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    channelId: string;
    jid: string;
    name: string | null;
    at: Date;
  },
): Promise<{ id: string; follow: boolean }> {
  const r = await client.query<{ id: string; follow: boolean }>(
    `insert into groups (tenant_id, channel_id, jid, name, last_message_at)
     values ($1,$2,$3,coalesce($4,''),$5)
     on conflict (channel_id, jid) do update
       set last_message_at = greatest(groups.last_message_at, excluded.last_message_at),
           name = case when excluded.name <> '' then excluded.name else groups.name end,
           updated_at = now()
     returning id, follow`,
    [opts.tenantId, opts.channelId, opts.jid, opts.name, opts.at.toISOString()],
  );
  return r.rows[0];
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
