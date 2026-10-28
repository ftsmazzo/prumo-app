import type pg from "pg";
import type { DecisionAction } from "./decide.js";

export type AppliedDecision = {
  eventId: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  status: "applied" | "proposed" | "skipped";
};

/**
 * Aplica decisões canônicas. create/update só aqui — nunca no ingest.
 * needsConfirm=true grava decision_events (proposed); false materializa já.
 */
export async function applyDecisions(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    personId: string | null;
    messageId: string | null;
    actions: DecisionAction[];
  },
): Promise<AppliedDecision[]> {
  const out: AppliedDecision[] = [];

  for (const action of opts.actions) {
    if (action.type === "noop") {
      const ev = await insertEvent(client, {
        ...opts,
        actionType: "noop",
        entityType: null,
        entityId: null,
        rationale: action.rationale,
        payload: action,
        status: "skipped",
      });
      out.push({
        eventId: ev,
        actionType: "noop",
        entityType: null,
        entityId: null,
        status: "skipped",
      });
      continue;
    }

    const needsConfirm = "needsConfirm" in action ? action.needsConfirm : true;
    const status = needsConfirm ? "proposed" : "applied";

    if (action.type === "create_commitment") {
      let entityId: string | null = null;
      if (!needsConfirm) {
        const r = await client.query<{ id: string }>(
          `insert into commitments (
             tenant_id, person_id, conversation_id, source_message_id,
             title, starts_at, ends_at, status, needs_confirm
           ) values ($1,$2,$3,$4,$5,$6,$7,'confirmed',false)
           returning id`,
          [
            opts.tenantId,
            opts.personId,
            opts.conversationId,
            opts.messageId,
            action.title,
            action.startsAt,
            action.endsAt ?? null,
          ],
        );
        entityId = r.rows[0].id;
      }
      const ev = await insertEvent(client, {
        ...opts,
        actionType: "create_commitment",
        entityType: "commitment",
        entityId,
        rationale: action.rationale,
        payload: action,
        status,
      });
      out.push({
        eventId: ev,
        actionType: action.type,
        entityType: "commitment",
        entityId,
        status,
      });
      continue;
    }

    if (action.type === "update_commitment") {
      if (!needsConfirm) {
        await client.query(
          `update commitments set
             title = coalesce($3, title),
             starts_at = coalesce($4::timestamptz, starts_at),
             status = coalesce($5, status),
             note = coalesce($6, note),
             updated_at = now()
           where id = $1 and tenant_id = $2`,
          [
            action.commitmentId,
            opts.tenantId,
            action.patch.title ?? null,
            action.patch.startsAt ?? null,
            action.patch.status ?? null,
            action.patch.note ?? null,
          ],
        );
      }
      const ev = await insertEvent(client, {
        ...opts,
        actionType: "update_commitment",
        entityType: "commitment",
        entityId: action.commitmentId,
        rationale: action.rationale,
        payload: action,
        status,
      });
      out.push({
        eventId: ev,
        actionType: action.type,
        entityType: "commitment",
        entityId: action.commitmentId,
        status,
      });
      continue;
    }

    if (action.type === "create_task") {
      let entityId: string | null = null;
      if (!needsConfirm) {
        const r = await client.query<{ id: string }>(
          `insert into tasks (
             tenant_id, person_id, conversation_id, source_message_id,
             title, due_on, status, needs_confirm
           ) values ($1,$2,$3,$4,$5,$6::date,'todo',false)
           returning id`,
          [
            opts.tenantId,
            opts.personId,
            opts.conversationId,
            opts.messageId,
            action.title,
            action.dueOn ?? null,
          ],
        );
        entityId = r.rows[0].id;
      }
      const ev = await insertEvent(client, {
        ...opts,
        actionType: "create_task",
        entityType: "task",
        entityId,
        rationale: action.rationale,
        payload: action,
        status,
      });
      out.push({
        eventId: ev,
        actionType: action.type,
        entityType: "task",
        entityId,
        status,
      });
      continue;
    }

    if (action.type === "update_task") {
      if (!needsConfirm) {
        await client.query(
          `update tasks set
             title = coalesce($3, title),
             status = coalesce($4, status),
             due_on = coalesce($5::date, due_on),
             note = coalesce($6, note),
             updated_at = now()
           where id = $1 and tenant_id = $2`,
          [
            action.taskId,
            opts.tenantId,
            action.patch.title ?? null,
            action.patch.status ?? null,
            action.patch.dueOn ?? null,
            action.patch.note ?? null,
          ],
        );
      }
      const ev = await insertEvent(client, {
        ...opts,
        actionType: "update_task",
        entityType: "task",
        entityId: action.taskId,
        rationale: action.rationale,
        payload: action,
        status,
      });
      out.push({
        eventId: ev,
        actionType: action.type,
        entityType: "task",
        entityId: action.taskId,
        status,
      });
    }
  }

  return out;
}

async function insertEvent(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    conversationId: string;
    personId: string | null;
    messageId: string | null;
    actionType: string;
    entityType: string | null;
    entityId: string | null;
    rationale: string;
    payload: unknown;
    status: string;
  },
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into decision_events (
       tenant_id, conversation_id, person_id, message_id,
       kind, action, entity_type, entity_id, rationale, payload, status
     ) values ($1,$2,$3,$4,'decide',$5,$6,$7,$8,$9::jsonb,$10)
     returning id`,
    [
      opts.tenantId,
      opts.conversationId,
      opts.personId,
      opts.messageId,
      opts.actionType,
      opts.entityType,
      opts.entityId,
      opts.rationale.slice(0, 1000),
      JSON.stringify(opts.payload),
      opts.status,
    ],
  );
  return r.rows[0].id;
}

/** Confirma um evento proposed e materializa create/update. */
export async function confirmDecisionEvent(
  client: pg.PoolClient,
  opts: { tenantId: string; eventId: string },
): Promise<{ ok: boolean; entityId?: string }> {
  const ev = await client.query<{
    id: string;
    conversation_id: string;
    person_id: string | null;
    message_id: string | null;
    action: string;
    entity_id: string | null;
    payload: DecisionAction;
    status: string;
  }>(
    `select id, conversation_id, person_id, message_id, action, entity_id, payload, status
       from decision_events where id = $1 and tenant_id = $2 for update`,
    [opts.eventId, opts.tenantId],
  );
  if (!ev.rows[0] || ev.rows[0].status !== "proposed") return { ok: false };

  const action = ev.rows[0].payload as DecisionAction;
  let entityId = ev.rows[0].entity_id;

  if (action.type === "create_commitment") {
    const r = await client.query<{ id: string }>(
      `insert into commitments (
         tenant_id, person_id, conversation_id, source_message_id,
         title, starts_at, ends_at, status, needs_confirm
       ) values ($1,$2,$3,$4,$5,$6,$7,'confirmed',false)
       returning id`,
      [
        opts.tenantId,
        ev.rows[0].person_id,
        ev.rows[0].conversation_id,
        ev.rows[0].message_id,
        action.title,
        action.startsAt,
        action.endsAt ?? null,
      ],
    );
    entityId = r.rows[0].id;
  } else if (action.type === "update_commitment") {
    await client.query(
      `update commitments set
         title = coalesce($3, title),
         starts_at = coalesce($4::timestamptz, starts_at),
         status = coalesce($5, status),
         note = coalesce($6, note),
         updated_at = now()
       where id = $1 and tenant_id = $2`,
      [
        action.commitmentId,
        opts.tenantId,
        action.patch.title ?? null,
        action.patch.startsAt ?? null,
        action.patch.status ?? null,
        action.patch.note ?? null,
      ],
    );
    entityId = action.commitmentId;
  } else if (action.type === "create_task") {
    const r = await client.query<{ id: string }>(
      `insert into tasks (
         tenant_id, person_id, conversation_id, source_message_id,
         title, due_on, status, needs_confirm
       ) values ($1,$2,$3,$4,$5,$6::date,'todo',false)
       returning id`,
      [
        opts.tenantId,
        ev.rows[0].person_id,
        ev.rows[0].conversation_id,
        ev.rows[0].message_id,
        action.title,
        action.dueOn ?? null,
      ],
    );
    entityId = r.rows[0].id;
  } else if (action.type === "update_task") {
    await client.query(
      `update tasks set
         title = coalesce($3, title),
         status = coalesce($4, status),
         due_on = coalesce($5::date, due_on),
         note = coalesce($6, note),
         updated_at = now()
       where id = $1 and tenant_id = $2`,
      [
        action.taskId,
        opts.tenantId,
        action.patch.title ?? null,
        action.patch.status ?? null,
        action.patch.dueOn ?? null,
        action.patch.note ?? null,
      ],
    );
    entityId = action.taskId;
  }

  await client.query(
    `update decision_events
        set status = 'applied', entity_id = $2, decided_at = now()
      where id = $1`,
    [opts.eventId, entityId],
  );
  return { ok: true, entityId: entityId ?? undefined };
}
