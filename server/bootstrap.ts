import type { Db } from "./db.js";
import { hashPassword } from "./passwords.js";
import { hashSecret } from "./security.js";

type ChannelKind = "listen_personal" | "agent_personal";

async function ensureTenant(database: Db): Promise<string> {
  const slug = process.env.BOOTSTRAP_SLUG || "pessoal";
  const name = process.env.BOOTSTRAP_NAME || "Prumo Pessoal";
  let tenant = (
    await database.query<{ id: string }>(`select id from tenants where slug = $1`, [slug])
  ).rows[0];
  if (!tenant) {
    tenant = (
      await database.query<{ id: string }>(
        `insert into tenants (name, slug, mode_personal, mode_office)
         values ($1, $2, true, false) returning id`,
        [name, slug],
      )
    ).rows[0];
  }
  return tenant.id;
}

async function ensureChannel(
  database: Db,
  opts: {
    tenantId: string;
    kind: ChannelKind;
    name: string;
    secret: string;
    instanceName: string | null;
  },
): Promise<string> {
  const existing = await database.query<{ id: string }>(
    `select id from channels where tenant_id = $1 and kind = $2 limit 1`,
    [opts.tenantId, opts.kind],
  );
  if (existing.rows[0]) {
    if (opts.instanceName) {
      await database.query(
        `update channels set instance_name = coalesce(instance_name, $2) where id = $1`,
        [existing.rows[0].id, opts.instanceName],
      );
    }
    return existing.rows[0].id;
  }
  const channel = (
    await database.query<{ id: string }>(
      `insert into channels (tenant_id, kind, name, instance_name, secret_hash, status, listen_groups)
       values ($1, $2, $3, $4, $5, 'pending', false)
       returning id`,
      [opts.tenantId, opts.kind, opts.name, opts.instanceName, hashSecret(opts.secret)],
    )
  ).rows[0];
  console.info(`[bootstrap] ${opts.kind} channel=${channel.id}`);
  return channel.id;
}

/** Garante tenant + canais listen_personal e agent_personal quando os secrets existem. */
export async function bootstrapPersonalChannel(database: Db): Promise<void> {
  const listenSecret = process.env.BOOTSTRAP_WEBHOOK_SECRET;
  const agentSecret = process.env.BOOTSTRAP_AGENT_WEBHOOK_SECRET;
  if (!listenSecret && !agentSecret) return;

  const tenantId = await ensureTenant(database);

  if (listenSecret) {
    await ensureChannel(database, {
      tenantId,
      kind: "listen_personal",
      name: "WhatsApp pessoal (escuta)",
      secret: listenSecret,
      instanceName: process.env.BOOTSTRAP_INSTANCE || "prumo-listen",
    });
  }

  if (agentSecret) {
    await ensureChannel(database, {
      tenantId,
      kind: "agent_personal",
      name: "Agente pessoal",
      secret: agentSecret,
      instanceName: process.env.BOOTSTRAP_AGENT_INSTANCE || "prumo-agent",
    });
  }

  await ensureOwner(database, tenantId);
  await ensureAgentWhitelist(database, tenantId);
}

async function ensureAgentWhitelist(database: Db, tenantId: string): Promise<void> {
  const phone = process.env.BOOTSTRAP_OWNER_PHONE?.replace(/\D/g, "");
  if (!phone) return;
  const channel = await database.query<{ id: string }>(
    `select id from channels where tenant_id = $1 and kind = 'agent_personal' limit 1`,
    [tenantId],
  );
  if (!channel.rows[0]) return;
  await database.query(
    `insert into agent_recipients (tenant_id, channel_id, phone, can_command, label)
     values ($1,$2,$3,true,'dono')
     on conflict (channel_id, phone) do nothing`,
    [tenantId, channel.rows[0].id, phone],
  );
}

async function ensureOwner(database: Db, tenantId: string): Promise<void> {
  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn("[bootstrap] BOOTSTRAP_OWNER_PASSWORD too short — skip owner");
    return;
  }
  const existing = await database.query(
    `select id from users where tenant_id = $1 and lower(email) = lower($2)`,
    [tenantId, email],
  );
  if (existing.rows[0]) return;
  await database.query(
    `insert into users (tenant_id, email, password_hash, name, role)
     values ($1, $2, $3, $4, 'owner')`,
    [tenantId, email.toLowerCase(), hashPassword(password), process.env.BOOTSTRAP_OWNER_NAME || "Dono"],
  );
  console.info(`[bootstrap] owner user=${email.toLowerCase()}`);
}
