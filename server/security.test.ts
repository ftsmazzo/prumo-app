import { describe, expect, it } from "vitest";
import { hashSecret, secretMatches } from "./security.js";

describe("secretMatches", () => {
  it("accepts the correct secret", () => {
    const hash = hashSecret("super-secret");
    expect(secretMatches("super-secret", hash)).toBe(true);
  });

  it("rejects wrong or empty secret", () => {
    const hash = hashSecret("super-secret");
    expect(secretMatches("nope", hash)).toBe(false);
    expect(secretMatches(undefined, hash)).toBe(false);
  });
});
