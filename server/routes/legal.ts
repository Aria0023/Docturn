import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";

/**
 * Public legal pages: the Privacy Policy, Terms of Use, Clinical Safety
 * Notice, Acceptable Use Policy and Subprocessor List, rendered from the
 * Markdown sources in docs/legal so there is ONE copy of each. Apple and
 * Google require a privacy-policy URL reachable without signing in.
 * No session, no PHI, nothing personalised.
 */
const PAGES: Record<string, { file: string; title: string }> = {
  "/privacy": { file: "PRIVACY_POLICY.md", title: "Privacy Policy" },
  "/terms": { file: "TERMS_OF_USE.md", title: "Terms of Use" },
  "/clinical-safety": { file: "CLINICAL_SAFETY_NOTICE.md", title: "Clinical Safety Notice" },
  "/acceptable-use": { file: "ACCEPTABLE_USE_POLICY.md", title: "Acceptable Use Policy" },
  "/subprocessors": { file: "SUBPROCESSORS.md", title: "Subprocessors" },
};

function legalDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("../../docs/legal", import.meta.url)),
    fileURLToPath(new URL("../../../docs/legal", import.meta.url)), // compiled: dist/server/routes
    join(process.cwd(), "docs/legal"),
  ];
  return candidates.find((d) => existsSync(d)) ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline Markdown on already-escaped text: code, bold, links, bare URLs, in-app paths. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, (_m, c: string) => (/^\/[a-z-]+$/.test(c) ? `<a href="${c}">${c}</a>` : `<code>${c}</code>`))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/\.md$/, "")}">${t}</a>`)
    .replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, '$1<a href="$2" rel="noopener">$2</a>');
}

/** A deliberately small Markdown subset — exactly what docs/legal uses. */
export function renderLegalMarkdown(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(" ")))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { flush(); i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); const n = h[1]!.length; out.push(`<h${n}>${inline(esc(h[2]!))}</h${n}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
    if (line.trim().startsWith("|")) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(lines[i++]!);
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(esc(c.trim())));
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      const [head, ...rest] = body;
      out.push("<div class=\"t\"><table><thead><tr>" + cells(head!).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>"
        + rest.map((r) => "<tr>" + cells(r).map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
      continue;
    }
    if (/^\s*([*-]|\d+\.)\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim()) {
        const l = lines[i]!;
        if (/^\s*([*-]|\d+\.)\s+/.test(l)) items.push(l.replace(/^\s*([*-]|\d+\.)\s+/, ""));
        else items[items.length - 1] += " " + l.trim();
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>` + items.map((t) => `<li>${inline(esc(t))}</li>`).join("") + `</${tag}>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

function page(title: string, body: string): string {
  const nav = Object.entries(PAGES).map(([p, v]) => `<a href="${p}">${esc(v.title)}</a>`).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — DocTurn</title><meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--fg:#0f172a;--mut:#475569;--bg:#ffffff;--line:#e2e8f0;--a:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--fg:#e2e8f0;--mut:#94a3b8;--bg:#0b1220;--line:#1e293b;--a:#93c5fd}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
nav{font-size:14px;color:var(--mut);border-bottom:1px solid var(--line);padding:12px 16px;text-align:center}
a{color:var(--a)}h1{font-size:28px;line-height:1.2;margin:8px 0 4px}h2{font-size:20px;margin:28px 0 8px}h3{font-size:17px}
p,li{color:var(--fg)}code{font-size:.9em}hr{border:0;border-top:1px solid var(--line);margin:28px 0}
.t{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
</style></head><body><nav><a href="/">DocTurn</a> · ${nav}</nav><main>${body}</main></body></html>`;
}

export function registerLegalRoutes(app: Express) {
  for (const [path, meta] of Object.entries(PAGES)) {
    app.get(path, (_req, res) => {
      const dir = legalDir();
      const file = dir ? join(dir, meta.file) : null;
      if (!file || !existsSync(file)) return res.status(404).type("text/plain").send("Not found");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.type("html").send(page(meta.title, renderLegalMarkdown(readFileSync(file, "utf8"))));
    });
  }
}
