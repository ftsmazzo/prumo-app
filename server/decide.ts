/**
 * Decide ações sobre compromisso/tarefa a partir da evidência da conversa.
 * Política: confirmar na dúvida; preferir atualizar item aberto a criar duplicata.
 */

export type DecisionAction =
  | {
      type: "create_commitment";
      title: string;
      startsAt: string;
      endsAt?: string | null;
      needsConfirm: boolean;
      rationale: string;
    }
  | {
      type: "update_commitment";
      commitmentId: string;
      patch: { title?: string; startsAt?: string; status?: string; note?: string };
      needsConfirm: boolean;
      rationale: string;
    }
  | {
      type: "create_task";
      title: string;
      dueOn?: string | null;
      needsConfirm: boolean;
      rationale: string;
    }
  | {
      type: "update_task";
      taskId: string;
      patch: { title?: string; status?: string; dueOn?: string | null; note?: string };
      needsConfirm: boolean;
      rationale: string;
    }
  | { type: "noop"; rationale: string };

export type DecideInput = {
  timezone: string;
  now: Date;
  briefSummary: string;
  latestTexts: string[];
  openCommitments: Array<{ id: string; title: string; startsAt: string; status: string }>;
  openTasks: Array<{ id: string; title: string; status: string; dueOn: string | null }>;
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  "segunda-feira": 1,
  terca: 2,
  terça: 2,
  "terca-feira": 2,
  "terça-feira": 2,
  quarta: 3,
  "quarta-feira": 3,
  quinta: 4,
  "quinta-feira": 4,
  sexta: 5,
  "sexta-feira": 5,
  sabado: 6,
  sábado: 6,
};

/** Regras determinísticas (baratas). LLM entra depois sem mudar o contrato. */
export function decideFromEvidence(input: DecideInput): DecisionAction[] {
  const blob = [...input.latestTexts, input.briefSummary].join("\n").toLowerCase();
  const actions: DecisionAction[] = [];

  const done = /(conclu[ií]|feito|já fiz|ja fiz|cancelei|desmarca)/i.test(blob);
  if (done && input.openTasks[0]) {
    actions.push({
      type: "update_task",
      taskId: input.openTasks[0].id,
      patch: { status: /cancela|desmarca/i.test(blob) ? "cancelled" : "done" },
      needsConfirm: true,
      rationale: "texto indica conclusão/cancelamento de pendência aberta",
    });
  }
  if (done && input.openCommitments[0] && /desmarca|cancela/.test(blob)) {
    actions.push({
      type: "update_commitment",
      commitmentId: input.openCommitments[0].id,
      patch: { status: "cancelled" },
      needsConfirm: true,
      rationale: "texto indica cancelamento de compromisso aberto",
    });
  }

  const when = extractWhen(blob, input.now);
  const commitmentish = /(reuni[aã]o|encontro|call|almo[cç]o|caf[eé]|marcar|marca|hor[aá]rio|as \d)/i.test(
    blob,
  );
  const taskish = /(preciso|pend[eê]ncia|lembrar|enviar|pagar|resolver|tarefa|fazer)/i.test(blob);

  if (when && commitmentish) {
    const title = guessTitle(input.latestTexts, "Compromisso");
    const existing = input.openCommitments.find((c) => similar(c.title, title));
    if (existing) {
      actions.push({
        type: "update_commitment",
        commitmentId: existing.id,
        patch: { startsAt: when.toISOString(), title },
        needsConfirm: true,
        rationale: "mesmo assunto já aberto — atualiza horário em vez de duplicar",
      });
    } else {
      actions.push({
        type: "create_commitment",
        title,
        startsAt: when.toISOString(),
        endsAt: new Date(when.getTime() + 60 * 60 * 1000).toISOString(),
        needsConfirm: true,
        rationale: "detectou horário/compromisso na conversa",
      });
    }
  } else if (taskish && !when) {
    const title = guessTitle(input.latestTexts, "Tarefa");
    const existing = input.openTasks.find((t) => similar(t.title, title));
    if (existing) {
      actions.push({
        type: "update_task",
        taskId: existing.id,
        patch: { note: input.latestTexts[0]?.slice(0, 400) },
        needsConfirm: false,
        rationale: "tarefa aberta semelhante — anexa contexto, não duplica",
      });
    } else {
      actions.push({
        type: "create_task",
        title,
        dueOn: null,
        needsConfirm: true,
        rationale: "detectou pedido/ação sem horário fixo",
      });
    }
  }

  if (actions.length === 0) {
    actions.push({
      type: "noop",
      rationale: "conversa organizada; nada operacional claro para gravar ainda",
    });
  }
  return actions;
}

function guessTitle(texts: string[], fallback: string): string {
  const last = texts.find((t) => t.trim()) || fallback;
  return last.replace(/\s+/g, " ").trim().slice(0, 120) || fallback;
}

function similar(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na.includes(nb.slice(0, 24)) || nb.includes(na.slice(0, 24))) return true;
  const stop = new Set([
    "a",
    "o",
    "as",
    "os",
    "de",
    "da",
    "do",
    "para",
    "com",
    "que",
    "melhor",
    "remarcar",
    "marcar",
    "amanha",
    "hoje",
  ]);
  const tokens = (s: string) => s.split(" ").filter((t) => t.length > 3 && !stop.has(t));
  const ta = new Set(tokens(na));
  const tb = tokens(nb);
  return tb.some((t) => ta.has(t)) || tokens(na).some((t) => nb.includes(t));
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractWhen(text: string, now: Date): Date | null {
  const hm = text.match(/\b(?:às|as|á|a)?\s*(\d{1,2})(?::|h)?(\d{2})?\b/);
  let hour = 9;
  let minute = 0;
  if (hm) {
    hour = Number(hm[1]);
    minute = hm[2] ? Number(hm[2]) : 0;
    if (hour > 23) return null;
  } else if (!/(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)/i.test(text)) {
    return null;
  }

  const base = new Date(now);
  if (/amanh[aã]/.test(text)) base.setDate(base.getDate() + 1);
  else {
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      if (text.includes(name)) {
        const delta = (dow - base.getDay() + 7) % 7 || 7;
        base.setDate(base.getDate() + delta);
        break;
      }
    }
  }
  base.setHours(hour, minute, 0, 0);
  return base;
}
