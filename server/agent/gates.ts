/**
 * Gates pós-modelo: resposta do agente não inventa telefone/link/número
 * que não estejam na evidência (SQL + texto do comando).
 */

const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

export type GateResult = {
  ok: boolean;
  text: string;
  blocked: string[];
};

export function gateAgentReply(opts: {
  reply: string;
  evidenceText: string;
}): GateResult {
  const evidence = normalize(opts.evidenceText);
  const blocked: string[] = [];
  let text = opts.reply;

  const phones = opts.reply.match(PHONE_RE) ?? [];
  for (const raw of phones) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10) continue;
    if (!evidenceHasDigits(evidence, digits)) {
      blocked.push(`phone:${digits.slice(-4)}`);
      text = text.replace(raw, "[número omitido]");
    }
  }

  const urls = opts.reply.match(URL_RE) ?? [];
  for (const raw of urls) {
    const n = normalize(raw);
    if (!evidence.includes(n) && !evidence.includes(n.replace(/^https?:\/\//, ""))) {
      blocked.push(`url`);
      text = text.replace(raw, "[link omitido]");
    }
  }

  return { ok: blocked.length === 0, text, blocked };
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function evidenceHasDigits(evidence: string, digits: string): boolean {
  const e = evidence.replace(/\D/g, "");
  const tail = digits.slice(-11);
  return e.includes(tail) || e.includes(digits);
}
