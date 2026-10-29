import type pg from "pg";
import {
  isOperatorPhone,
  peerDisplayName,
} from "./contacts.js";

export type ConversationRow = {
  id: string;
  person_id: string | null;
  peer_phone: string;
};

/**
 * Garante pessoa + conversa e liga a mensagem.
 * Nome do contato só atualiza com pushName inbound (nunca fromMe / nome do dono).
 */
export async function attachMessageToConversation(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    channelId: string;
    messageId: string;
    peerPhone: string;
    pushName: string | null;
    direction: "in" | "out";
    providerTimestamp: Date;
  },
): Promise<ConversationRow> {
  const phone = opts.peerPhone.replace(/\D/g, "") || opts.peerPhone;
  const kind = isOperatorPhone(phone) ? "self" : "contact";
  const peerName = peerDisplayName({
    direction: opts.direction,
    pushName: opts.pushName,
  });

  const person = await client.query<{ id: string }>(
    `insert into people (tenant_id, phone, name, kind, name_source)
     values ($1, $2, $3, $4, case when $3 is null then '' else 'push' end)
     on conflict (tenant_id, phone) do update
       set name = case
             when people.name_source = 'manual' then people.name
             when excluded.name is not null and excluded.name <> ''
               and (people.name is null or people.name = '' or people.name_source = 'push')
             then excluded.name
             else people.name
           end,
           name_source = case
             when people.name_source = 'manual' then people.name_source
             when excluded.name is not null and excluded.name <> ''
               and (people.name is null or people.name = '' or people.name_source = 'push')
             then 'push'
             else people.name_source
           end,
           kind = case when excluded.kind = 'self' then 'self' else people.kind end,
           updated_at = now()
     returning id`,
    [opts.tenantId, phone, peerName, kind],
  );
  const personId = person.rows[0].id;

  const titleSeed = peerName || phone;
  const conv = await client.query<ConversationRow>(
    `insert into conversations (
       tenant_id, channel_id, person_id, peer_phone, peer_push_name, title,
       last_message_at, last_message_id, message_count
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,1)
     on conflict (channel_id, peer_phone) do update
       set person_id = coalesce(conversations.person_id, excluded.person_id),
           peer_push_name = case
             when excluded.peer_push_name is not null and excluded.peer_push_name <> ''
             then excluded.peer_push_name
             else conversations.peer_push_name
           end,
           title = case
             when excluded.peer_push_name is not null and excluded.peer_push_name <> ''
               and (conversations.title = '' or conversations.title = conversations.peer_phone
                    or conversations.title ~ '^[0-9]+$')
             then left(excluded.peer_push_name, 120)
             else conversations.title
           end,
           last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
           last_message_id = excluded.last_message_id,
           message_count = conversations.message_count + 1,
           updated_at = now()
     returning id, person_id, peer_phone`,
    [
      opts.tenantId,
      opts.channelId,
      personId,
      phone,
      peerName,
      titleSeed.slice(0, 120),
      opts.providerTimestamp.toISOString(),
      opts.messageId,
    ],
  );

  await client.query(
    `update messages
        set conversation_id = $2, person_id = $3
      where id = $1`,
    [opts.messageId, conv.rows[0].id, personId],
  );

  return conv.rows[0];
}
