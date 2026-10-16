/**
 * SMART App Launch discovery: `<iss>/.well-known/smart-configuration`
 * (falls back to the CapabilityStatement OAuth extension). Cached briefly so
 * every launch doesn't hit the EHR twice.
 */
export interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer?: string;
  jwks_uri?: string;
  capabilities?: string[];
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: SmartConfiguration }>();

export function _resetDiscoveryCache() {
  cache.clear();
}

export async function discoverSmartConfiguration(iss: string): Promise<SmartConfiguration> {
  const base = iss.replace(/\/+$/, "");
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const res = await fetch(`${base}/.well-known/smart-configuration`, {
    headers: { Accept: "application/json" },
  });
  if (res.ok) {
    const value = (await res.json()) as SmartConfiguration;
    if (value.authorization_endpoint && value.token_endpoint) {
      cache.set(base, { at: Date.now(), value });
      return value;
    }
  }

  // Legacy fallback: CapabilityStatement security extension.
  const meta = await fetch(`${base}/metadata`, { headers: { Accept: "application/fhir+json" } });
  if (!meta.ok) throw new Error(`smart_discovery_failed: ${res.status}/${meta.status}`);
  const cs = (await meta.json()) as {
    rest?: Array<{ security?: { extension?: Array<{ url: string; extension?: Array<{ url: string; valueUri?: string }> }> } }>;
  };
  const ext = cs.rest?.[0]?.security?.extension?.find((e) =>
    e.url.endsWith("StructureDefinition/oauth-uris"),
  );
  const get = (u: string) => ext?.extension?.find((e) => e.url === u)?.valueUri;
  const authorization_endpoint = get("authorize");
  const token_endpoint = get("token");
  if (!authorization_endpoint || !token_endpoint) throw new Error("smart_discovery_failed: no oauth-uris");
  const value = { authorization_endpoint, token_endpoint };
  cache.set(base, { at: Date.now(), value });
  return value;
}
