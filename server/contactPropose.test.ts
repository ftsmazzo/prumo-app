import { describe, expect, it } from "vitest";
import { extractContactHints } from "./contactPropose.js";

describe("contactPropose heuristic", () => {
  const orgs = [
    { id: "o1", name: "Ecommtábil", tags: ["cliente", "piloto"] },
    { id: "o2", name: "INSEG", tags: [] },
  ];

  it("reconhece empresa já cadastrada no fio e marca cliente", () => {
    const hint = extractContactHints({
      thread:
        "[2026-10-28] contato: Junior aqui da Ecommtábil, funcionario no ecommFlow. Te mando o link do repo.",
      personName: "Junior",
      existingOrgs: orgs,
    });
    expect(hint?.organizationId).toBe("o1");
    expect(hint?.organizationName).toBe("Ecommtábil");
    expect(hint?.markClient).toBe(true);
    expect(hint?.confidence).toBe("high");
    expect(hint?.roleTitle).toBe("funcionário");
  });

  it("não inventa empresa sem evidência", () => {
    const hint = extractContactHints({
      thread: "[x] eu: blz. contato: ok valeu",
      personName: "Zé",
      existingOrgs: orgs,
    });
    expect(hint).toBeNull();
  });

  it("aceita reforço da LLM se org existir", () => {
    const hint = extractContactHints({
      thread: "papo longo sem o nome completo da firma mas contexto comercial e proposta",
      personName: "Eliezer",
      existingOrgs: orgs,
      llm: { organizationName: "Ecommtábil", markClient: true, roleTitle: "dono" },
    });
    expect(hint?.organizationId).toBe("o1");
    expect(hint?.roleTitle).toBe("dono");
    expect(hint?.markClient).toBe(true);
  });
});
