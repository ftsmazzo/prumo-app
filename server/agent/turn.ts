import type pg from "pg";
import { enqueueJobSafe } from "../jobs.js";
import { gateAgentReply } from "./gates.js";
import {
  toolCompleteTask,
  toolConfirmPending,
  toolRescheduleTomorrow,
  toolToday,
} from "./tools.js";

export type AgentTurnResult =
  | { status: "ignored"; reason: string }
  | { status: "replied"; body: string; outboundId: string };

function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  const ta = da.slice(-11);
  const tb = db.slice(-11);
  return ta === tb || da.endsWith(tb) || db.endsWith(ta);
}

/** Processa mensagem no canal agent_*: whitelist → tools SQL → gates → outbound. */
export async function runAgentTurn(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    channelId: string;
    messageId: string;
    fromPhone: string;
    text: string | null;
  },
): Promise<AgentTurnResult> {
  const allowed = await client.query<{ phone: string }>(
    `select phone from agent_recipients
      where tenant_id = $1 and channel_id = $2 and can_command = true`,
    [opts.tenantId, opts.channelId],
  );
  if (!allowed.rows.some((r) => phonesMatch(r.phone, opts.fromPhone))) {
    return { status: "ignored", reason: "not_whitelisted" };
  }

  const text = (opts.text || "").trim();
  if (!text) return { status: "ignored", reason: "empty" };

  const lower = text.toLowerCase();
  let result: { ok: boolean; text: string; evidence?: string };

  if (/^(hoje|agenda)\b/.test(lower) || /o que tenho/.test(lower)) {
    result = await toolToday(client, opts.tenantId);
  } else if (/^confirm/.test(lower) || lower === "1") {
    result = await toolConfirmPending(client, opts.tenantId);
  } else if (/remarca/.test(lower)) {
    const hint = text.replace(/remarca(r)?|para|amanh[aã]|\+1\s*dia|compromisso/gi, " ").trim();
    result = await toolRescheduleTomorrow(client, opts.tenantId, hint || undefined);
  } else if (/conclu|finalize/.test(lower)) {
    const hint = text.replace(/conclu(i|ir)?|a tarefa|finalize/gi, " ").trim();
    result = await toolCompleteTask(client, opts.tenantId, hint || undefined);
  } else if (/ajuda|help/.test(lower)) {
    result = {
      ok: true,
      text: "Comandos: hoje · confirmar · remarcar [nome] · concluir [tarefa]",
      evidence: "comandos locais",
    };
  } else {
    result = {
      ok: false,
      text: "Não entendi. Digite ajuda, hoje, confirmar, remarcar ou concluir.",
    };
  }

  const gated = gateAgentReply({
    reply: result.text,
    evidenceText: `${text}\n${result.evidence ?? result.text}`,
  });

  const out = await client.query<{ id: string }>(
    `insert into outbound_messages (tenant_id, channel_id, to_phone, body, state)
     values ($1,$2,$3,$4,'pending') returning id`,
    [opts.tenantId, opts.channelId, digits(opts.fromPhone), gated.text],
  );

  await enqueueJobSafe(client, {
    tenantId: opts.tenantId,
    type: "send_outbound",
    payload: { outboundId: out.rows[0].id, channelId: opts.channelId },
    dedupeKey: `send_outbound:${out.rows[0].id}`,
  });

  return { status: "replied", body: gated.text, outboundId: out.rows[0].id };
}
