import { describe, expect, it } from "vitest";

// Testa o contrato do prompt via heurísticas exportadas indiretas —
// fallback não deve inventar "pedido do contato".
import { ficharConversation } from "./fichar.js";

describe("fichar fallback", () => {
  it("sem OpenRouter não inventa followup genérico", async () => {
    const prevKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const fakeClient = {
      query: async () => ({ rows: [] }),
    } as unknown as import("pg").PoolClient;

    const r = await ficharConversation(fakeClient, {
      tenantId: "00000000-0000-0000-0000-000000000001",
      conversationId: "00000000-0000-0000-0000-000000000002",
      personName: "Junior",
      threadLines: [
        "[2026-10-29 13:53] Junior: voce consegue subir la?",
        "[2026-10-29 13:58] Junior: consegui kkk",
        "[2026-10-29 13:59] Junior: https://github.com/Ecommtabil/EcommFlow",
      ],
    });

    expect(r.source).toBe("fallback");
    expect(r.openItems).toEqual([]);
    expect(r.microSummary.toLowerCase()).not.toContain("pedido do contato");
    expect(r.microSummary).not.toMatch(/→/);

    if (prevKey) process.env.OPENROUTER_API_KEY = prevKey;
  });
});
