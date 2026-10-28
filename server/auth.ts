import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getPool } from "./db.js";
import { verifyPassword } from "./passwords.js";

const COOKIE = "prumo_session";
const SESSION_DAYS = 14;

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "set-cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`,
  );
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    "set-cookie",
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export async function loadUserFromRequest(req: FastifyRequest): Promise<AuthUser | null> {
  const token = parseCookie(req.headers.cookie, COOKIE);
  if (!token) return null;
  const pool = getPool();
  const row = await pool.query<{
    id: string;
    tenant_id: string;
    email: string;
    name: string;
    role: string;
  }>(
    `select u.id, u.tenant_id, u.email, u.name, u.role
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  const u = row.rows[0];
  if (!u) return null;
  return {
    id: u.id,
    tenantId: u.tenant_id,
    email: u.email,
    name: u.name,
    role: u.role,
  };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await loadUserFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return user;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(8).max(200),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    const pool = getPool();
    const user = await pool.query<{
      id: string;
      tenant_id: string;
      email: string;
      name: string;
      role: string;
      password_hash: string;
    }>(
      `select id, tenant_id, email, name, role, password_hash
         from users where lower(email) = lower($1) limit 1`,
      [body.data.email],
    );
    const row = user.rows[0];
    if (!row || !verifyPassword(body.data.password, row.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await pool.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1,$2,$3)`,
      [row.id, hashToken(token), expires.toISOString()],
    );
    setSessionCookie(reply, token, expires);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      name: row.name,
      role: row.role,
    };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = parseCookie(req.headers.cookie, COOKIE);
    if (token) {
      await getPool().query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await loadUserFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return user;
  });
}
