/**
 * Cria tenant + canal listen_personal e imprime o segredo uma vez.
 * Uso: DATABASE_URL=... npx tsx server/seed.ts
 */

import { env } from "./config.js";
import { closeDb, db } from "./db.js";
import { migrate } from "./migrate.js";
import { hashSecret, newWebhookSecret } from "./security.js";

async function main() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const database = db();
  await migrate(database);

  const slug = process.env.SEED_SLUG || "pessoal";
  const name = process.env.SEED_NAME || "Prumo Pessoal";
  const kind = process.env.SEED_CHANNEL_KIND || "listen_personal";
  const instance = process.env.SEED_INSTANCE || null;

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

  const existing = await database.query(
    `select id from channels where tenant_id = $1 and kind = $2 limit 1`,
    [tenant.id, kind],
  );
  if (existing.rowCount) {
    console.log(
      JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        channelId: existing.rows[0].id,
        note: "channel already exists",
      }),
    );
    return;
  }

  const secret = newWebhookSecret();
  const channel = (
    await database.query<{ id: string }>(
      `insert into channels (tenant_id, kind, name, instance_name, secret_hash, status, listen_groups)
       values ($1, $2, $3, $4, $5, 'pending', false) returning id`,
      [tenant.id, kind, "WhatsApp pessoal", instance, hashSecret(secret)],
    )
  ).rows[0];

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantId: tenant.id,
        channelId: channel.id,
        webhookSecret: secret,
        webhookPath: `/webhooks/evolution/${channel.id}`,
        header: "x-webhook-secret",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
