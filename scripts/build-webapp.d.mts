// Types for scripts/build-webapp.mjs (imported by tests/webapp-static.test.ts).

export interface ParsedScript {
  start: number;
  end: number;
  attrs: Record<string, string>;
  type: string;
  src: string | null;
  content: string;
  kind: "babel" | "js" | "other";
}

export interface BuildManifestFile {
  bytes: number;
  br: number;
  gzip: number;
  sha256: string;
}

export interface WebappBuildManifest {
  schema: number;
  version: string;
  builtAt: string;
  babel: string;
  index: string;
  bundles: { runtime: string | null; compiled: string[]; css: string[] };
  files: Record<string, BuildManifestFile>;
  precache: string[];
  sources: Record<string, string>;
}

export const BUILD_MANIFEST: string;
export const BUILD_SCHEMA: number;
export function parseAttrs(raw: string): Record<string, string>;
export function parseScripts(html: string): ParsedScript[];
export function parseLinks(html: string): Array<{ start: number; end: number; attrs: Record<string, string> }>;
export function localPath(url: string | undefined | null): string | null;
export function staticShellAssets(srcDir: string, html: string, scriptTexts: string[]): string[];
export function babelOptionsFor(attrs: Record<string, string>, filename: string): Record<string, unknown>;
export function buildWebapp(opts?: {
  srcDir?: string;
  outDir?: string;
  log?: (msg: string) => void;
}): Promise<WebappBuildManifest>;
