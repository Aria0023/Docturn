import type { Express } from "express";
import { z } from "zod";
import { HANDOFF_SEVERITY, type PatientHandoff, type User } from "@shared/schema";
import { appendAudit, logPhiAccess } from "../audit.js";
import { isModuleEnabled } from "../modules.js";
import { parseId } from "../params.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * Hand-off notes (module shift.handoffNotes).
 *
 * The physician responsible for a patient writes what the next physician
 * needs: how sick (stable / watch closely / unstable), a summary, and what to
 * watch or do. A note can be addressed to a colleague at any time; ending a
 * shift with a covering provider addresses every unaddressed note to them.
 * The receiver acknowledges each one, and the writer sees that they did.
 *
 * Notes are clinical text: read access is one PHI row per request, audit
 * rows carry ids only, and the alert to the receiver says only that notes
 * are waiting.
 */
const ROLES = ["hospitalist", "director"] as const;
const noCtl = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]*$/;
const noteSchema = z.object({
  severity: z.enum(HANDOFF_SEVERITY),
  summary: z.string().trim().max(600).regex(noCtl).default(""),
  todo: z.string().trim().max(600).regex(noCtl).default(""),
  toUserId: z.number().int().positive().nullable().optional(),
});

function alertReceiver(userId: number, count: number) {
  const { ws, push } = notificationDeps();
  try {
    ws.sendToUsers([userId], { type: "HANDOFF_RECEIVED", count });
  } catch {
    /* live frame is best-effort; the list is the record */
  }
  void push.send(userId, { title: "Hand-off notes waiting" }).catch(() => {});
}

/** Address every unaddressed newest note of `fromUser`'s patients to `toUserId`. Returns how many. */
export async function addressHandoffsOnShiftEnd(orgId: number, fromUser: Pick<User, "id">, toUserId: number): Promise<number> {
  if (!(await isModuleEnabled(orgId, "shift.handoffNotes"))) return 0;
  const profile = await storage().getHospitalistByUser(orgId, fromUser.id);
  if (!profile) return 0;
  const mine = new Set((await storage().listPatients(orgId)).filter((p) => p.assignedHospitalistId === profile.id && p.status !== "discharged").map((p) => p.id));
  const newest = new Map<number, PatientHandoff>();
  for (const h of await storage().listHandoffs(orgId)) if (mine.has(h.patientId) && !newest.has(h.patientId)) newest.set(h.patientId, h);
  const ids = [...newest.values()].filter((h) => h.fromUserId === fromUser.id && h.toUserId == null).map((h) => h.id);
  const done = await storage().addressHandoffs(orgId, ids, toUserId);
  if (done.length) alertReceiver(toUserId, done.length);
  return done.length;
}

export function registerHandoffRoutes(app: Express) {
  // My patients with their newest note, and the notes handed to me.
  app.get("/api/handoffs", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const orgId = me.organizationId;
    const [profile, patients, notes, users, identityOn] = await Promise.all([
      storage().getHospitalistByUser(orgId, me.id),
      storage().listPatients(orgId),
      storage().listHandoffs(orgId),
      storage().listUsers(orgId),
      isModuleEnabled(orgId, "patients.identity"),
    ]);
    await logPhiAccess(req, "handoffs");
    const name = new Map(users.map((u) => [u.id, u.displayName]));
    const pById = new Map(patients.map((p) => [p.id, p]));
    const newest = new Map<number, PatientHandoff>();
    for (const h of notes) if (!newest.has(h.patientId)) newest.set(h.patientId, h);
    const patientOf = (id: number) => {
      const p = pById.get(id)!;
      return { id: p.id, initials: p.initials, room: p.roomNumber, issue: p.issueSummary, fullName: identityOn ? p.fullName : null, dateOfBirth: identityOn ? p.dateOfBirth : null, mrn: identityOn ? p.mrn : null };
    };
    const noteOf = (h: PatientHandoff) => ({
      id: h.id, severity: h.severity, summary: h.summary, todo: h.todo, createdAt: h.createdAt,
      fromName: name.get(h.fromUserId) ?? null, toUserId: h.toUserId, toName: h.toUserId != null ? name.get(h.toUserId) ?? null : null,
      acknowledgedAt: h.acknowledgedAt,
    });
    const mine = profile
      ? patients.filter((p) => p.assignedHospitalistId === profile.id && p.status !== "discharged").map((p) => {
          const n = newest.get(p.id);
          return { patient: patientOf(p.id), note: n ? noteOf(n) : null };
        })
      : [];
    // Handed to me: the newest note of each patient, when it is addressed to me.
    const incoming = [...newest.values()]
      .filter((h) => h.toUserId === me.id && pById.has(h.patientId) && pById.get(h.patientId)!.status !== "discharged")
      .map((h) => ({ patient: patientOf(h.patientId), note: noteOf(h) }));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      mine,
      incoming,
      colleagues: users.filter((u) => u.id !== me.id && !u.disabledAt && (u.role === "hospitalist" || u.role === "director")).map((u) => ({ id: u.id, name: u.displayName })),
    });
  });

  // Save the note for one of MY patients (a new version each time).
  app.put("/api/handoffs/:id", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const orgId = me.organizationId;
    const patientId = parseId(req.params.id);
    const parsed = noteSchema.safeParse(req.body);
    if (patientId == null) return res.status(404).json({ error: "not_found" });
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    if (!parsed.data.summary && !parsed.data.todo) return res.status(400).json({ error: "empty_note" });
    const [patient, profile] = await Promise.all([storage().getPatient(orgId, patientId), storage().getHospitalistByUser(orgId, me.id)]);
    if (!patient) return res.status(404).json({ error: "not_found" });
    // Only the physician responsible for the patient writes its hand-off.
    if (!profile || patient.assignedHospitalistId !== profile.id) return res.status(403).json({ error: "not_your_patient" });
    let toUserId: number | null = null;
    if (parsed.data.toUserId != null) {
      const to = await storage().getUser(orgId, parsed.data.toUserId);
      if (!to || to.disabledAt || to.id === me.id || (to.role !== "hospitalist" && to.role !== "director")) return res.status(400).json({ error: "receiver_invalid" });
      toUserId = to.id;
    }
    const row = await storage().createHandoff({
      organizationId: orgId, patientId, fromUserId: me.id, toUserId,
      severity: parsed.data.severity, summary: parsed.data.summary, todo: parsed.data.todo,
    });
    await logPhiAccess(req, "handoffs", { resourceId: row.id, patientId });
    await appendAudit({
      organizationId: orgId, userId: me.id, action: "handoff.write", resourceType: "patient", resourceId: patientId,
      details: { severity: row.severity, addressed: toUserId != null }, riskLevel: "low",
    });
    if (toUserId != null) alertReceiver(toUserId, 1);
    res.status(201).json({ id: row.id });
  });

  // The receiver has read it.
  app.post("/api/handoffs/:id/ack", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params.id);
    if (id == null) return res.status(404).json({ error: "not_found" });
    const row = await storage().ackHandoff(me.organizationId, id, me.id, new Date());
    if (!row) {
      // Already acknowledged by me is fine; anything else is not mine to acknowledge.
      const mine = (await storage().listHandoffs(me.organizationId)).find((h) => h.id === id && h.toUserId === me.id);
      return res.status(mine ? 204 : 404).end();
    }
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: "handoff.ack", resourceType: "patient", resourceId: row.patientId,
      details: { handoffId: row.id }, riskLevel: "low",
    });
    try {
      notificationDeps().ws.sendToUsers([row.fromUserId], { type: "HANDOFF_ACKED", handoffId: row.id });
    } catch { /* best-effort */ }
    res.status(204).end();
  });
}
