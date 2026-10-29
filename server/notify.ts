/**
 * Aviso ao dono no WhatsApp do agente — raríssimo e seletivo.
 *
 * Hierarquia:
 * 1. Claro → motor propõe (needs_confirm); dono só aceita.
 * 2. VIP ou Cliente + stake real, mas ambíguo → avisa bem.
 * 3. Ruído (repo atualizado) → silêncio.
 */

import type pg from "pg";
import { enqueueJobSafe } from "./jobs.js";

const MEANINGFUL_RE =
  /\b(feedback|aguard|esperando|preciso (de )?voc[eê]|voc[eê] (precisa|pode|consegue)|revis[aã]o|aprov|homolog|produ[cç][aã]o|cliente|proposta|contrato|reuni|prazo|bloque|decis[aã]o|pitch|apresent)\b/i;

const NOISE_ONLY_RE =
  /^(?=.*\b(github|repo|link|scaffold|commit|push|atualiz(ou|ado)|subiu)\b)(?!.*\b(feedback|aguard|produ[cç][aã]o|homolog|aprov|preciso|prazo|cliente|reuni)\b).+/i;

export function shouldNotifyFromBrief(opts: {
  microSummary: string;
  summary: string;
  importance: string;
  kind: string;
  vip: boolean;
  orgName: string | null;
  openOwnerActions: number;
  alreadyProposed: boolean;
}): { notify: boolean; reason: string } {
  if (opts.alreadyProposed) {
    return { notify: false, reason: "already_proposed_confirm" };
  }

  // VIP ou Cliente (org conta como cliente de empresa).
  const priority =
    opts.vip ||
    opts.kind === "client" ||
    Boolean(opts.orgName) ||
    opts.importance === "critical";
  if (!priority) return { notify: false, reason: "not_priority_contact" };

  const blob = `${opts.microSummary}\n${opts.summary}`.trim();
  if (blob.length < 24) return { notify: false, reason: "empty_brief" };

  if (NOISE_ONLY_RE.test(blob) && opts.openOwnerActions === 0) {
    return { notify: false, reason: "tech_noise" };
  }

  // VIP: stake real OU openOwnerActions. Cliente comum: mesma regra.
  if (MEANINGFUL_RE.test(blob) || opts.openOwnerActions > 0) {
    return { notify: true, reason: opts.vip ? "vip_meaningful" : "priority_meaningful" };
  }

  return { notify: false, reason: "no_owner_stake" };
}

export async function enqueueOwnerNotify(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    body: string;
  },
): Promise<{ queued: boolean; outboundId?: string }> {
  const agent = await client.query<{ id: string }>(
    `select id from channels
      where tenant_id = $1 and kind like 'agent_%' and status <> 'disabled'
      order by created_at limit 1`,
    [opts.tenantId],
  );
  if (!agent.rows[0]) return { queued: false };

  const recipients = await client.query<{ phone: string }>(
    `select phone from agent_recipients
      where tenant_id = $1 and channel_id = $2 and can_command = true`,
    [opts.tenantId, agent.rows[0].id],
  );
  if (!recipients.rows[0]) return { queued: false };

  const body = opts.body.trim().slice(0, 900);
  if (!body) return { queued: false };

  const recent = await client.query(
    `select 1 from outbound_messages
      where tenant_id = $1 and channel_id = $2
        and body = $3
        and created_at > now() - interval '6 hours'
      limit 1`,
    [opts.tenantId, agent.rows[0].id, body],
  );
  if (recent.rows[0]) return { queued: false };

  const out = await client.query<{ id: string }>(
    `insert into outbound_messages (tenant_id, channel_id, to_phone, body, state)
     values ($1,$2,$3,$4,'pending') returning id`,
    [opts.tenantId, agent.rows[0].id, recipients.rows[0].phone.replace(/\D/g, ""), body],
  );

  await enqueueJobSafe(client, {
    tenantId: opts.tenantId,
    type: "send_outbound",
    payload: { outboundId: out.rows[0].id, channelId: agent.rows[0].id },
    dedupeKey: `send_outbound:${out.rows[0].id}`,
  });

  await client.query(
    `update conversation_briefs
        set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
              'lastNotifyAt', now()::text
            ),
            updated_at = now()
      where conversation_id = $1`,
    [opts.conversationId],
  );

  return { queued: true, outboundId: out.rows[0].id };
}

export function craftNotifyBody(opts: {
  personName: string | null;
  orgName: string | null;
  roleTitle: string | null;
  vip: boolean;
  microSummary: string;
}): string {
  const who = opts.personName || "Contato";
  const marks = opts.vip ? " · VIP" : "";
  const org = opts.orgName
    ? ` · ${opts.roleTitle ? `${opts.roleTitle}, ` : ""}${opts.orgName}`
    : "";
  const micro = opts.microSummary.replace(/\s+/g, " ").trim().slice(0, 320);
  return `${who}${marks}${org}: ${micro || "movimento relevante no fio."}`;
}
