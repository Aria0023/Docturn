/**
 * Where a link or a tapped notification should take the web app. Pure (no
 * React Native imports): the root test suite runs it against the server's
 * real push titles (tests/mobile-shell.test.ts).
 *
 * The two URL shapes are the ones the server publishes as universal / app
 * links (server/routes/well-known.ts) and the bridge understands
 * (webapp/api-bridge.js):
 *   https://<host>/messages/<id>     → Messages, that thread
 *   https://<host>/?open=messages    → Messages
 * plus the app's own scheme, docturn://messages[/<id>].
 */
export interface OpenTarget {
  nav: "messages";
  conversationId?: number;
}

export interface ParsedUrl {
  scheme: string;
  host: string;
  path: string;
  query: string;
}

/** Split a URL without the URL class (React Native's implementation is partial). */
export function parseUrl(url: string): ParsedUrl | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(String(url || ""));
  if (!m) return null;
  return { scheme: m[1]!.toLowerCase(), host: m[2]!.toLowerCase(), path: m[3] || "", query: m[4] || "" };
}

export function hostOf(url: string): string {
  return parseUrl(url)?.host ?? "";
}

/** True when the URL is on the configured DocTurn host (any scheme-less comparison is a non-match). */
export function sameHost(url: string, host: string): boolean {
  const p = parseUrl(url);
  return !!p && /^https?$/.test(p.scheme) && p.host === host.toLowerCase();
}

export function linkTarget(url: string, host: string, scheme = "docturn"): OpenTarget | null {
  const p = parseUrl(url);
  if (!p) return null;
  let path = p.path;
  if (p.scheme === scheme) {
    path = "/" + p.host + p.path; // docturn://messages/42 → host "messages", path "/42"
  } else if (!/^https?$/.test(p.scheme) || p.host !== host.toLowerCase()) {
    return null;
  }
  const thread = /^\/messages(?:\/(\d+))?\/?$/.exec(path);
  if (thread) return thread[1] ? { nav: "messages", conversationId: Number(thread[1]) } : { nav: "messages" };
  if ((path === "/" || path === "") && /(?:^|&)open=messages(?:&|$)/.test(p.query)) return { nav: "messages" };
  return null;
}

/**
 * A push payload is content-free (title only, no ids — see
 * server/services/push.ts), so a tap can only open a section: a message
 * title opens Messages (the rule webapp/sw.js applies), anything else just
 * opens the app.
 */
export function pushTarget(title: string | null | undefined): OpenTarget | null {
  return /message/i.test(String(title || "")) ? { nav: "messages" } : null;
}

/** The URL the WebView starts on for a target (the bridge consumes the path / query after sign-in). */
export function startUrl(apiBaseUrl: string, target: OpenTarget | null): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  if (!target) return base + "/";
  return target.conversationId != null ? `${base}/messages/${target.conversationId}` : `${base}/?open=messages`;
}
