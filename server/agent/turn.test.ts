import { describe, expect, it } from "vitest";
import { phonesMatch } from "./turn.js";

describe("phonesMatch", () => {
  it("casa com e sem 55", () => {
    expect(phonesMatch("5516996480805", "16996480805")).toBe(true);
    expect(phonesMatch("+55 16 99648-0805", "5516996480805")).toBe(true);
  });

  it("rejeita número diferente", () => {
    expect(phonesMatch("5516996480805", "5511999999999")).toBe(false);
  });
});
