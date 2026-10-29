import type { Db } from "./db.js";
import { canonicalPhone } from "./contacts.js";
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
  const waPhone =
    opts.kind === "agent_personal"
      ? canonicalPhone(process.env.BOOTSTRAP_AGENT_PHONE || process.env.AGENT_PHONE || "")
      : canonicalPhone(process.env.BOOTSTRAP_LISTEN_PHONE || "");

  if (existing.rows[0]) {
    if (opts.instanceName) {
      await database.query(
        `update channels set instance_name = coalesce(instance_name, $2) where id = $1`,
        [existing.rows[0].id, opts.instanceName],
      );
    }
    if (waPhone) {
      await database.query(`update channels set wa_phone = $2 where id = $1 and wa_phone = ''`, [
        existing.rows[0].id,
        waPhone,
      ]);
    }
    return existing.rows[0].id;
  }
  const channel = (
    await database.query<{ id: string }>(
      `insert into channels (tenant_id, kind, name, instance_name, secret_hash, status, listen_groups, wa_phone)
       values ($1, $2, $3, $4, $5, 'pending', false, $6)
       returning id`,
      [
        opts.tenantId,
        opts.kind,
        opts.name,
        opts.instanceName,
        hashSecret(opts.secret),
        waPhone,
      ],
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
  await ensurePilotClientSeed(database, tenantId);
}

/** Piloto Ecommtábil: empresa + vínculos (Junior funcionário, Eliezer dono). */
async function ensurePilotClientSeed(database: Db, tenantId: string): Promise<void> {
  if (process.env.BOOTSTRAP_SEED_ECOMM === "0") return;

  const org = await database.query<{ id: string }>(
    `insert into organizations (tenant_id, name, note, tags)
     values ($1, 'Ecommtábil', 'Cliente piloto — apresentar o Prumo ao Eliezer.', '{cliente,piloto}')
     on conflict do nothing
     returning id`,
    [tenantId],
  );
  let orgId = org.rows[0]?.id;
  if (!orgId) {
    orgId = (
      await database.query<{ id: string }>(
        `select id from organizations where tenant_id = $1 and lower(name) = lower('Ecommtábil')`,
        [tenantId],
      )
    ).rows[0]?.id;
  }
  if (!orgId) return;

  // Liga contatos já existentes pelo nome (telefone vem da escuta).
  await database.query(
    `update people set
       organization_id = $2,
       kind = case when kind in ('self','agent') then kind else 'client' end,
       vip = case
         when lower(coalesce(name,'')) like '%eliezer%' then true
         else vip
       end,
       role_title = case
         when lower(coalesce(name,'')) like '%eliezer%' then 'dono'
         when lower(coalesce(name,'')) like '%junior%' then 'funcionário'
         else coalesce(nullif(role_title,''), 'contato')
       end,
       importance = case
         when lower(coalesce(name,'')) like '%eliezer%' then 'critical'
         when lower(coalesce(name,'')) like '%junior%' then 'high'
         else importance
       end,
       relation = case
         when lower(coalesce(name,'')) like '%eliezer%' then 'dono Ecommtábil'
         when lower(coalesce(name,'')) like '%junior%' then 'funcionário Ecommtábil'
         else relation
       end,
       note = case
         when note <> '' then note
         when lower(coalesce(name,'')) like '%eliezer%' then 'Dono da Ecommtábil — pitch do Prumo.'
         when lower(coalesce(name,'')) like '%junior%' then 'Funcionário Ecommtábil · projeto ecommFlow.'
         else note
       end,
       updated_at = now()
     where tenant_id = $1
       and (
         lower(coalesce(name,'')) like '%junior%'
         or lower(coalesce(name,'')) like '%eliezer%'
       )
       and kind not in ('self', 'agent')`,
    [tenantId, orgId],
  );
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
