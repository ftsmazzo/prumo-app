import Fastify from "fastify";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("returns ok", async () => {
    const app = Fastify();
    app.get("/health", async () => ({ ok: true, service: "prumo-app" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "prumo-app" });
    await app.close();
  });
});
