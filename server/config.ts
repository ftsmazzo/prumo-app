import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  RUN_WORKER: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export const env = schema.parse(process.env);
