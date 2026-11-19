import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";

/**
 * Request id (E1): every request gets one — the caller's `X-Request-Id` when
 * it is a plain token (letters, digits, `.`, `_`, `:`, `-`, 8–128 chars — so a
 * header can never inject into a log line), otherwise a fresh UUID — and it
 * is echoed on the response as `X-Request-Id`, carried in the JSON body of
 * every error the central error middleware answers (`requestId`, beside the
 * error code — never the database's text), and written on that middleware's
 * log line. A clinician reporting "it failed, id …" and the operator's log
 * then meet on one id without either side handling PHI. A reverse proxy that
 * sets its own id (Caddy, Render) is honoured so the id spans both logs.
 */
export const REQUEST_ID_HEADER = "X-Request-Id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}

/** The id assigned to this response ("-" before the middleware ran). */
export function requestIdOf(res: Pick<Response, "locals">): string {
  const id = (res.locals as { requestId?: unknown }).requestId;
  return typeof id === "string" ? id : "-";
}

export function isValidRequestId(id: string): boolean {
  return VALID_REQUEST_ID.test(id);
}
