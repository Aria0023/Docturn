/**
 * Minimal FHIR R4 client used for every EHR. Only standard resources; no
 * vendor extensions. Pagination follows `Bundle.link[rel=next]` up to a cap.
 */
export interface FhirResource {
  resourceType: string;
  id?: string;
  [k: string]: unknown;
}
export interface FhirBundle extends FhirResource {
  resourceType: "Bundle";
  total?: number;
  entry?: Array<{ fullUrl?: string; resource?: FhirResource }>;
  link?: Array<{ relation: string; url: string }>;
}

export class FhirError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`fhir_error ${status}`);
  }
}

export class FhirClient {
  constructor(
    private baseUrl: string,
    private accessToken: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Accept: "application/fhir+json",
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.headers ?? {}),
      },
    });
  }

  async read<T extends FhirResource = FhirResource>(type: string, id: string): Promise<T | undefined> {
    const res = await this.request(`${this.baseUrl}/${type}/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 410) return undefined;
    if (!res.ok) throw new FhirError(res.status, await res.text().catch(() => ""));
    return (await res.json()) as T;
  }

  /** Search and flatten every page's resources (bounded). */
  async search(type: string, params: Record<string, string>, maxPages = 5): Promise<FhirResource[]> {
    const qs = new URLSearchParams(params).toString();
    let url: string | undefined = `${this.baseUrl}/${type}?${qs}`;
    const out: FhirResource[] = [];
    for (let page = 0; url && page < maxPages; page++) {
      const res: Response = await this.request(url);
      // Scope not granted for this resource → treat as "no data", not fatal.
      if (res.status === 401 || res.status === 403 || res.status === 404) return out;
      if (!res.ok) throw new FhirError(res.status, await res.text().catch(() => ""));
      const bundle = (await res.json()) as FhirBundle;
      for (const e of bundle.entry ?? []) {
        if (e.resource && e.resource.resourceType === type) out.push(e.resource);
      }
      url = bundle.link?.find((l) => l.relation === "next")?.url;
    }
    return out;
  }

  async create<T extends FhirResource>(resource: T): Promise<{ id?: string; location?: string; resource?: T }> {
    const res = await this.request(`${this.baseUrl}/${resource.resourceType}`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify(resource),
    });
    if (!res.ok) throw new FhirError(res.status, await res.text().catch(() => ""));
    const location = res.headers.get("Location") ?? res.headers.get("Content-Location") ?? undefined;
    let created: T | undefined;
    try {
      created = (await res.json()) as T;
    } catch {
      created = undefined;
    }
    const id = created?.id ?? location?.match(/\/([^/]+)(?:\/_history\/\d+)?$/)?.[1];
    return { id, location, resource: created };
  }

  /** Fetch a DocumentReference attachment by URL (same token). */
  async fetchBinaryText(url: string): Promise<string | undefined> {
    const abs = url.startsWith("http") ? url : `${this.baseUrl}/${url.replace(/^\/+/, "")}`;
    const res = await this.request(abs, { headers: { Accept: "text/plain, application/fhir+json" } });
    if (!res.ok) return undefined;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) {
      const b = (await res.json()) as { resourceType?: string; data?: string; contentType?: string };
      if (b.resourceType === "Binary" && b.data && (b.contentType ?? "").startsWith("text/")) {
        return Buffer.from(b.data, "base64").toString("utf8");
      }
      return undefined;
    }
    if (ct.startsWith("text/")) return res.text();
    return undefined;
  }
}
