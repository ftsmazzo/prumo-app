import { describe, expect, it } from "vitest";
import { gateAgentReply } from "./gates.js";

describe("gateAgentReply", () => {
  it("bloqueia telefone inventado", () => {
    const r = gateAgentReply({
      reply: "Liga no 11999998888 agora",
      evidenceText: "Hoje sem compromissos.",
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("[número omitido]");
    expect(r.blocked.some((b) => b.startsWith("phone:"))).toBe(true);
  });

  it("permite telefone presente na evidência", () => {
    const r = gateAgentReply({
      reply: "Contato 11999998888 confirmado",
      evidenceText: "telefone 11999998888 na conversa",
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("11999998888");
  });

  it("bloqueia link inventado", () => {
    const r = gateAgentReply({
      reply: "Veja https://evil.example/x",
      evidenceText: "sem links",
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("[link omitido]");
  });
});
