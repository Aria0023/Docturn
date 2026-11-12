import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  PLATFORM_ORG_CODE,
  purchaseRequestCreateSchema,
  purchaseRequestPatchSchema,
  type PurchaseRequest,
} from "@shared/schema";
import { appendAudit } from "../audit.js";
import { REGISTER_RATE_LIMIT, RATE_LIMIT_RESPONSE, clientIpKey, getRateLimitState } from "../config.js";
import { DatabaseRateLimitStore } from "../rate-limit-store.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * The public marketing website and its purchase path.
 *
 *   GET   /home                           the website (static, self-contained)
 *   GET   /site/*                         its images
 *   GET   /api/public/plans               plans the operator marked "show on website"
 *   POST  /api/public/purchase-request    an order request (no session)
 *   GET   /api/dev/purchase-requests      operator: every request
 *   PATCH /api/dev/purchase-requests/:id  operator: new → contacted → converted / declined
 *
 * A hospital cannot click-buy: a purchase needs an order form and a signed
 * BAA. "Purchase" therefore files a real request the operator turns into a
 * contract (developer console → Billing). Prices come ONLY from plans the
 * operator typed and published — the site never invents one. Business
 * contact details only; the form says not to enter patient information.
 */
function siteDir(): string | null {
  const candidates = [
    fileURLToPath(new URL("../../webapp/site", import.meta.url)),
    fileURLToPath(new URL("../../../webapp/site", import.meta.url)), // compiled: dist/server/routes
    join(process.cwd(), "webapp/site"),
  ];
  return candidates.find((d) => existsSync(join(d, "index.html"))) ?? null;
}

export function publicPurchaseRequest(r: PurchaseRequest) {
  return {
    id: r.id,
    organizationName: r.organizationName,
    contactName: r.contactName,
    contactTitle: r.contactTitle,
    email: r.email,
    phone: r.phone,
    planCode: r.planCode,
    seats: r.seats,
    term: r.term,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function registerWebsiteRoutes(app: Express) {
  const dir = siteDir();

  app.get(["/home", "/home/"], (_req, res) => {
    if (!dir) return res.status(404).type("text/plain").send("Website not found");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(dir, "index.html"));
  });
  app.get("/pricing", (_req, res) => res.redirect("/home#pricing"));
  if (dir) app.use("/site", express.static(dir, { index: false, maxAge: "1h" }));

  app.get("/api/public/plans", async (_req, res) => {
    const plans = (await storage().listBillingPlans(false)).filter((p) => p.showOnWebsite);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      plans: plans.map((p) => ({ code: p.code, name: p.name, perSeatPriceCents: p.perSeatPriceCents, currency: p.currency })),
    });
  });

  // Every request counts (201s included), like self-registration: the form is
  // an unauthenticated write that lands in the operator's queue.
  const limitState = getRateLimitState();
  const orderLimiter: RequestHandler = limitState.enabled
    ? rateLimit({
        ...REGISTER_RATE_LIMIT,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: clientIpKey,
        message: RATE_LIMIT_RESPONSE,
        ...(limitState.store === "database" ? { store: new DatabaseRateLimitStore("buy") } : {}),
      })
    : (_req, _res, next) => next();

  app.post("/api/public/purchase-request", orderLimiter, async (req, res) => {
    const parsed = purchaseRequestCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")))].filter(Boolean);
      return res.status(400).json({ error: "validation_error", fields });
    }
    const d = parsed.data;
    // Honeypot: people never see the field, so a filled one is a bot. Answer
    // like success so the bot learns nothing, and keep nothing.
    if (d.website && d.website.trim()) return res.status(201).json({ ok: true });

    let planCode: string | null = null;
    if (d.planCode) {
      if (d.planCode === "pilot") planCode = "pilot";
      else {
        const plan = await storage().getBillingPlanByCode(d.planCode);
        if (!plan || plan.archivedAt || !plan.showOnWebsite) return res.status(400).json({ error: "unknown_plan" });
        planCode = plan.code;
      }
    }
    const saved = await storage().createPurchaseRequest({
      organizationName: d.organizationName,
      contactName: d.contactName,
      contactTitle: d.contactTitle || null,
      email: d.email.toLowerCase(),
      phone: d.phone || null,
      planCode,
      seats: d.seats,
      term: d.term,
      message: d.message || null,
      sourceIp: clientIpKey(req),
    });
    const platform = await storage().getOrganizationByCode(PLATFORM_ORG_CODE);
    if (platform) {
      await appendAudit({
        organizationId: platform.id,
        userId: null,
        action: "website.purchase_request",
        resourceType: "purchase_request",
        resourceId: saved.id,
        details: { planCode, seats: saved.seats, term: saved.term },
        riskLevel: "low",
      });
    }
    res.status(201).json({ ok: true, reference: `DT-${String(saved.id).padStart(5, "0")}` });
  });

  app.get("/api/dev/purchase-requests", requireAuth, requireRole("developer"), async (_req, res) => {
    const rows = await storage().listPurchaseRequests();
    res.json({ requests: rows.map(publicPurchaseRequest) });
  });

  app.patch("/api/dev/purchase-requests/:id", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "validation_error" });
    const parsed = purchaseRequestPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const saved = await storage().setPurchaseRequestStatus(id, parsed.data.status);
    if (!saved) return res.status(404).json({ error: "not_found" });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "website.purchase_request_status",
      resourceType: "purchase_request",
      resourceId: id,
      details: { status: saved.status },
      riskLevel: "low",
    });
    res.json({ request: publicPurchaseRequest(saved) });
  });
}
