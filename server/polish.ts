/** Títulos operacionais — secretária, não cola de mensagem. */

const DUMP_MAX = 72;

export function isMessageDump(title: string, transcript: string): boolean {
  const t = title.trim();
  const raw = transcript.trim();
  if (!t) return true;
  if (t.length > DUMP_MAX) return true;
  if (!raw) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const nt = norm(t);
  const nr = norm(raw);
  if (nr.startsWith(nt) && nt.length >= 24) return true;
  if (/^[^:]{2,40}:\s+/.test(t) && t.length > 50) return true;
  return false;
}

function stripSenderPrefix(text: string): string {
  return text.replace(/^[^:\n]{2,40}:\s*/, "").trim();
}

function firstWords(text: string, max = 8): string {
  const words = text
    .replace(/[^\p{L}\p{N}\s\-–—]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, max).join(" ");
}

/** Título curto com sentido a partir do texto bruto. */
export function craftSecretaryTitle(
  transcript: string,
  kind: "task" | "commitment" | string,
): string {
  const raw = stripSenderPrefix(transcript.replace(/\s+/g, " ").trim());
  if (!raw) return kind === "commitment" ? "Compromisso" : "Tarefa";

  if (kind === "commitment") {
    const withWho = raw.match(
      /\bcom\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕ][\p{L}'-]*(?:\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕ][\p{L}']*){0,3})/u,
    );
    const topic =
      raw.match(
        /reuni[aã]o\s+(?:sobre\s+|de\s+|com\s+)?(.{0,40}?)(?:\s+as\s+|\s+às\s+|\s+amanh|\s+hoje|\s+na\s+|\s+no\s+|$)/i,
      )?.[1] ||
      raw.match(
        /(?:marca(?:r)?|agenda(?:r)?)\s+(?:o\s+|a\s+)?(.{4,40}?)(?:\s+as\s+|\s+às\s+|\s+amanh|\s+hoje|$)/i,
      )?.[1];
    const who = (withWho?.[1] || "").trim();
    const topicClean = (topic || "")
      .replace(/\breuni[aã]o\b/gi, "")
      .replace(/\bcompromisso\b/gi, "")
      .replace(/^(o|a|um|uma)\s+/i, "")
      .trim();
    if (who && topicClean && !topicClean.toLowerCase().includes(who.toLowerCase())) {
      return `Reunião ${firstWords(topicClean, 4)} com ${who}`.slice(0, 80);
    }
    if (who) return `Reunião com ${who}`.slice(0, 80);
    if (topicClean) return `Reunião — ${firstWords(topicClean, 6)}`.slice(0, 80);
    return `Compromisso — ${firstWords(raw, 6)}`.slice(0, 80);
  }

  const cleaned = raw
    .replace(/^(oi|ol[aá]|fala|e a[ií]|por favor|pfv|fred)[,!.\s]*/i, "")
    .replace(/\b(cria(r)?|faz(er)?|preciso que|lembra(r)? de|anota(r)?|marca(?:r)?)\s+/i, "");
  const base = firstWords(cleaned || raw, 8);
  const titled = base.charAt(0).toUpperCase() + base.slice(1);
  return titled.slice(0, 80);
}

/** Garante título usable; se for dump, reescreve. */
export function ensureSecretaryTitle(
  title: string,
  sourceText: string,
  kind: "task" | "commitment",
): string {
  if (!isMessageDump(title, sourceText) && title.trim().length > 0 && title.length <= DUMP_MAX) {
    return title.trim().slice(0, 80);
  }
  return craftSecretaryTitle(sourceText || title, kind);
}
