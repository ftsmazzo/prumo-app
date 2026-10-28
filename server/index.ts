import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { registerOpsRoutes } from "./api/ops.js";
import { registerAuthRoutes } from "./auth.js";
import { bootstrapPersonalChannel } from "./bootstrap.js";
import { env } from "./config.js";
import { closeDb, db, pingDb } from "./db.js";
import { migrate } from "./migrate.js";
import { registerSetupRoutes } from "./setup.js";
import { registerEvolutionWebhook } from "./webhooks/evolution.js";
import { startWorkerLoop } from "./worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, "..", "web", "dist");

const app = Fastify({ logger: true });

if (env.DATABASE_URL) {
  const database = db();
  const applied = await migrate(database);
  if (applied.length) app.log.info({ applied }, "migrations applied");
  await bootstrapPersonalChannel(database);
}

app.get("/health", async () => ({
  ok: true,
  service: "prumo-app",
  db: await pingDb(),
  ts: new Date().toISOString(),
}));

app.get("/api/health", async () => ({
  ok: true,
  service: "prumo-app",
  db: await pingDb(),
  ts: new Date().toISOString(),
}));

await registerEvolutionWebhook(app);
if (env.DATABASE_URL) {
  await registerAuthRoutes(app);
  await registerOpsRoutes(app);
  await registerSetupRoutes(app);
}

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

let workerTimer: NodeJS.Timeout | undefined;
if (env.RUN_WORKER && env.DATABASE_URL) {
  workerTimer = startWorkerLoop();
}

async function shutdown() {
  if (workerTimer) clearInterval(workerTimer);
  await app.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
