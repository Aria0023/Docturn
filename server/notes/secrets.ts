import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * At-rest encryption for connector / EHR secrets (client secrets, API keys).
 * AES-256-GCM with a key derived from SECRETS_KEY (production: set a 32+ char
 * random value, ideally sourced from a KMS). Without it we derive from the
 * session secret so dev still works — never do that in production.
 */
function key(): Buffer {
  const raw = process.env.SECRETS_KEY ?? process.env.SESSION_SECRET ?? "docturn-dev-only-secrets-key";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined;
  const [v, ivB, tagB, encB] = stored.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) return undefined;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}

/** Keys inside a connector config that must be encrypted at rest. */
export const SECRET_CONFIG_KEYS = ["apiKey", "clientSecret", "token", "password"] as const;

export function encryptConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const k of SECRET_CONFIG_KEYS) {
    const v = out[k];
    if (typeof v === "string" && v && !v.startsWith("v1.")) out[k] = encryptSecret(v);
  }
  return out;
}

export function decryptConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const k of SECRET_CONFIG_KEYS) {
    const v = out[k];
    if (typeof v === "string" && v.startsWith("v1.")) out[k] = decryptSecret(v);
  }
  return out;
}

/** Config as returned to admins: secrets replaced by a presence marker. */
export function redactConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const k of SECRET_CONFIG_KEYS) {
    if (typeof out[k] === "string" && out[k]) out[k] = "••••••••";
  }
  return out;
}
