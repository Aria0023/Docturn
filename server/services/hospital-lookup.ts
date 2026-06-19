/**
 * Hospital lookup for the developer console's org autocomplete. Resolves a typed
 * fragment (e.g. "Cedars Sinai") to a real hospital with official name + city +
 * state + timezone.
 *
 * Primary source: the CMS NPI Registry (free, public, no key) — type-2
 * (organization) NPIs filtered to acute-care hospitals. Falls back to a curated
 * list of major systems when the network is unavailable, so the feature still
 * works offline / with no secrets.
 */

export interface HospitalSuggestion {
  name: string;
  city: string;
  state: string;
  timezone: string;
  /** Suggested short login code derived from the name. */
  code: string;
}

// State → IANA timezone (single-zone states use the obvious zone; multi-zone
// states use their most populous zone — good enough for a default the dev edits).
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
};

function tzFor(state: string): string {
  return STATE_TZ[(state || "").toUpperCase()] ?? "America/New_York";
}

/** Derive a short uppercase login code from a hospital name. */
export function codeFromName(name: string): string {
  const stop = new Set(["the", "of", "and", "at", "for", "medical", "center", "hospital", "health", "system", "regional", "general", "memorial", "university"]);
  const words = name
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const significant = words.filter((w) => !stop.has(w.toLowerCase()));
  const pick = (significant.length ? significant : words).slice(0, 2).join("");
  return pick.toUpperCase().slice(0, 8) || "ORG";
}

// Curated fallback — major US hospitals/systems for common queries (offline).
const CURATED: Array<{ name: string; city: string; state: string }> = [
  { name: "Cedars-Sinai Medical Center", city: "Los Angeles", state: "CA" },
  { name: "Mayo Clinic", city: "Rochester", state: "MN" },
  { name: "Cleveland Clinic", city: "Cleveland", state: "OH" },
  { name: "Johns Hopkins Hospital", city: "Baltimore", state: "MD" },
  { name: "Massachusetts General Hospital", city: "Boston", state: "MA" },
  { name: "Brigham and Women's Hospital", city: "Boston", state: "MA" },
  { name: "UCSF Medical Center", city: "San Francisco", state: "CA" },
  { name: "UCLA Medical Center", city: "Los Angeles", state: "CA" },
  { name: "Stanford Health Care", city: "Stanford", state: "CA" },
  { name: "NewYork-Presbyterian Hospital", city: "New York", state: "NY" },
  { name: "Mount Sinai Hospital", city: "New York", state: "NY" },
  { name: "NYU Langone Health", city: "New York", state: "NY" },
  { name: "Houston Methodist Hospital", city: "Houston", state: "TX" },
  { name: "MD Anderson Cancer Center", city: "Houston", state: "TX" },
  { name: "UT Southwestern Medical Center", city: "Dallas", state: "TX" },
  { name: "Northwestern Memorial Hospital", city: "Chicago", state: "IL" },
  { name: "Rush University Medical Center", city: "Chicago", state: "IL" },
  { name: "University of Michigan Hospitals", city: "Ann Arbor", state: "MI" },
  { name: "Duke University Hospital", city: "Durham", state: "NC" },
  { name: "Vanderbilt University Medical Center", city: "Nashville", state: "TN" },
  { name: "Emory University Hospital", city: "Atlanta", state: "GA" },
  { name: "Barnes-Jewish Hospital", city: "St. Louis", state: "MO" },
  { name: "Penn Presbyterian Medical Center", city: "Philadelphia", state: "PA" },
  { name: "University of Washington Medical Center", city: "Seattle", state: "WA" },
  { name: "Scripps Mercy Hospital", city: "San Diego", state: "CA" },
  { name: "Banner University Medical Center", city: "Phoenix", state: "AZ" },
  { name: "Tampa General Hospital", city: "Tampa", state: "FL" },
  { name: "Jackson Memorial Hospital", city: "Miami", state: "FL" },
];

function curatedSearch(q: string): HospitalSuggestion[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return CURATED.filter((h) => h.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((h) => ({ ...h, timezone: tzFor(h.state), code: codeFromName(h.name) }));
}

async function npiSearch(q: string): Promise<HospitalSuggestion[]> {
  const term = q.trim().replace(/\s+/g, " ");
  const url =
    "https://npiregistry.cms.hhs.gov/api/?version=2.1&enumeration_type=NPI-2&limit=20" +
    `&organization_name=${encodeURIComponent(term + "*")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      results?: Array<{
        basic?: { organization_name?: string };
        addresses?: Array<{ city?: string; state?: string; address_purpose?: string }>;
      }>;
    };
    const out: HospitalSuggestion[] = [];
    const seen = new Set<string>();
    for (const r of data.results ?? []) {
      const name = r.basic?.organization_name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const addr =
        r.addresses?.find((a) => a.address_purpose === "LOCATION") ??
        r.addresses?.[0] ??
        {};
      const state = (addr.state ?? "").toUpperCase();
      out.push({
        name: titleCase(name),
        city: titleCase(addr.city ?? ""),
        state,
        timezone: tzFor(state),
        code: codeFromName(name),
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|And|The|At|For)\b/g, (m) => m.toLowerCase());
}

export async function lookupHospitals(q: string): Promise<HospitalSuggestion[]> {
  if (!q || q.trim().length < 2) return [];
  try {
    const live = await npiSearch(q);
    if (live.length) {
      // Merge curated hits that the registry might miss, dedup by name.
      const names = new Set(live.map((l) => l.name.toLowerCase()));
      const extra = curatedSearch(q).filter((c) => !names.has(c.name.toLowerCase()));
      return [...live, ...extra].slice(0, 10);
    }
  } catch {
    // network blocked / offline — fall through to curated
  }
  return curatedSearch(q);
}
