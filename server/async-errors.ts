/**
 * Express 4 does not look at the value a handler RETURNS, so an `async`
 * handler whose promise rejects never reaches the error middleware: the request
 * hangs (socket pinned until the client gives up), the rejection is only seen
 * by the process-level "unhandledRejection" hook, and the JSON error shape the
 * client expects is never sent. (Express 5 fixes this; this project is on 4.)
 *
 * Rather than hand-wrapping every one of the ~130 async handlers — and relying
 * on every future route author remembering to — patch the ONE place Express
 * calls a handler: `Layer.prototype.handle_request` / `handle_error`. If the
 * handler returns a thenable, attach a rejection handler that forwards to
 * `next(err)`, which lands in the JSON error middleware in server/app.ts.
 * This is the same technique the `express-async-errors` package uses; it is
 * inlined here because that package is not a dependency and the patch is
 * twelve lines.
 *
 * Importing this module (for its side effect) once is enough: Layer methods
 * are looked up on the prototype at call time, so handlers registered before
 * or after the import are both covered. The patch is idempotent.
 */
import { createRequire } from "node:module";
import type { NextFunction, Request, Response } from "express";

type AnyHandler = (...args: unknown[]) => unknown;
interface LayerLike {
  handle: AnyHandler;
}
interface LayerCtor {
  prototype: {
    handle_request: (this: LayerLike, req: Request, res: Response, next: NextFunction) => void;
    handle_error: (
      this: LayerLike,
      err: unknown,
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void;
    [PATCHED]?: true;
  };
}

const PATCHED = Symbol.for("docturn.asyncErrorsPatched");

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    !!v &&
    (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

/** Forward a rejected handler promise to `next`, exactly once. */
function guard(result: unknown, next: NextFunction): void {
  if (!isThenable(result)) return;
  let done = false;
  Promise.resolve(result).then(undefined, (err: unknown) => {
    if (done) return;
    done = true;
    // A handler that rejects with a non-Error (string/undefined) must still
    // reach the error middleware as an Error so it is logged and answered.
    next(err instanceof Error ? err : new Error(String(err ?? "handler rejected")));
  });
}

export function installAsyncErrorForwarding(): void {
  const require = createRequire(import.meta.url);
  const Layer = require("express/lib/router/layer.js") as LayerCtor;
  const proto = Layer.prototype;
  if (proto[PATCHED]) return;

  proto.handle_request = function handle_request(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // an error handler — not for this phase
    try {
      guard(fn(req, res, next), next);
    } catch (err) {
      next(err);
    }
  };

  proto.handle_error = function handle_error(err, req, res, next) {
    const fn = this.handle;
    if (fn.length !== 4) return next(err); // not an error handler
    try {
      guard(fn(err, req, res, next), next);
    } catch (e) {
      next(e);
    }
  };

  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });
}

installAsyncErrorForwarding();
