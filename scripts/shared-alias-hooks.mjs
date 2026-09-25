// Resolver hook (runs on a dedicated loader thread). Rewrites "@shared/*" to the
// compiled dist/shared/*.js files. See shared-alias-loader.mjs for how it's
// registered.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const distShared = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "shared") + "/",
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@shared" || specifier.startsWith("@shared/")) {
    const sub = specifier === "@shared" ? "index" : specifier.slice("@shared/".length);
    return nextResolve(new URL(sub + ".js", distShared).href, context);
  }
  return nextResolve(specifier, context);
}
