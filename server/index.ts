import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { env } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, "..", "web", "dist");

const app = Fastify({ logger: true });

app.get("/health", async () => ({
  ok: true,
  service: "prumo-app",
  ts: new Date().toISOString(),
}));

app.get("/api/health", async () => ({
  ok: true,
  service: "prumo-app",
  ts: new Date().toISOString(),
}));

if (existsSync(staticDir)) {
  await app.register(fastifyStatic, {
    root: staticDir,
    wildcard: false,
  });
  app.setNotFoundHandler((_req, reply) => {
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });
