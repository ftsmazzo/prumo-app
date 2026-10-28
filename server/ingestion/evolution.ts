/** Normaliza messages.upsert da Evolution em mensagens do domínio. */

export const UPSERT_EVENT = "messages.upsert";

const IGNORED_TYPES: Record<string, string> = {
  protocolMessage: "protocol",
  reactionMessage: "reaction",
  senderKeyDistributionMessage: "protocol",
};
const NON_CONTENT = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);
const CAPTION_TYPES = new Set(["imageMessage", "videoMessage", "documentMessage"]);
const MEDIA_TYPES = new Set([...CAPTION_TYPES, "audioMessage", "stickerMessage"]);
const MEDIA_FIELDS = ["mimetype", "fileName", "seconds", "fileLength"] as const;
const DROPPED = new Set(["base64", "jpegThumbnail"]);

export type IncomingMessage = {
  providerMessageId: string;
  direction: "in" | "out";
  remoteJid: string;
  contactPhone: string;
  pushName: string | null;
  messageType: string;
  text: string | null;
  media: Record<string, unknown> | null;
  providerTimestamp: Date;
  isGroup: boolean;
};

export type ParseResult = {
  messages: Array<{ message: IncomingMessage; raw: Record<string, unknown> }>;
  ignored: string[];
};

export function normalizeEvent(event: unknown): string {
  return String(event ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, ".");
}

export function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\0/g, "");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROPPED.has(k)) continue;
      out[String(scrub(k))] = scrub(v);
    }
    return out;
  }
  return value;
}

export function parseMessagesUpsert(
  data: unknown,
  opts: { listenGroups?: boolean } = {},
): ParseResult {
  const listenGroups = opts.listenGroups ?? false;
  const items = Array.isArray(data) ? data : [data];
  const messages: ParseResult["messages"] = [];
  const ignored: string[] = [];
  for (const rawItem of items) {
    const item = scrub(rawItem);
    const parsed = parseItem(item, listenGroups);
    if (typeof parsed === "string") ignored.push(parsed);
    else messages.push(parsed);
  }
  return { messages, ignored };
}

function parseItem(
  item: unknown,
  listenGroups: boolean,
): { message: IncomingMessage; raw: Record<string, unknown> } | string {
  if (!item || typeof item !== "object") return "malformed";
  const row = item as Record<string, unknown>;
  const key = row.key;
  if (!key || typeof key !== "object") return "malformed";
  const k = key as Record<string, unknown>;
  if (!k.id || !k.remoteJid) return "malformed";

  const jid = String(k.remoteJid);
  if (jid.endsWith("@broadcast")) return "broadcast";
  const isGroup = jid.endsWith("@g.us");
  if (isGroup && !listenGroups) return "group";

  const body = row.message;
  if (!body || typeof body !== "object" || !Object.keys(body as object).length) return "no_message";
  const bodyObj = body as Record<string, unknown>;
  const messageType =
    (typeof row.messageType === "string" && row.messageType) || firstContentKey(bodyObj);
  if (!messageType) return "no_message";
  if (messageType in IGNORED_TYPES) return IGNORED_TYPES[messageType];

  return {
    raw: row,
    message: {
      providerMessageId: String(k.id),
      direction: k.fromMe ? "out" : "in",
      remoteJid: jid,
      contactPhone: contactPhone(k, jid, isGroup),
      pushName: typeof row.pushName === "string" ? row.pushName : null,
      messageType,
      text: extractText(messageType, bodyObj),
      media: extractMedia(messageType, bodyObj),
      providerTimestamp: parseTimestamp(row.messageTimestamp),
      isGroup,
    },
  };
}

function firstContentKey(body: Record<string, unknown>): string | null {
  for (const k of Object.keys(body)) {
    if (!NON_CONTENT.has(k)) return k;
  }
  return null;
}

function digits(jid: string): string {
  return jid.split("@", 1)[0].split(":", 1)[0];
}

function contactPhone(key: Record<string, unknown>, jid: string, isGroup: boolean): string {
  if (isGroup && key.participant) return digits(String(key.participant));
  if (jid.endsWith("@lid") && key.remoteJidAlt) return digits(String(key.remoteJidAlt));
  return digits(jid);
}

function extractText(messageType: string, body: Record<string, unknown>): string | null {
  if (messageType === "conversation") {
    return typeof body.conversation === "string" && body.conversation ? body.conversation : null;
  }
  const inner = body[messageType];
  if (!inner || typeof inner !== "object") return null;
  const o = inner as Record<string, unknown>;
  if (messageType === "extendedTextMessage") {
    return typeof o.text === "string" && o.text ? o.text : null;
  }
  if (CAPTION_TYPES.has(messageType)) {
    return typeof o.caption === "string" && o.caption ? o.caption : null;
  }
  return null;
}

function extractMedia(
  messageType: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!MEDIA_TYPES.has(messageType)) return null;
  const inner = body[messageType];
  if (!inner || typeof inner !== "object") return null;
  const o = inner as Record<string, unknown>;
  const media: Record<string, unknown> = {};
  for (const field of MEDIA_FIELDS) {
    if (field in o) media[field] = o[field];
  }
  return Object.keys(media).length ? media : null;
}

function parseTimestamp(value: unknown): Date {
  let n: number | null = null;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim()) n = Number(value);
  else if (value && typeof value === "object" && "low" in value) {
    n = Number((value as { low: unknown }).low);
  }
  if (n === null || !Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n > 1e12 ? n : n * 1000);
}
