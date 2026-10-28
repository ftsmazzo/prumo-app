import { describe, expect, it } from "vitest";
import { decideFromEvidence } from "./decide.js";

const base = {
  timezone: "America/Sao_Paulo",
  now: new Date("2026-10-28T12:00:00-03:00"),
  briefSummary: "",
  openCommitments: [] as Array<{ id: string; title: string; startsAt: string; status: string }>,
  openTasks: [] as Array<{ id: string; title: string; status: string; dueOn: string | null }>,
};

describe("decideFromEvidence", () => {
  it("propõe create_commitment quando há horário (não grava ainda)", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["oi, marca amanhã às 15h a reunião"],
      briefSummary: "contato pediu reunião",
    });
    expect(actions[0]?.type).toBe("create_commitment");
    if (actions[0]?.type === "create_commitment") {
      expect(actions[0].needsConfirm).toBe(true);
      expect(actions[0].startsAt).toContain("2026-10-29");
    }
  });

  it("atualiza compromisso aberto em vez de duplicar", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["melhor remarcar a reunião para amanhã às 16h"],
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

  it("propõe tarefa sem horário; não mistura com compromisso", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["preciso que você envie o contrato"],
      briefSummary: "pedido de envio",
    });
    expect(actions[0]?.type).toBe("create_task");
    expect(actions.every((a) => a.type !== "create_commitment")).toBe(true);
  });

  it("noop quando conversa sem sinal operacional", () => {
    const actions = decideFromEvidence({
      ...base,
      latestTexts: ["bom dia, tudo bem?"],
      briefSummary: "saudação",
    });
    expect(actions).toEqual([{ type: "noop", rationale: expect.any(String) }]);
  });
});
