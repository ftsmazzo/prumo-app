import { describe, expect, it } from "vitest";
import { extractFromText } from "./extract.js";

describe("extractFromText", () => {
  it("extrai link, email e telefone", () => {
    const items = extractFromText(
      "manda no https://exemplo.com/a e e-mail a@b.com.br ou 11987654321",
    );
    expect(items.some((i) => i.kind === "link" && i.value.includes("exemplo.com"))).toBe(true);
    expect(items.some((i) => i.kind === "email" && i.value === "a@b.com.br")).toBe(true);
    expect(items.some((i) => i.kind === "phone" && i.value.endsWith("987654321"))).toBe(true);
  });

  it("vazio sem texto", () => {
    expect(extractFromText(null)).toEqual([]);
  });
});
