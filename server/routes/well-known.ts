import type { Express, Request, Response } from "express";

/**
 * Universal links (iOS) and App Links (Android) for the native shell
 * (mobile-app/): the association files the platforms fetch from the web host
 * to let https://<host>/messages/42 open the installed app.
 *
 *   /.well-known/apple-app-site-association  ← APPLE_TEAM_ID + IOS_BUNDLE_ID
 *   /.well-known/assetlinks.json             ← ANDROID_PACKAGE +
 *                                              ANDROID_SHA256_CERT_FINGERPRINTS
 *                                              (comma-separated, colon-hex)
 *
 * Everything is read from the environment at request time, and an unset or
 * malformed pair answers 404 — never a placeholder. Apple's CDN and Android's
 * verifier cache whatever they fetch, so a file with a wrong team id or
 * fingerprint would silently break every link on a phone that has the app
 * installed, and a placeholder would claim an association that does not exist.
 *
 * Public by design (the platforms fetch them anonymously); no session, no PHI,
 * no audit row — the files describe the app, not any user.
 */

/** The URL shapes the shell knows how to open (kept in step with webapp/api-bridge.js). */
const LINKED_COMPONENTS = [
  { "/": "/messages/*", comment: "A thread (the shell opens it after sign-in)" },
  { "/": "/", "?": { open: "*" }, comment: "Open the app on a section (e.g. ?open=messages)" },
];

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function clean(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** The AASA document, or null when the iOS pair is not fully configured. */
export function appleAppSiteAssociation(): Record<string, unknown> | null {
  const team = clean("APPLE_TEAM_ID");
  const bundle = clean("IOS_BUNDLE_ID");
  if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-Za-z0-9.-]+$/.test(bundle)) return null;
  const appId = `${team}.${bundle}`;
  return {
    applinks: { details: [{ appIDs: [appId], components: LINKED_COMPONENTS }] },
    // Lets iOS offer passwords saved for the web host inside the shell's WebView.
    webcredentials: { apps: [appId] },
  };
}

/** The assetlinks.json document, or null when the Android pair is not fully configured. */
export function androidAssetLinks(): Array<Record<string, unknown>> | null {
  const pkg = clean("ANDROID_PACKAGE");
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(pkg)) return null;
  const prints = clean("ANDROID_SHA256_CERT_FINGERPRINTS")
    .split(/[,\s]+/)
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  if (!prints.length || prints.some((f) => !FINGERPRINT.test(f))) return null;
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints },
  }];
}

function sendJson(res: Response, body: unknown) {
  if (body === null) return res.status(404).json({ error: "not_configured" });
  // Short-lived cache: the platforms re-fetch on their own schedule, and a
  // changed fingerprint should take effect within the hour.
  res.set("Cache-Control", "public, max-age=3600");
  // Apple requires application/json on the EXTENSIONLESS path.
  return res.type("application/json").send(JSON.stringify(body));
}

export function registerWellKnownRoutes(app: Express) {
  app.get("/.well-known/apple-app-site-association", (_req: Request, res: Response) => sendJson(res, appleAppSiteAssociation()));
  app.get("/apple-app-site-association", (_req: Request, res: Response) => sendJson(res, appleAppSiteAssociation()));
  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => sendJson(res, androidAssetLinks()));
}
