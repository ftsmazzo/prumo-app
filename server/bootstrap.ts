import type { Db } from "./db.js";
import { hashSecret } from "./security.js";

/** Se BOOTSTRAP_WEBHOOK_SECRET estiver setado, garante tenant+canal listen_personal. */
export async function bootstrapPersonalChannel(database: Db): Promise<void> {
  const secret = process.env.BOOTSTRAP_WEBHOOK_SECRET;
  if (!secret) return;

  const slug = process.env.BOOTSTRAP_SLUG || "pessoal";
  const name = process.env.BOOTSTRAP_NAME || "Prumo Pessoal";
  const instance = process.env.BOOTSTRAP_INSTANCE || null;

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
    `select id from channels where tenant_id = $1 and kind = 'listen_personal' limit 1`,
    [tenant.id],
  );
  if (existing.rowCount) return;

  const channel = (
    await database.query<{ id: string }>(
      `insert into channels (tenant_id, kind, name, instance_name, secret_hash, status, listen_groups)
       values ($1, 'listen_personal', 'WhatsApp pessoal', $2, $3, 'pending', false)
       returning id`,
      [tenant.id, instance, hashSecret(secret)],
    )
  ).rows[0];

  console.info(`[bootstrap] listen_personal channel=${channel.id} tenant=${tenant.id}`);
}
