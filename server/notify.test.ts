import { describe, expect, it } from "vitest";
import { craftNotifyBody, shouldNotifyFromBrief } from "./notify.js";

describe("notify — seletivo com VIP", () => {
  it("não avisa só porque o repo/link atualizou (mesmo cliente)", () => {
    const r = shouldNotifyFromBrief({
      microSummary: "Junior atualizou o link do ecommFlow no GitHub.",
      summary: "Ele subiu o scaffold e compartilhou o repo.",
      importance: "high",
      kind: "client",
      vip: false,
      orgName: "Ecommtábil",
      openOwnerActions: 0,
      alreadyProposed: false,
    });
    expect(r.notify).toBe(false);
    expect(r.reason).toBe("tech_noise");
  });

  it("avisa VIP com feedback / stake real", () => {
    const r = shouldNotifyFromBrief({
      microSummary: "Eliezer deu feedback na proposta e aguarda sua revisão até sexta.",
      summary: "Cliente Ecommtábil pediu ajustes no pitch.",
      importance: "critical",
      kind: "client",
      vip: true,
      orgName: "Ecommtábil",
      openOwnerActions: 1,
      alreadyProposed: false,
    });
    expect(r.notify).toBe(true);
    expect(r.reason).toBe("vip_meaningful");
  });

  it("silêncio se o motor já propôs algo pra confirmar", () => {
    const r = shouldNotifyFromBrief({
      microSummary: "Marcaram call amanhã 15h; você precisa confirmar.",
      summary: "Reunião com Eliezer.",
      importance: "critical",
      kind: "client",
      vip: true,
      orgName: "Ecommtábil",
      openOwnerActions: 1,
      alreadyProposed: true,
    });
    expect(r.notify).toBe(false);
    expect(r.reason).toBe("already_proposed_confirm");
  });

  it("aviso curto marca VIP", () => {
    const body = craftNotifyBody({
      personName: "Eliezer",
      orgName: "Ecommtábil",
      roleTitle: "dono",
      vip: true,
      microSummary: "Feedback na proposta — espera sua revisão.",
    });
    expect(body).toContain("VIP");
    expect(body).toContain("Eliezer");
    expect(body.toLowerCase()).not.toContain("peça pra");
  });
});
