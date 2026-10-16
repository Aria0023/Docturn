import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  createTemplateVersionSchema,
  setLicenseSchema,
  toSafeUser,
  upsertConnectorSchema,
  upsertEhrConnectionSchema,
  type EhrConnection,
  type User,
} from "@shared/schema";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../auth.js";
import { appendAudit, logPhiAccess } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { assembleContext } from "../notes/context/assembler.js";
import { getAggregator, listConnectors, getConnector, queryFirstEnabled, runEnabledConnectors } from "../notes/connectors/registry.js";
import { mergeExternal } from "../notes/connectors/metriport.js";
import { toClipboardText } from "../notes/export/clipboard.js";
import { buildDocumentReference, writeBackDocumentReference } from "../notes/export/documentreference.js";
import { FhirClient } from "../notes/fhir/client.js";
import { generateNote } from "../notes/generation/engine.js";
import { parseTemplateModule, templateChecksum } from "../notes/generation/template.js";
import { checkLicense, periodKey, recordUsage } from "../notes/licensing.js";
import { createMockEhrRouter, MOCK_CLIENT_ID } from "../notes/mock-ehr.js";
import { decryptConfigSecrets, decryptSecret, encryptConfigSecrets, encryptSecret, redactConfigSecrets } from "../notes/secrets.js";
import { discoverSmartConfiguration } from "../notes/smart/discovery.js";
import {
  buildAuthorizeUrl,
  decodeIdTokenClaims,
  exchangeCode,
  makePkce,
  makeState,
  normalizeFhirUser,
  refreshAccessToken,
} from "../notes/smart/launch.js";
import type { ContextPackage, SmartPending, SmartSession, VisitInput } from "../notes/types.js";

declare module "express-session" {
  interface SessionData {
    smartPending?: SmartPending;
    smart?: SmartSession;
  }
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function publicBase(req: Request): string {
  const env = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (env) return env;
  const proto = (req.get("x-forwarded-proto") ?? req.protocol) || "http";
  return `${proto}://${req.get("host")}`;
}

function mockEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MOCK_EHR === "on";
}

/** Developer may act on another org via ?org=<id>; everyone else is their own org. */
function scopeOrg(req: Request): number {
  const me = currentUser(req);
  const q = Number(req.query.org);
  if (me.role === "developer" && Number.isFinite(q) && q > 0) return q;
  return me.organizationId;
}

function scopeIncludesWrite(scope: string): boolean {
  // SMART v1 ("patient/DocumentReference.write") and v2 ("patient/DocumentReference.cud") forms.
  return scope.split(/\s+/).some((s) => {
    const m = s.match(/^(?:patient|user|system)\/(DocumentReference|\*)\.([a-z*]+)/);
    if (!m) return false;
    const perm = m[2]!;
    return perm === "write" || perm === "*" || /[cu]/.test(perm);
  });
}

const sanitizeConnection = (c: EhrConnection) => {
  const { clientSecretEnc, ...rest } = c;
  return { ...rest, hasClientSecret: !!clientSecretEnc };
};

/** 409 unless a live SMART session for the caller's org is present (refreshing if possible). */
async function requireSmart(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: "unauthorized" });
  const me = currentUser(req);
  const smart = req.session.smart;
  if (!smart || smart.orgId !== me.organizationId) return res.status(409).json({ error: "no_smart_session" });
  if (smart.expiresAt < Date.now() + 30_000) {
    if (!smart.refreshToken) {
      delete req.session.smart;
      return res.status(409).json({ error: "smart_session_expired" });
    }
    try {
      const conn = await storage().getEhrConnection(smart.orgId, smart.connectionId);
      const t = await refreshAccessToken({
        tokenEndpoint: smart.tokenEndpoint,
        refreshToken: smart.refreshToken,
        clientId: conn?.clientId ?? "",
        clientSecret: decryptSecret(conn?.clientSecretEnc),
      });
      smart.accessToken = t.access_token;
      smart.refreshToken = t.refresh_token ?? smart.refreshToken;
      smart.expiresAt = Date.now() + (t.expires_in ?? 300) * 1000;
    } catch {
      delete req.session.smart;
      return res.status(409).json({ error: "smart_session_expired" });
    }
  }
  return next();
}

async function resolveLaunchUser(req: Request, conn: EhrConnection, fhirUser: string | undefined): Promise<User | undefined> {
  // 1. Existing link.
  if (fhirUser) {
    const link = await storage().getEhrUserLink(conn.id, fhirUser);
    if (link) return storage().getUserById(link.userId);
  }
  // 2. Already signed in to the same org (e.g. launched from inside DocTurn): link that user.
  const signedIn = req.isAuthenticated?.() ? currentUser(req) : undefined;
  if (signedIn && signedIn.organizationId === conn.organizationId) {
    if (fhirUser) await storage().createEhrUserLink({ organizationId: conn.organizationId, ehrConnectionId: conn.id, fhirUser, userId: signedIn.id });
    return signedIn;
  }
  // 3. Just-in-time provisioning from the EHR identity.
  if (!fhirUser || !conn.jitProvisioning) return undefined;
  const base = fhirUser.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ehr-user";
  let username = base;
  for (let i = 2; await storage().getUserByUsername(conn.organizationId, username); i++) username = `${base}-${i}`;
  const user = await storage().createUser({
    organizationId: conn.organizationId,
    username,
    passwordHash: await hashPassword(randomBytes(32).toString("hex")), // SSO-only account
    role: conn.jitRole,
    displayName: fhirUser.split("/").pop() ?? fhirUser,
    credential: null,
    phone: null,
    twoFactorEnabled: false,
  });
  await storage().createEhrUserLink({ organizationId: conn.organizationId, ehrConnectionId: conn.id, fhirUser, userId: user.id });
  await appendAudit({
    organizationId: conn.organizationId,
    userId: user.id,
    action: "notes.user_jit_provisioned",
    resourceType: "user",
    resourceId: user.id,
    details: { ehrConnectionId: conn.id, fhirUser },
    riskLevel: "medium",
  });
  return user;
}

async function beginAuthorize(
  req: Request,
  res: Response,
  conn: EhrConnection,
  issForDiscovery: string,
  launch: string | undefined,
) {
  const cfg = await discoverSmartConfiguration(issForDiscovery);
  const pkce = makePkce();
  const state = makeState();
  const redirectUri = `${publicBase(req)}/smart/callback`;
  const scope = launch
    ? conn.scopes
    : conn.scopes
        .split(/\s+/)
        .filter((s) => s !== "launch")
        .concat(conn.scopes.includes("launch/patient") ? [] : ["launch/patient"])
        .join(" ");
  req.session.smartPending = {
    orgId: conn.organizationId,
    connectionId: conn.id,
    state,
    codeVerifier: pkce.verifier,
    redirectUri,
    launch,
    authorizeEndpoint: cfg.authorization_endpoint,
    tokenEndpoint: cfg.token_endpoint,
    createdAt: Date.now(),
  };
  const url = buildAuthorizeUrl({
    authorizeEndpoint: cfg.authorization_endpoint,
    clientId: conn.clientId,
    redirectUri,
    scope,
    state,
    aud: issForDiscovery,
    codeChallenge: pkce.challenge,
    launch,
  });
  req.session.save(() => res.redirect(url));
}

/* ── request schemas ──────────────────────────────────────────────────────── */

const contextRequestSchema = z.object({
  includeExternal: z.boolean().optional(),
  includeKnowledge: z.boolean().optional(),
  visitSummary: z.string().max(4000).optional(),
});

const visitInputSchema = z.object({
  chiefComplaint: z.string().max(500).optional(),
  hpi: z.string().max(20000).optional(),
  ros: z.string().max(10000).optional(),
  exam: z.string().max(10000).optional(),
  assessment: z.string().max(10000).optional(),
  plan: z.string().max(10000).optional(),
  freeText: z.string().max(30000).optional(),
  admissionStatus: z.enum(["inpatient", "observation", "unspecified"]).optional(),
});

const generateSchema = z.object({
  context: z.object({ schemaVersion: z.literal(1), patient: z.object({ reference: z.string() }) }).passthrough(),
  visit: visitInputSchema.default({}),
  templateVersionId: z.number().int().positive().optional(),
});

const exportSchema = z.object({
  mode: z.enum(["clipboard", "documentreference"]),
  note: z.string().min(1).max(200000),
  templateVersionId: z.number().int().positive().optional(),
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  context: z.object({ schemaVersion: z.literal(1), patient: z.object({ reference: z.string() }) }).passthrough(),
});

/* ── routes ───────────────────────────────────────────────────────────────── */

export function registerNotesRoutes(app: Express) {
  if (mockEnabled()) app.use("/mock-ehr", createMockEhrRouter());

  const bigJson = express.json({ limit: "4mb" });
  const ADMIN = requireRole("director", "er_director", "developer");

  /* ─ SMART App Launch ─ */

  // EHR launch: the EHR opens <app>/smart/launch?iss=<fhir base>&launch=<opaque>
  app.get("/smart/launch", async (req, res) => {
    const iss = String(req.query.iss ?? "").replace(/\/+$/, "");
    const launch = req.query.launch ? String(req.query.launch) : undefined;
    const orgCode = req.query.org ? String(req.query.org).toUpperCase() : undefined;
    if (!iss || !launch) return res.status(400).json({ error: "missing_iss_or_launch" });
    try {
      let conns = await storage().findEhrConnectionsByIss(iss);
      if (!conns.length && mockEnabled() && /\/mock-ehr\/fhir$/.test(iss)) conns = await storage().findEhrConnectionsByVendor("mock");
      if (orgCode) {
        const org = await storage().getOrganizationByCode(orgCode);
        conns = conns.filter((c) => c.organizationId === org?.id);
      }
      const conn = conns[0];
      if (!conn) return res.status(404).json({ error: "unknown_ehr", iss });
      if (conns.length > 1 && !orgCode) return res.status(409).json({ error: "ambiguous_iss", hint: "pass ?org=<code>" });
      await beginAuthorize(req, res, conn, iss, launch);
    } catch (err) {
      console.error("[smart] launch failed", err);
      res.status(502).json({ error: "smart_launch_failed", detail: (err as Error).message });
    }
  });

  // Standalone launch: user starts from DocTurn (or a bookmark) and picks the patient in the EHR.
  app.get("/smart/standalone", async (req, res) => {
    const orgCode = String(req.query.org ?? "").toUpperCase();
    const connId = Number(req.query.connection);
    try {
      const org = orgCode ? await storage().getOrganizationByCode(orgCode) : undefined;
      const orgId = org?.id ?? (req.isAuthenticated?.() ? currentUser(req).organizationId : undefined);
      if (!orgId) return res.status(400).json({ error: "missing_org" });
      const conns = (await storage().listEhrConnections(orgId)).filter((c) => c.enabled);
      const conn = Number.isFinite(connId) && connId > 0 ? conns.find((c) => c.id === connId) : conns[0];
      if (!conn) return res.status(404).json({ error: "no_ehr_connection" });
      // The mock EHR's iss depends on this host; a real connection's iss is canonical.
      const iss = conn.vendor === "mock" && mockEnabled() ? `${publicBase(req)}/mock-ehr/fhir` : conn.iss;
      await beginAuthorize(req, res, conn, iss, undefined);
    } catch (err) {
      console.error("[smart] standalone failed", err);
      res.status(502).json({ error: "smart_launch_failed", detail: (err as Error).message });
    }
  });

  app.get("/smart/callback", async (req, res) => {
    const pending = req.session.smartPending;
    delete req.session.smartPending;
    if (req.query.error) return res.redirect(`/notes.html?error=${encodeURIComponent(String(req.query.error))}`);
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!pending || !code || state !== pending.state || Date.now() - pending.createdAt > 10 * 60_000) {
      return res.status(400).json({ error: "invalid_state" });
    }
    try {
      const conn = await storage().getEhrConnection(pending.orgId, pending.connectionId);
      if (!conn) return res.status(404).json({ error: "unknown_ehr" });
      const tok = await exchangeCode({
        tokenEndpoint: pending.tokenEndpoint,
        code,
        redirectUri: pending.redirectUri,
        clientId: conn.clientId,
        clientSecret: decryptSecret(conn.clientSecretEnc),
        codeVerifier: pending.codeVerifier,
      });
      const claims = decodeIdTokenClaims(tok.id_token, conn.clientId);
      const fhirUser = normalizeFhirUser(claims?.fhirUser);
      const user = await resolveLaunchUser(req, conn, fhirUser);
      if (!user) return res.status(403).json({ error: "user_not_provisioned", fhirUser });

      const issUsed = pending.launch || conn.vendor !== "mock" ? conn.iss : `${publicBase(req)}/mock-ehr/fhir`;
      const smart: SmartSession = {
        orgId: conn.organizationId,
        connectionId: conn.id,
        iss: conn.vendor === "mock" && mockEnabled() ? `${publicBase(req)}/mock-ehr/fhir` : issUsed,
        tokenEndpoint: pending.tokenEndpoint,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + (tok.expires_in ?? 300) * 1000,
        scope: tok.scope ?? "",
        patientId: tok.patient ? String(tok.patient) : undefined,
        encounterId: tok.encounter ? String(tok.encounter) : undefined,
        fhirUser,
        startedAt: Date.now(),
      };
      req.login(user as unknown as Express.User, (err) => {
        if (err) return res.status(500).json({ error: "login_failed" });
        req.session.smart = smart;
        void appendAudit({
          organizationId: conn.organizationId,
          userId: user.id,
          action: "notes.launch",
          resourceType: "ehr_connection",
          resourceId: conn.id,
          details: { vendor: conn.vendor, launchType: pending.launch ? "ehr" : "standalone", patient: smart.patientId ?? null, encounter: smart.encounterId ?? null },
          riskLevel: "low",
        });
        req.session.save(() => res.redirect("/notes.html"));
      });
    } catch (err) {
      console.error("[smart] callback failed", err);
      res.status(502).json({ error: "token_exchange_failed", detail: (err as Error).message });
    }
  });

  /* ─ Session ─ */

  app.get("/api/notes/session", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const smart = req.session.smart;
    if (!smart || smart.orgId !== me.organizationId) {
      const conns = (await storage().listEhrConnections(me.organizationId)).filter((c) => c.enabled);
      return res.json({ active: false, user: toSafeUser(me), connections: conns.map(sanitizeConnection), mockEhr: mockEnabled() });
    }
    const conn = await storage().getEhrConnection(smart.orgId, smart.connectionId);
    const tpl = await storage().getActiveTemplateVersion(me.organizationId);
    res.json({
      active: true,
      user: toSafeUser(me),
      patientId: smart.patientId,
      encounterId: smart.encounterId,
      fhirUser: smart.fhirUser,
      connection: conn ? { id: conn.id, name: conn.name, vendor: conn.vendor } : null,
      scope: smart.scope,
      expiresAt: smart.expiresAt,
      writeBack: !!conn?.writeBack && scopeIncludesWrite(smart.scope),
      template: tpl ? { id: tpl.id, name: tpl.name, version: tpl.version } : null,
      mockEhr: mockEnabled(),
    });
  });

  app.delete("/api/notes/session", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const had = !!req.session.smart;
    delete req.session.smart;
    delete req.session.smartPending;
    if (had) {
      await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "notes.session_discarded", resourceType: "smart_session", resourceId: null, details: {}, riskLevel: "low" });
    }
    req.session.save(() => res.json({ ok: true }));
  });

  /* ─ Context assembly ─ */

  app.post("/api/notes/context", requireAuth, requireSmart, bigJson, async (req, res) => {
    const me = currentUser(req);
    const smart = req.session.smart!;
    const parsed = contextRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const conn = await storage().getEhrConnection(smart.orgId, smart.connectionId);
    if (!conn) return res.status(404).json({ error: "unknown_ehr" });
    await logPhiAccess(req, "notes.context");
    try {
      let pkg = await assembleContext(smart, conn);
      const enabled = await storage().listOrgConnectors(me.organizationId);
      let externalReport: { ran: string[]; errors: Array<{ connector: string; error: string }> } = { ran: [], errors: [] };
      if (parsed.data.includeExternal) {
        for (const row of enabled.filter((r) => r.enabled && r.kind === "aggregator")) {
          const agg = getAggregator(row.connectorKey);
          if (!agg) continue;
          try {
            const ext = await agg.fetchConsolidated({
              patientReference: pkg.patient.reference,
              demographics: { age: pkg.patient.age, sex: pkg.patient.sex },
              config: decryptConfigSecrets(row.config),
            });
            pkg = mergeExternal(pkg, ext);
            externalReport.ran.push(row.connectorKey);
          } catch (err) {
            externalReport.errors.push({ connector: row.connectorKey, error: (err as Error).message });
          }
        }
      }
      let report = { ran: [] as string[], skipped: [] as string[], errors: [] as Array<{ connector: string; error: string }> };
      if (parsed.data.includeKnowledge !== false) {
        ({ pkg, report } = await runEnabledConnectors(me.organizationId, enabled, pkg, parsed.data.visitSummary));
      }
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "notes.context_assembled",
        resourceType: "smart_session",
        resourceId: null,
        details: {
          patient: smart.patientId ?? null,
          encounter: smart.encounterId ?? null,
          counts: { problems: pkg.problems.length, medications: pkg.medications.length, allergies: pkg.allergies.length, vitals: pkg.vitals.length, labs: pkg.labs.length, priorNotes: pkg.priorNotes.length, knowledge: pkg.knowledge.length },
          sources: pkg.provenance.sources,
          connectors: report.ran,
          external: externalReport.ran,
        },
        riskLevel: "low",
      });
      res.json({ context: pkg, knowledge: report, external: externalReport });
    } catch (err) {
      console.error("[notes] context failed", err);
      res.status(502).json({ error: "context_failed", detail: (err as Error).message });
    }
  });

  /* ─ Generation ─ */

  app.post("/api/notes/generate", requireAuth, requireSmart, bigJson, async (req, res) => {
    const me = currentUser(req);
    const smart = req.session.smart!;
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues.slice(0, 3) });
    const context = parsed.data.context as unknown as ContextPackage;
    // STRICT DATA ISOLATION: the package must belong to the launched patient.
    if (context.patient.reference !== `Patient/${smart.patientId}`) return res.status(409).json({ error: "context_patient_mismatch" });

    const lic = await checkLicense(me.organizationId, me.id, "generate");
    if (!lic.ok) return res.status(402).json({ error: "license", reason: lic.reason, usage: lic.usage });

    const tpl = parsed.data.templateVersionId
      ? await storage().getTemplateVersion(me.organizationId, parsed.data.templateVersionId)
      : await storage().getActiveTemplateVersion(me.organizationId);
    if (!tpl) return res.status(409).json({ error: "no_active_template" });
    if (tpl.status !== "active" && !["director", "er_director", "developer"].includes(me.role)) {
      return res.status(403).json({ error: "template_not_active" });
    }
    let module;
    try {
      module = parseTemplateModule(tpl.module);
    } catch {
      return res.status(500).json({ error: "template_invalid" });
    }
    await logPhiAccess(req, "notes.generate");
    const engineRow = (await storage().listOrgConnectors(me.organizationId)).find((r) => r.enabled && r.kind === "engine");
    const result = await generateNote({
      template: module,
      context,
      visit: parsed.data.visit as VisitInput,
      templateVersionId: tpl.id,
      templateName: tpl.name,
      templateVersion: tpl.version,
      engineConfig: engineRow ? decryptConfigSecrets(engineRow.config) : undefined,
    });
    await recordUsage(me.organizationId, me.id, "generate");
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "notes.generated",
      resourceType: "note_template_version",
      resourceId: tpl.id,
      details: { patient: smart.patientId ?? null, encounter: smart.encounterId ?? null, engine: result.engine, templateVersion: tpl.version, warnings: result.warnings.length, chars: result.text.length },
      riskLevel: "low",
    });
    res.json(result);
  });

  /* ─ Ad-hoc clinical question through the connector layer ─ */

  app.post("/api/notes/ask", requireAuth, requireSmart, bigJson, async (req, res) => {
    const me = currentUser(req);
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const enabled = await storage().listOrgConnectors(me.organizationId);
    const result = await queryFirstEnabled(me.organizationId, enabled, parsed.data.question, parsed.data.context as unknown as ContextPackage);
    if (!result) return res.status(409).json({ error: "no_query_connector" });
    await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "notes.asked", resourceType: "connector", resourceId: null, details: { connector: result.connector }, riskLevel: "low" });
    res.json(result);
  });

  /* ─ Export ─ */

  app.post("/api/notes/export", requireAuth, requireSmart, bigJson, async (req, res) => {
    const me = currentUser(req);
    const smart = req.session.smart!;
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const lic = await checkLicense(me.organizationId, me.id, "export");
    if (!lic.ok) return res.status(402).json({ error: "license", reason: lic.reason, usage: lic.usage });
    await logPhiAccess(req, "notes.export");

    if (parsed.data.mode === "clipboard") {
      await recordUsage(me.organizationId, me.id, "export");
      await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "notes.exported", resourceType: "smart_session", resourceId: null, details: { mode: "clipboard", patient: smart.patientId ?? null, encounter: smart.encounterId ?? null, chars: parsed.data.note.length }, riskLevel: "low" });
      return res.json({ ok: true, mode: "clipboard", text: toClipboardText(parsed.data.note) });
    }

    const conn = await storage().getEhrConnection(smart.orgId, smart.connectionId);
    if (!conn?.writeBack) return res.status(403).json({ error: "write_back_disabled" });
    if (!scopeIncludesWrite(smart.scope)) return res.status(403).json({ error: "write_scope_not_granted", scope: smart.scope });
    if (!smart.patientId) return res.status(409).json({ error: "no_patient_context" });
    const tpl = parsed.data.templateVersionId
      ? await storage().getTemplateVersion(me.organizationId, parsed.data.templateVersionId)
      : await storage().getActiveTemplateVersion(me.organizationId);
    if (!tpl) return res.status(409).json({ error: "no_active_template" });
    const module = parseTemplateModule(tpl.module);
    try {
      const doc = buildDocumentReference({
        noteText: parsed.data.note,
        patientId: smart.patientId,
        encounterId: smart.encounterId,
        practitionerRef: smart.fhirUser,
        template: module,
      });
      const written = await writeBackDocumentReference(new FhirClient(smart.iss, smart.accessToken), doc);
      await recordUsage(me.organizationId, me.id, "export");
      await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "notes.exported", resourceType: "smart_session", resourceId: null, details: { mode: "documentreference", patient: smart.patientId, encounter: smart.encounterId ?? null, documentReferenceId: written.id ?? null, chars: parsed.data.note.length }, riskLevel: "low" });
      res.json({ ok: true, mode: "documentreference", documentReferenceId: written.id, location: written.location });
    } catch (err) {
      console.error("[notes] write-back failed", err);
      res.status(502).json({ error: "write_back_failed", detail: (err as Error).message });
    }
  });

  /* ─ Admin: template versions ─ */

  app.get("/api/notes/templates/active", requireAuth, async (req, res) => {
    const tpl = await storage().getActiveTemplateVersion(scopeOrg(req));
    if (!tpl) return res.json(null);
    const m = parseTemplateModule(tpl.module);
    res.json({ id: tpl.id, name: tpl.name, version: tpl.version, platformDefault: tpl.organizationId == null, noteType: m.noteType, sections: m.sections.map((s) => s.title), hardLocks: m.hardLocks, engine: m.engine });
  });

  app.get("/api/notes/templates", requireAuth, ADMIN, async (req, res) => {
    const rows = await storage().listTemplateVersions(scopeOrg(req));
    res.json(rows.map((r) => ({ ...r, platformDefault: r.organizationId == null })));
  });

  app.post("/api/notes/templates", requireAuth, ADMIN, bigJson, async (req, res) => {
    const me = currentUser(req);
    const parsed = createTemplateVersionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    let module;
    try {
      module = parseTemplateModule(parsed.data.module);
    } catch (err) {
      return res.status(400).json({ error: "template_invalid", issues: (err as z.ZodError).issues?.slice(0, 5) });
    }
    // Developers may publish a PLATFORM default with ?scope=platform; otherwise org-scoped.
    const platform = me.role === "developer" && req.query.scope === "platform";
    const orgId = platform ? null : scopeOrg(req);
    const version = await storage().nextTemplateVersionNumber(orgId, parsed.data.name);
    const row = await storage().createTemplateVersion({
      organizationId: orgId,
      name: parsed.data.name,
      version,
      status: "draft",
      module: module as unknown as Record<string, unknown>,
      checksum: templateChecksum(module),
      changelog: parsed.data.changelog ?? null,
      createdBy: me.id,
    });
    await appendAudit({ organizationId: orgId, userId: me.id, action: "notes.template_created", resourceType: "note_template_version", resourceId: row.id, details: { name: row.name, version: row.version, checksum: row.checksum }, riskLevel: "medium" });
    const final = parsed.data.activate ? await storage().activateTemplateVersion(orgId, row.id, me.id) : row;
    if (parsed.data.activate) {
      await appendAudit({ organizationId: orgId, userId: me.id, action: "notes.template_activated", resourceType: "note_template_version", resourceId: row.id, details: { name: row.name, version: row.version }, riskLevel: "medium" });
    }
    res.status(201).json(final);
  });

  app.post("/api/notes/templates/:id/activate", requireAuth, ADMIN, async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const platform = me.role === "developer" && req.query.scope === "platform";
    const orgId = platform ? null : scopeOrg(req);
    const row = await storage().activateTemplateVersion(orgId, id, me.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    await appendAudit({ organizationId: orgId, userId: me.id, action: "notes.template_activated", resourceType: "note_template_version", resourceId: row.id, details: { name: row.name, version: row.version, checksum: row.checksum }, riskLevel: "medium" });
    res.json(row);
  });

  /* ─ Admin: connectors ─ */

  app.get("/api/notes/connectors", requireAuth, ADMIN, async (req, res) => {
    const rows = await storage().listOrgConnectors(scopeOrg(req));
    res.json({
      catalog: listConnectors(),
      enabled: rows.map((r) => ({ ...r, config: redactConfigSecrets(r.config) })),
    });
  });

  app.put("/api/notes/connectors/:key", requireAuth, ADMIN, async (req, res) => {
    const me = currentUser(req);
    const parsed = upsertConnectorSchema.safeParse({ ...req.body, connectorKey: req.params.key });
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const desc = listConnectors().find((d) => d.key === parsed.data.connectorKey) ?? (parsed.data.connectorKey === "engine" ? { key: "engine", kind: "engine" as const } : undefined);
    if (!desc) return res.status(404).json({ error: "unknown_connector" });
    const orgId = scopeOrg(req);
    const existing = (await storage().listOrgConnectors(orgId)).find((r) => r.connectorKey === parsed.data.connectorKey);
    // Keep stored secrets when the admin didn't resend them (UI shows a mask).
    const merged: Record<string, unknown> = { ...(existing?.config ?? {}), ...(parsed.data.config ?? {}) };
    for (const [k, v] of Object.entries(merged)) if (v === "••••••••") merged[k] = existing?.config[k];
    const row = await storage().upsertOrgConnector({
      organizationId: orgId,
      connectorKey: parsed.data.connectorKey,
      kind: desc.kind,
      enabled: parsed.data.enabled,
      priority: parsed.data.priority ?? existing?.priority ?? 100,
      config: encryptConfigSecrets(merged),
      updatedBy: me.id,
    });
    await appendAudit({ organizationId: orgId, userId: me.id, action: parsed.data.enabled ? "notes.connector_enabled" : "notes.connector_disabled", resourceType: "org_connector", resourceId: row.id, details: { connector: row.connectorKey, kind: row.kind, configKeys: Object.keys(merged) }, riskLevel: "medium" });
    res.json({ ...row, config: redactConfigSecrets(row.config) });
  });

  app.post("/api/notes/connectors/:key/healthcheck", requireAuth, ADMIN, async (req, res) => {
    const orgId = scopeOrg(req);
    const c = getConnector(String(req.params.key));
    if (!c?.healthcheck) return res.status(404).json({ error: "no_healthcheck" });
    const row = (await storage().listOrgConnectors(orgId)).find((r) => r.connectorKey === c.descriptor.key);
    res.json(await c.healthcheck({ config: decryptConfigSecrets(row?.config ?? {}), orgId }));
  });

  /* ─ Admin: EHR connections (per-org onboarding = config, not code) ─ */

  app.get("/api/notes/ehr", requireAuth, ADMIN, async (req, res) => {
    res.json((await storage().listEhrConnections(scopeOrg(req))).map(sanitizeConnection));
  });

  app.put("/api/notes/ehr", requireAuth, ADMIN, async (req, res) => {
    const me = currentUser(req);
    const parsed = upsertEhrConnectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues.slice(0, 3) });
    const orgId = scopeOrg(req);
    const d = parsed.data;
    const patch: Partial<EhrConnection> = {
      name: d.name,
      vendor: d.vendor,
      iss: d.iss.replace(/\/+$/, ""),
      clientId: d.clientId,
      ...(d.scopes ? { scopes: d.scopes } : {}),
      ...(d.writeBack != null ? { writeBack: d.writeBack } : {}),
      ...(d.jitProvisioning != null ? { jitProvisioning: d.jitProvisioning } : {}),
      ...(d.jitRole ? { jitRole: d.jitRole } : {}),
      ...(d.enabled != null ? { enabled: d.enabled } : {}),
      ...(d.clientSecret !== undefined ? { clientSecretEnc: d.clientSecret ? encryptSecret(d.clientSecret) : null } : {}),
    };
    const row = d.id
      ? await storage().updateEhrConnection(orgId, d.id, patch)
      : await storage().createEhrConnection({
          organizationId: orgId,
          name: d.name,
          vendor: d.vendor,
          iss: patch.iss!,
          clientId: d.clientId,
          clientSecretEnc: patch.clientSecretEnc ?? null,
          scopes: d.scopes ?? (undefined as unknown as string),
          writeBack: d.writeBack ?? true,
          jitProvisioning: d.jitProvisioning ?? true,
          jitRole: d.jitRole ?? "hospitalist",
          enabled: d.enabled ?? true,
        } as never);
    if (!row) return res.status(404).json({ error: "not_found" });
    await appendAudit({ organizationId: orgId, userId: me.id, action: d.id ? "notes.ehr_updated" : "notes.ehr_created", resourceType: "ehr_connection", resourceId: row.id, details: { vendor: row.vendor, iss: row.iss }, riskLevel: "medium" });
    res.status(d.id ? 200 : 201).json(sanitizeConnection(row));
  });

  /* ─ Licensing (developer sets; org admins read) ─ */

  app.get("/api/notes/license", requireAuth, ADMIN, async (req, res) => {
    const orgId = scopeOrg(req);
    const lic = await storage().getLicense(orgId);
    const usage = await storage().listLicenseUsage(orgId, periodKey());
    res.json({
      license: lic ?? null,
      usage: { periodKey: periodKey(), seatsUsed: usage.length, generations: usage.reduce((n, u) => n + u.generations, 0), exports: usage.reduce((n, u) => n + u.exports, 0) },
    });
  });

  app.put("/api/notes/license/:orgId", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    const orgId = Number(req.params.orgId);
    const parsed = setLicenseSchema.safeParse(req.body);
    if (!parsed.success || !Number.isFinite(orgId)) return res.status(400).json({ error: "validation_error" });
    const org = await storage().getOrganization(orgId);
    if (!org) return res.status(404).json({ error: "not_found" });
    const d = parsed.data;
    const row = await storage().upsertLicense({
      organizationId: orgId,
      plan: d.plan,
      status: d.status ?? "active",
      seats: d.seats ?? null,
      usageCap: d.usageCap ?? null,
      periodEnd: d.periodEnd ? new Date(d.periodEnd) : null,
      billingRef: d.billingRef ?? null,
    });
    await appendAudit({ organizationId: orgId, userId: me.id, action: "notes.license_set", resourceType: "license", resourceId: row.id, details: { plan: row.plan, status: row.status, seats: row.seats, usageCap: row.usageCap }, riskLevel: "medium" });
    res.json(row);
  });

  /* ─ Audit (metadata only — never content) ─ */

  app.get("/api/notes/audit", requireAuth, ADMIN, async (req, res) => {
    const rows = await storage().listAuditLogs(scopeOrg(req), 500);
    res.json(rows.filter((r) => r.action.startsWith("notes.")).slice(0, 200));
  });
}
