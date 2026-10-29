import { describe, expect, it } from "vitest";
import { craftSecretaryTitle, ensureSecretaryTitle, isMessageDump } from "./polish.js";

describe("polish", () => {
  it("detecta dump de mensagem", () => {
    const raw = "Fred, marca amanha as 15h a reuniao do contrato na sede";
    expect(isMessageDump(raw, raw)).toBe(true);
  });

  it("monta título de compromisso curto", () => {
    const t = craftSecretaryTitle(
      "Fred, marca amanha as 15h a reuniao do contrato na sede",
      "commitment",
    );
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.toLowerCase()).not.toContain("fred, marca");
    expect(t).toMatch(/reuni|compromisso|contrato/i);
  });

  it("ensure reescreve dump", () => {
    const raw = "oi preciso que voce envie o contrato hoje";
    const t = ensureSecretaryTitle(raw, raw, "task");
    expect(t.length).toBeLessThan(raw.length);
  });
});
