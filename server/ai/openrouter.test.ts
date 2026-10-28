import { afterEach, describe, expect, it } from "vitest";
import { openRouterConfigured } from "./openrouter.js";

describe("openRouterConfigured", () => {
  const prev = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  });

  it("false sem chave", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(openRouterConfigured()).toBe(false);
  });

  it("true com chave", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    expect(openRouterConfigured()).toBe(true);
  });
});
