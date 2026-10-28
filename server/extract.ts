import { createHash } from "node:crypto";
import type pg from "pg";

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;

export type Extracted = { kind: "link" | "phone" | "email"; value: string };

/** Extratores determinísticos — zero LLM. */
export function extractFromText(text: string | null | undefined): Extracted[] {
  if (!text) return [];
  const out: Extracted[] = [];
  const seen = new Set<string>();

  for (const m of text.match(URL_RE) ?? []) {
    const value = m.replace(/[.,;:!?)]+$/, "");
    const key = `link:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "link", value });
  }
  for (const m of text.match(EMAIL_RE) ?? []) {
    const value = m.toLowerCase();
    const key = `email:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "email", value });
  }
  for (const m of text.match(PHONE_RE) ?? []) {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) continue;
    const key = `phone:${digits}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "phone", value: digits });
  }
  return out;
}

export async function persistExtractedItems(
  client: pg.PoolClient,
  opts: {
    tenantId: string;
    messageId: string;
    conversationId?: string | null;
    groupId?: string | null;
    text: string | null;
  },
): Promise<number> {
  const items = extractFromText(opts.text);
  let n = 0;
  for (const item of items) {
    const dedupe = createHash("sha256")
      .update(`${opts.tenantId}|${item.kind}|${item.value}`)
      .digest("hex")
      .slice(0, 40);
    const r = await client.query(
      `insert into extracted_items (
         tenant_id, message_id, conversation_id, group_id, kind, value, dedupe_key
       ) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (tenant_id, dedupe_key) do nothing`,
      [
        opts.tenantId,
        opts.messageId,
        opts.conversationId ?? null,
        opts.groupId ?? null,
        item.kind,
        item.value,
        dedupe,
      ],
    );
    if (r.rowCount) n += 1;
  }
  return n;
}
