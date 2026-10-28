import type pg from "pg";

export type ConversationRow = {
  id: string;
  person_id: string | null;
  peer_phone: string;
};

/** Garante pessoa + conversa e liga a mensagem. Camada de evidência — não cria compromisso. */
export async function attachMessageToConversation(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    channelId: string;
    messageId: string;
    peerPhone: string;
    pushName: string | null;
    providerTimestamp: Date;
  },
): Promise<ConversationRow> {
  const phone = opts.peerPhone.replace(/\D/g, "") || opts.peerPhone;
  const person = await client.query<{ id: string }>(
    `insert into people (tenant_id, phone, name, kind)
     values ($1, $2, $3, 'contact')
     on conflict (tenant_id, phone) do update
       set name = coalesce(nullif(excluded.name, ''), people.name),
           updated_at = now()
     returning id`,
    [opts.tenantId, phone, opts.pushName],
  );
  const personId = person.rows[0].id;

  const title = (opts.pushName || phone).slice(0, 120);
  const conv = await client.query<ConversationRow>(
    `insert into conversations (
       tenant_id, channel_id, person_id, peer_phone, peer_push_name, title,
       last_message_at, last_message_id, message_count
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,1)
     on conflict (channel_id, peer_phone) do update
       set person_id = coalesce(conversations.person_id, excluded.person_id),
           peer_push_name = coalesce(excluded.peer_push_name, conversations.peer_push_name),
           title = case
             when excluded.peer_push_name is not null and excluded.peer_push_name <> ''
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
      opts.pushName,
      title,
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
