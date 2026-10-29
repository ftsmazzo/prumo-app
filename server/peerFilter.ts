import type pg from "pg";
import {
  isAgentPhone,
  isOperatorPhone,
  looksLikeAgentName,
  phonesMatch,
} from "./contacts.js";

/**
 * Peer que NÃO deve virar contato/fichamento na escuta:
 * - telefone do operador
 * - telefone do canal agent_* (Secretaria)
 * - pessoa já marcada kind=agent
 */
export async function shouldSkipPeerOnListen(
  client: pg.PoolClient,
  opts: { tenantId: string; peerPhone: string; pushName?: string | null },
): Promise<{ skip: boolean; reason?: string }> {
  if (isOperatorPhone(opts.peerPhone)) {
    return { skip: true, reason: "operator_phone" };
  }
  if (isAgentPhone(opts.peerPhone)) {
    return { skip: true, reason: "agent_phone_env" };
  }
  if (looksLikeAgentName(opts.pushName)) {
    return { skip: true, reason: "agent_push_name" };
  }

  const agentChannels = await client.query<{ wa_phone: string }>(
    `select wa_phone from channels
      where tenant_id = $1 and kind like 'agent_%' and wa_phone <> ''`,
    [opts.tenantId],
  );
  for (const row of agentChannels.rows) {
    if (phonesMatch(opts.peerPhone, row.wa_phone)) {
      return { skip: true, reason: "agent_channel_wa_phone" };
    }
  }

  const existing = await client.query<{ kind: string; name: string | null }>(
    `select kind, name from people
      where tenant_id = $1
        and regexp_replace(phone, '\\D', '', 'g') like '%' || right(regexp_replace($2, '\\D', '', 'g'), 11)`,
    [opts.tenantId, opts.peerPhone],
  );
  for (const p of existing.rows) {
    if (p.kind === "agent" || p.kind === "self") {
      return { skip: true, reason: `people_kind_${p.kind}` };
    }
    if (looksLikeAgentName(p.name)) {
      return { skip: true, reason: "people_name_agent" };
    }
  }

  return { skip: false };
}
