import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function newWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Compara hash SHA-256 do segredo enviado com o hash guardado. */
export function secretMatches(given: string | undefined, expectedHash: string): boolean {
  if (!given) return false;
  const givenHash = Buffer.from(hashSecret(given), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  if (givenHash.length !== expected.length) return false;
  return timingSafeEqual(givenHash, expected);
}
