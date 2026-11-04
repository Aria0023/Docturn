import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSign, generateKeyPairSync, createPublicKey, randomBytes, type KeyObject } from "node:crypto";

/**
 * A tiny OIDC identity provider, for driving DocTurn's SSO against something
 * real (E2.1). It serves discovery, a JWKS and a token endpoint, and signs
 * id_tokens with an RS256 key **generated at runtime** — no key material is
 * ever committed.
 *
 * It is deliberately minimal and inspectable: the test chooses the claims,
 * can break the signature, change the `kid`, rotate the key, answer the token
 * endpoint with an error, or sign with the wrong algorithm.
 */

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface IssuedToken {
  claims: Record<string, unknown>;
  /** Sign with a key that is NOT in the published JWKS. */
  wrongKey?: boolean;
  /** Claim RS256 in the header but sign nothing valid. */
  badSignature?: boolean;
  /** Use this `alg` in the header (default RS256). */
  alg?: string;
  /** Use this `kid` (default the published one). */
  kid?: string;
}

export interface OidcFixture {
  url: string;
  close(): Promise<void>;
  /** The next code exchange returns a token built from these options. */
  nextToken(t: IssuedToken): void;
  /** The next code exchange fails with this OAuth error. */
  nextTokenError(error: string, status?: number): void;
  /** Rotate the signing key (the JWKS changes; the old kid disappears). */
  rotateKey(): void;
  /** Serve a discovery document whose `issuer` is someone else. */
  lieAboutIssuer(v: string | null): void;
  /** Codes the token endpoint has been asked to exchange. */
  exchanges: Array<Record<string, string>>;
  /** What the authorize endpoint was asked for, most recent last. */
  authorizeCalls: Array<Record<string, string>>;
  signingKid(): string;
}

interface KeyPair {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function newKey(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = b64url(randomBytes(8));
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "RS256", use: "sig" };
  return { kid, privateKey, jwk };
}

function sign(key: KeyPair, claims: Record<string, unknown>, opts: IssuedToken): string {
  const header = { alg: opts.alg ?? "RS256", typ: "JWT", kid: opts.kid ?? key.kid };
  const head = b64url(Buffer.from(JSON.stringify(header), "utf8"));
  const body = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  if (opts.badSignature) return `${head}.${body}.${b64url(randomBytes(256))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(opts.wrongKey ? newKey().privateKey : key.privateKey))}`;
}

/** Start the fixture on an ephemeral loopback port. */
export async function startOidcIssuer(opts: { subject?: string } = {}): Promise<OidcFixture> {
  let key = newKey();
  let pending: IssuedToken | null = null;
  let pendingError: { error: string; status: number } | null = null;
  let issuerLie: string | null = null;
  const exchanges: Array<Record<string, string>> = [];
  const authorizeCalls: Array<Record<string, string>> = [];
  let base = "";

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", base || "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: issuerLie ?? base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [key.jwk] });
    if (url.pathname === "/authorize") {
      authorizeCalls.push(Object.fromEntries(url.searchParams.entries()));
      res.writeHead(302, { location: `${base}/authorized` });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        exchanges.push(Object.fromEntries(new URLSearchParams(raw).entries()));
        if (pendingError) {
          const e = pendingError;
          pendingError = null;
          return json(e.status, { error: e.error });
        }
        const t = pending ?? { claims: {} };
        pending = null;
        const now = Math.floor(Date.now() / 1000);
        const claims = {
          iss: base,
          sub: opts.subject ?? "idp-subject-1",
          aud: "docturn-client",
          iat: now,
          exp: now + 300,
          ...t.claims,
        };
        return json(200, { access_token: "at-" + b64url(randomBytes(8)), token_type: "Bearer", expires_in: 300, id_token: sign(key, claims, t) });
      });
      return undefined;
    }
    return json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;

  return {
    url: base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    nextToken: (t) => { pending = t; },
    nextTokenError: (error, status = 400) => { pendingError = { error, status }; },
    rotateKey: () => { key = newKey(); },
    lieAboutIssuer: (v) => { issuerLie = v; },
    exchanges,
    authorizeCalls,
    signingKid: () => key.kid,
  };
}

/** The public JWK of a throwaway key — for a "kid not in the key set" test. */
export function strangerJwk(): Record<string, unknown> {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { ...(createPublicKey(publicKey).export({ format: "jwk" }) as Record<string, unknown>), kid: "stranger", alg: "RS256", use: "sig" };
}
