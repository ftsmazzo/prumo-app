import { describe, expect, it } from "vitest";
import { decideFromEvidence } from "./decide.js";

const base = {
  timezone: "America/Sao_Paulo",
  now: new Date("2026-10-28T12:00:00-03:00"),
  briefSummary: "",
  personName: "Ana" as string | null,
  personNote: null as string | null,
  openCommitments: [] as Array<{ id: string; title: string; startsAt: string; status: string }>,
  openTasks: [] as Array<{ id: string; title: string; status: string; dueOn: string | null }>,
};

describe("decideFromEvidence", () => {
  it("propõe create_commitment com interlocutor no título", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["contato: oi, marca amanhã às 15h a reunião do contrato"],
      briefSummary: "contato pediu reunião",
    });
    expect(actions[0]?.type).toBe("create_commitment");
    if (actions[0]?.type === "create_commitment") {
      expect(actions[0].needsConfirm).toBe(true);
      expect(actions[0].startsAt).toContain("2026-10-29");
      expect(actions[0].title.toLowerCase()).toContain("ana");
    }
  });

  it("atualiza compromisso aberto em vez de duplicar", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["contato: melhor remarcar a reunião para amanhã às 16h"],
      briefSummary: "reunião",
      openCommitments: [
        {
          id: "c1",
          title: "reunião com ana",
          startsAt: "2026-10-29T15:00:00.000Z",
          status: "planned",
        },
      ],
    });
    expect(actions.some((a) => a.type === "update_commitment")).toBe(true);
    expect(actions.some((a) => a.type === "create_commitment")).toBe(false);
  });

  it("não cria tarefa só por keyword — direção fica para a LLM", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["contato: preciso que você envie o contrato"],
      briefSummary: "pedido de envio",
    });
    expect(actions.every((a) => a.type !== "create_task")).toBe(true);
    expect(actions[0]?.type).toBe("noop");
  });

  it("noop quando conversa sem sinal operacional", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["contato: bom dia, tudo bem?"],
      briefSummary: "saudação",
    });
    expect(actions).toEqual([{ type: "noop", rationale: expect.any(String) }]);
  });

  it("cancela quando o dono corrige na última fala", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: [
        "contato: sistema no github",
        "eu: não é isso, o github já está ok",
      ],
      openTasks: [{ id: "t1", title: "Verificar github", status: "todo", dueOn: null }],
    });
    expect(actions.some((a) => a.type === "update_task")).toBe(true);
    if (actions[0]?.type === "update_task") {
      expect(actions[0].patch.status).toBe("cancelled");
    }
  });
});
