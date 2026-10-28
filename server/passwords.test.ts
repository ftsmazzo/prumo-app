import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("passwords", () => {
  it("hashes and verifies", () => {
    const stored = hashPassword("senha-forte-123");
    expect(verifyPassword("senha-forte-123", stored)).toBe(true);
    expect(verifyPassword("outra", stored)).toBe(false);
  });
});
