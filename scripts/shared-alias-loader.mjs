// Registers the ESM resolver hook that maps the "@shared/*" TypeScript path
// alias to the compiled output under dist/shared/*. In dev we run via tsx, which
// honors tsconfig "paths"; the compiled production server
// (node dist/server/index.js) has no such rewriting, so Node cannot resolve bare
// "@shared/schema" imports on its own. This makes the compiled build runnable
// without touching any source import. Loaded via `node --import`.
import { register } from "node:module";
register("./shared-alias-hooks.mjs", import.meta.url);
