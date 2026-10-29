/**
 * Motor de contatos (herança Prumo):
 * - nome vem do pushName do CONTATO (inbound), nunca de fromMe;
 * - nome do dono / telefone do operador nunca batizam peer;
 * - sem nome real não sobrescreve o que já está bom.
 */

export function digits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

export function canonicalPhone(phone: string | null | undefined): string {
  let d = digits(phone);
  if (!d) return "";
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) d = `55${d}`;
  if (d.startsWith("55") && d.length === 12 && /^[6-9]/.test(d.slice(4))) {
    d = `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

export function phonesMatch(a: string, b: string): boolean {
  const ca = canonicalPhone(a);
  const cb = canonicalPhone(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.endsWith(cb.slice(-11)) || cb.endsWith(ca.slice(-11));
}

export function normName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGhostName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (n.length < 2) return true;
  if (/^(whatsapp|contato|conversa|voc[eê]|desconhecido|unknown)(?![\p{L}\p{N}])/iu.test(n)) {
    return true;
  }
  if (!/\p{L}{2,}/u.test(n)) return true;
  if (digits(n).length >= 7 && digits(n).length >= n.replace(/\s/g, "").length * 0.6) return true;
  return false;
}

/** Nomes do dono / operadores conhecidos — nunca viram nome de contato. */
export function operatorNameSet(): Set<string> {
  const names = [
    process.env.BOOTSTRAP_OWNER_NAME,
    process.env.OWNER_DISPLAY_NAME,
    "Frederico Mazzo",
    "Frederico",
  ]
    .filter(Boolean)
    .map((n) => normName(String(n)));
  return new Set(names);
}

export function isOperatorDisplayName(name: string | null | undefined): boolean {
  const n = normName(name ?? "");
  if (!n) return false;
  const ops = operatorNameSet();
  if (ops.has(n)) return true;
  for (const op of ops) {
    if (op.length >= 4 && (n.startsWith(op) || op.startsWith(n))) return true;
  }
  return false;
}

export function isOperatorPhone(phone: string | null | undefined): boolean {
  const owner = process.env.BOOTSTRAP_OWNER_PHONE || process.env.OWNER_PHONE || "";
  if (!owner) return false;
  return phonesMatch(phone ?? "", owner);
}

/** Número do agente (Secretaria) — conversa com ele na escuta não é contato. */
export function agentPhoneCandidates(): string[] {
  const list = [
    process.env.BOOTSTRAP_AGENT_PHONE,
    process.env.AGENT_PHONE,
    process.env.AGENT_WA_PHONE,
  ]
    .filter(Boolean)
    .map((p) => canonicalPhone(String(p)));
  return [...new Set(list.filter((p) => p.length >= 10))];
}

export function isAgentPhone(phone: string | null | undefined): boolean {
  const peer = canonicalPhone(phone);
  if (!peer) return false;
  return agentPhoneCandidates().some((a) => phonesMatch(peer, a));
}

export function looksLikeAgentName(name: string | null | undefined): boolean {
  const n = normName(name ?? "");
  return /^(secretaria|secretario|prumo|agente( pessoal)?|assistant)$/.test(n);
}

/** PushName só é válido para batizar contato se for inbound e não for o dono/agente. */
export function peerDisplayName(opts: {
  direction: "in" | "out";
  pushName: string | null;
}): string | null {
  if (opts.direction !== "in") return null;
  const raw = (opts.pushName ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!raw || isGhostName(raw) || isOperatorDisplayName(raw) || looksLikeAgentName(raw)) {
    return null;
  }
  return raw;
}

export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9_-]+/g, "")
      .slice(0, 32);
    if (s && !out.includes(s) && out.length < 12) out.push(s);
  }
  return out;
}

/** Heurística barata de tags a partir do fio (sem LLM). */
export function suggestTagsFromText(blob: string): string[] {
  const t = blob.toLowerCase();
  const tags: string[] = [];
  const push = (tag: string) => {
    if (!tags.includes(tag) && tags.length < 6) tags.push(tag);
  };
  if (/reuni|call|zoom|meet|hor[aá]rio|amanh|hoje \d/.test(t)) push("agenda");
  if (/boleto|pix|pagar|nota fiscal|nfe|pagamento|cobran/.test(t)) push("financeiro");
  if (/contrato|proposta|or[cç]amento|homolog/.test(t)) push("comercial");
  if (/urgente|asap|hoje ainda|agora/.test(t)) push("urgente");
  if (/fam[ií]lia|m[aã]e|pai|filho|esposa|marido/.test(t)) push("pessoal");
  if (/epi|obra|inseg|seguran/.test(t)) push("operacao");
  if (/github|deploy|sistema|api|codigo|código/.test(t)) push("tech");
  return tags;
}
