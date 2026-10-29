/**
 * Contexto de contato sai do FIO — não do formulário.
 * Regras + nomes de empresas já cadastradas fazem o trabalho pesado;
 * LLM só reforça. VIP nunca é automático.
 */

import type pg from "pg";
import { foldKey } from "./textFix.js";
import { enqueueOwnerNotify } from "./notify.js";

export type ContactHint = {
  organizationName: string | null;
  organizationId: string | null;
  roleTitle: string | null;
  markClient: boolean;
  /** Nunca auto-aplicar VIP. */
  askVip: boolean;
  confidence: "high" | "medium" | "low";
  source: "heuristic" | "llm" | "mixed";
  rationale: string;
};

export type ContactProposal = ContactHint & {
  personId: string;
  personName: string | null;
  conversationId: string;
  status: "pending" | "applied" | "rejected";
};

const ROLE_RE =
  /\b(funcion[aá]rio|dono|s[oó]cio|ceo|diretor|gerente|dev|desenvolvedor|engenheiro|contador|analista)\b/i;

const CLIENTISH_RE =
  /\b(cliente|contrato|proposta|or[cç]amento|nf-?e|nota fiscal|boleto|homolog|produ[cç][aã]o|pitch)\b/i;

export function extractContactHints(opts: {
  thread: string;
  personName: string | null;
  existingOrgs: Array<{ id: string; name: string; tags: string[] }>;
  llm?: Partial<ContactHint> | null;
}): ContactHint | null {
  const thread = opts.thread;
  if (thread.length < 40) return null;

  let organizationId: string | null = null;
  let organizationName: string | null = null;
  let confidence: ContactHint["confidence"] = "low";
  let source: ContactHint["source"] = "heuristic";
  const reasons: string[] = [];

  const foldedThread = foldKey(thread);
  for (const org of opts.existingOrgs) {
    const key = foldKey(org.name);
    if (key.length >= 4 && foldedThread.includes(key)) {
      organizationId = org.id;
      organizationName = org.name;
      confidence = "high";
      reasons.push(`empresa "${org.name}" citada no fio`);
      break;
    }
  }

  if (!organizationName && opts.llm?.organizationName) {
    const llmName = String(opts.llm.organizationName).trim().slice(0, 80);
    if (llmName.length >= 3) {
      const match = opts.existingOrgs.find((o) => foldKey(o.name) === foldKey(llmName));
      organizationId = match?.id ?? null;
      organizationName = match?.name ?? llmName;
      confidence = match ? "high" : "medium";
      source = match ? "mixed" : "llm";
      reasons.push(`IA sugeriu empresa "${organizationName}"`);
    }
  }

  const roleMatch = thread.match(ROLE_RE);
  let roleTitle =
    roleMatch?.[1]?.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") ?? null;
  if (roleTitle === "funcionario") roleTitle = "funcionário";
  if (roleTitle === "socio") roleTitle = "sócio";
  if (opts.llm?.roleTitle && !roleTitle) {
    roleTitle = String(opts.llm.roleTitle).slice(0, 40);
    source = source === "heuristic" ? "mixed" : source;
  }

  const orgIsClientTag = opts.existingOrgs.some(
    (o) => o.id === organizationId && (o.tags || []).includes("cliente"),
  );
  const markClient = Boolean(
    opts.llm?.markClient ||
      orgIsClientTag ||
      (organizationName && CLIENTISH_RE.test(thread)),
  );
  if (markClient) reasons.push("sinal comercial / org cliente");

  if (!organizationName && !roleTitle && !markClient) return null;

  return {
    organizationName,
    organizationId,
    roleTitle,
    markClient,
    askVip: false,
    confidence,
    source,
    rationale: reasons.join("; ") || "contexto do fio",
  };
}

/** Aplica na hora se org já existe e confiança alta; senão grava proposta e avisa. */
export async function resolveContactContext(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    personId: string | null;
    personName: string | null;
    thread: string;
    llmHint?: Partial<ContactHint> | null;
  },
): Promise<{ applied: boolean; proposed: boolean; message?: string }> {
  if (!opts.personId) return { applied: false, proposed: false };

  const person = await client.query<{
    kind: string;
    organization_id: string | null;
    role_title: string;
    vip: boolean;
  }>(
    `select kind, organization_id, role_title, coalesce(vip,false) as vip
       from people where id = $1 and tenant_id = $2`,
    [opts.personId, opts.tenantId],
  );
  if (!person.rows[0] || person.rows[0].kind === "agent" || person.rows[0].kind === "self") {
    return { applied: false, proposed: false };
  }

  // Já tem empresa e é cliente → nada a fazer.
  if (person.rows[0].organization_id && person.rows[0].kind === "client") {
    return { applied: false, proposed: false };
  }

  // Já tem proposta pendente neste fio → não spammar o agente.
  const existingProp = await client.query<{ status: string | null }>(
    `select payload->'contactProposal'->>'status' as status
       from conversation_briefs where conversation_id = $1`,
    [opts.conversationId],
  );
  const propStatus = existingProp.rows[0]?.status;
  if (propStatus === "pending" || propStatus === "applied") {
    return { applied: false, proposed: false };
  }

  const orgs = await client.query<{ id: string; name: string; tags: string[] }>(
    `select id, name, tags from organizations where tenant_id = $1`,
    [opts.tenantId],
  );

  const hint = extractContactHints({
    thread: opts.thread,
    personName: opts.personName,
    existingOrgs: orgs.rows,
    llm: opts.llmHint,
  });
  if (!hint) return { applied: false, proposed: false };

  // Auto: org conhecida + confiança alta + pessoa ainda sem org.
  const canAuto =
    hint.confidence === "high" &&
    Boolean(hint.organizationId) &&
    !person.rows[0].organization_id;

  if (canAuto) {
    await client.query(
      `update people set
         organization_id = coalesce($3, organization_id),
         kind = case when $4::boolean then 'client' else kind end,
         role_title = case
           when role_title = '' and $5::text is not null then $5
           else role_title
         end,
         relation = case
           when relation = '' and $5::text is not null and $6::text is not null
             then $5 || ' ' || $6
           else relation
         end,
         note = case
           when note = '' and $6::text is not null
             then left('Vínculo sugerido pelo motor: ' || coalesce($5,'') || ' · ' || $6, 500)
           else note
         end,
         updated_at = now()
       where id = $1 and tenant_id = $2`,
      [
        opts.personId,
        opts.tenantId,
        hint.organizationId,
        hint.markClient,
        hint.roleTitle,
        hint.organizationName,
      ],
    );

    await stashProposal(client, {
      conversationId: opts.conversationId,
      proposal: {
        ...hint,
        personId: opts.personId,
        personName: opts.personName,
        conversationId: opts.conversationId,
        status: "applied",
      },
    });

    const who = opts.personName || "Contato";
    const msg = [
      `Contexto — ${who}:`,
      `Vinculei a ${hint.organizationName}${hint.markClient ? " (cliente)" : ""}${hint.roleTitle ? ` · ${hint.roleTitle}` : ""}.`,
      "Se estiver errado, responda: desfaz contato.",
    ].join("\n");

    await enqueueOwnerNotify(client, {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      body: msg,
    });

    return { applied: true, proposed: false, message: msg };
  }

  // Sem org cadastrada ou confiança média → proposta pra confirmar no agente.
  if (!hint.organizationName && !hint.markClient) {
    return { applied: false, proposed: false };
  }

  await stashProposal(client, {
    conversationId: opts.conversationId,
    proposal: {
      ...hint,
      personId: opts.personId,
      personName: opts.personName,
      conversationId: opts.conversationId,
      status: "pending",
    },
  });

  const who = opts.personName || "Contato";
  const bits = [
    hint.organizationName
      ? hint.organizationId
        ? `da ${hint.organizationName}`
        : `da empresa "${hint.organizationName}" (ainda não cadastrada)`
      : null,
    hint.roleTitle ? `cargo ${hint.roleTitle}` : null,
    hint.markClient ? "cliente" : null,
  ].filter(Boolean);
  const msg = [
    `Contexto — ${who}:`,
    `Achei que é ${bits.join(" · ")}.`,
    "Responda confirmar (ou 'não' / desfaz).",
  ].join("\n");

  await enqueueOwnerNotify(client, {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    body: msg,
  });

  return { applied: false, proposed: true, message: msg };
}

async function stashProposal(
  client: pg.PoolClient,
  opts: { conversationId: string; proposal: ContactProposal },
): Promise<void> {
  await client.query(
    `update conversation_briefs
        set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
              'contactProposal', $2::jsonb
            ),
            updated_at = now()
      where conversation_id = $1`,
    [opts.conversationId, JSON.stringify(opts.proposal)],
  );
}

export async function listPendingContactProposals(
  client: pg.PoolClient,
  tenantId: string,
): Promise<ContactProposal[]> {
  const rows = await client.query<{ payload: { contactProposal?: ContactProposal } }>(
    `select b.payload
       from conversation_briefs b
      where b.tenant_id = $1
        and b.payload ? 'contactProposal'
        and coalesce(b.payload->'contactProposal'->>'status','') = 'pending'
      order by b.updated_at desc
      limit 10`,
    [tenantId],
  );
  return rows.rows
    .map((r) => r.payload.contactProposal)
    .filter((p): p is ContactProposal => Boolean(p?.personId));
}

export async function confirmPendingContactProposal(
  client: pg.PoolClient,
  tenantId: string,
): Promise<{ ok: true; text: string; evidence: string } | { ok: false; text: string }> {
  const pending = await listPendingContactProposals(client, tenantId);
  const p = pending[0];
  if (!p) return { ok: false, text: "Nenhuma proposta de contato pendente." };

  let orgId = p.organizationId;
  if (!orgId && p.organizationName) {
    const created = await client.query<{ id: string }>(
      `insert into organizations (tenant_id, name, note, tags)
       values ($1, $2, 'Criada na confirmação do motor.', '{cliente}')
       returning id`,
      [tenantId, p.organizationName],
    );
    orgId = created.rows[0]?.id ?? null;
  }

  await client.query(
    `update people set
       organization_id = coalesce($3, organization_id),
       kind = case when $4::boolean then 'client' else kind end,
       role_title = coalesce(nullif($5, ''), role_title),
       relation = case
         when $5 <> '' and $6 <> '' then $5 || ' ' || $6
         else relation
       end,
       updated_at = now()
     where id = $1 and tenant_id = $2`,
    [
      p.personId,
      tenantId,
      orgId,
      p.markClient,
      p.roleTitle || "",
      p.organizationName || "",
    ],
  );

  await client.query(
    `update conversation_briefs
        set payload = jsonb_set(
              payload,
              '{contactProposal,status}',
              '"applied"'
            ),
            updated_at = now()
      where conversation_id = $1`,
    [p.conversationId],
  );

  const who = p.personName || "Contato";
  const text = `Confirmado: ${who}${p.organizationName ? ` · ${p.organizationName}` : ""}${p.markClient ? " (cliente)" : ""}${p.roleTitle ? ` · ${p.roleTitle}` : ""}.`;
  return { ok: true, text, evidence: text };
}

export async function rejectPendingContactProposal(
  client: pg.PoolClient,
  tenantId: string,
): Promise<{ ok: true; text: string; evidence: string } | { ok: false; text: string }> {
  const pending = await listPendingContactProposals(client, tenantId);
  const p = pending[0];
  if (!p) {
    // Desfaz último auto-vínculo recente se pedido.
    return { ok: false, text: "Nada de contato pra desfazer agora." };
  }
  await client.query(
    `update conversation_briefs
        set payload = jsonb_set(payload, '{contactProposal,status}', '"rejected"'),
            updated_at = now()
      where conversation_id = $1`,
    [p.conversationId],
  );
  const text = `Ok, ignorei a proposta de contexto de ${p.personName || "contato"}.`;
  return { ok: true, text, evidence: text };
}

export async function undoLastAutoContactLink(
  client: pg.PoolClient,
  tenantId: string,
): Promise<{ ok: true; text: string; evidence: string } | { ok: false; text: string }> {
  const row = await client.query<{
    conversation_id: string;
    payload: { contactProposal?: ContactProposal };
  }>(
    `select conversation_id, payload
       from conversation_briefs
      where tenant_id = $1
        and coalesce(payload->'contactProposal'->>'status','') = 'applied'
      order by updated_at desc
      limit 1`,
    [tenantId],
  );
  const prop = row.rows[0]?.payload.contactProposal;
  if (!prop?.personId) return { ok: false, text: "Não achei vínculo recente pra desfazer." };

  await client.query(
    `update people set
       organization_id = null,
       kind = case when kind = 'client' then 'contact' else kind end,
       role_title = '',
       updated_at = now()
     where id = $1 and tenant_id = $2`,
    [prop.personId, tenantId],
  );
  await client.query(
    `update conversation_briefs
        set payload = jsonb_set(payload, '{contactProposal,status}', '"rejected"'),
            updated_at = now()
      where conversation_id = $1`,
    [row.rows[0].conversation_id],
  );
  const text = `Desfiz o vínculo de ${prop.personName || "contato"}.`;
  return { ok: true, text, evidence: text };
}
