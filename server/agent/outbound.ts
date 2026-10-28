import type pg from "pg";
import { sendTextMessage } from "../evolution/send.js";

export async function sendOutbound(
  client: pg.PoolClient,
  opts: { tenantId: string; outboundId: string },
): Promise<{ state: string }> {
  const row = await client.query<{
    id: string;
    channel_id: string;
    to_phone: string;
    body: string;
    state: string;
    instance_name: string | null;
  }>(
    `select o.id, o.channel_id, o.to_phone, o.body, o.state, c.instance_name
       from outbound_messages o
       join channels c on c.id = o.channel_id
      where o.id = $1 and o.tenant_id = $2
      for update of o`,
    [opts.outboundId, opts.tenantId],
  );
  const msg = row.rows[0];
  if (!msg) return { state: "missing" };
  if (msg.state === "sent") return { state: "sent" };
  if (!msg.instance_name) {
    await client.query(
      `update outbound_messages set state = 'failed', last_error = 'no_instance', updated_at = now() where id = $1`,
      [msg.id],
    );
    return { state: "failed" };
  }

  await client.query(
    `update outbound_messages set state = 'sending', updated_at = now() where id = $1`,
    [msg.id],
  );

  const result = await sendTextMessage({
    instanceName: msg.instance_name,
    toPhone: msg.to_phone,
    text: msg.body,
  });

  if (result.ok) {
    await client.query(
      `update outbound_messages
          set state = 'sent', provider_id = $2, last_error = null, updated_at = now()
        where id = $1`,
      [msg.id, result.providerId ?? null],
    );
    return { state: "sent" };
  }

  await client.query(
    `update outbound_messages
        set state = 'failed', last_error = $2, updated_at = now()
      where id = $1`,
    [msg.id, result.error.slice(0, 500)],
  );
  return { state: "failed" };
}
