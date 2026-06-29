import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  passport,
  requireAuth,
  requireRole,
  assertSameOrg,
  hashPassword,
} from './auth.js';
import { sanitizeUser, messageDeliveryStatus } from '../shared/schema.js';

import {
  orgStore,
  userStore,
  hospitalistStore,
  patientStore,
  assignmentStore,
  conversationStore,
  messageStore,
  broadcastStore,
  deviceStore,
  settingsStore,
  flagStore,
  suggestionStore,
  auditStore,
  phiStore,
} from './storage.js';
import { aiExtractor } from './services/ai.js';
import { assignmentService } from './services/assignments.js';
import { notifications } from './services/notifications.js';
import { broadcast, presence } from './ws.js';
import { db, sqlite } from './db.js';

// Wrap async handlers so thrown errors hit the error middleware.
function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function buildRouter(): Router {
  const r = Router();

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  r.get('/health', (_req, res) => {
    let dbUp = false;
    try {
      sqlite.prepare('SELECT 1').get();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    res.json({ ok: true, db: dbUp ? 'up' : 'down' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  r.post('/login', (req, res, next) => {
    passport.authenticate('local', (err: any, user: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        auditStore.log({ orgId: user.orgId, userId: user.id, action: 'login' });
        return res.json(sanitizeUser(user));
      });
    })(req, res, next);
  });

  r.post('/logout', (req, res, next) => {
    const uid = req.user?.id;
    const oid = req.user?.orgId;
    req.logout((err) => {
      if (err) return next(err);
      if (uid) auditStore.log({ orgId: oid, userId: uid, action: 'logout' });
      res.json({ ok: true });
    });
  });

  r.get('/user', requireAuth, ah(async (req, res) => {
    const user = await userStore.getById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(sanitizeUser(user));
  }));

  const registerSchema = z.object({
    orgCode: z.string().min(2),
    username: z.string().min(3),
    password: z.string().min(6),
    role: z.enum(['director', 'er_director', 'er_doctor', 'hospitalist', 'developer']),
    fullName: z.string().min(1),
    email: z.string().email().optional(),
  });

  r.post('/register', ah(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid registration payload' });
    const { orgCode, username, password, role, fullName, email } = parsed.data;
    const org = await orgStore.getByCode(orgCode);
    if (!org) return res.status(400).json({ error: 'Unknown organization code' });
    const existing = await userStore.getByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const user = await userStore.create({
      orgId: org.id,
      username,
      passwordHash: hashPassword(password),
      role,
      fullName,
      email,
    });
    await auditStore.log({ orgId: org.id, userId: user.id, action: 'register' });
    res.status(201).json(sanitizeUser(user));
  }));

  // -------------------------------------------------------------------------
  // Providers / hospitalists
  // -------------------------------------------------------------------------
  r.get('/hospitalists', requireAuth, ah(async (req, res) => {
    const list = await hospitalistStore.listByOrg(req.user!.orgId);
    res.json(list);
  }));

  r.get('/hospitalists/working', requireAuth, ah(async (req, res) => {
    const list = await hospitalistStore.listWorking(req.user!.orgId);
    res.json(list);
  }));

  r.get('/directory', requireAuth, ah(async (req, res) => {
    const users = await userStore.listByOrg(req.user!.orgId);
    res.json(users.map(sanitizeUser));
  }));

  r.patch('/hospitalists/:id/working-status', requireAuth, requireRole('director', 'er_director'), ah(async (req, res) => {
    const id = Number(req.params.id);
    const h = await hospitalistStore.getById(id);
    if (!h) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, h.orgId);
    const isWorking = !!req.body.isWorking;
    const updated = await hospitalistStore.update(id, { isWorking });
    broadcast(h.orgId, { type: 'hospitalist.updated', hospitalistId: id, isWorking });
    res.json(updated);
  }));

  r.patch('/hospitalists/:id/capacity', requireAuth, requireRole('director', 'er_director'), ah(async (req, res) => {
    const id = Number(req.params.id);
    const h = await hospitalistStore.getById(id);
    if (!h) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, h.orgId);
    const capacity = Number(req.body.capacity);
    if (!Number.isFinite(capacity) || capacity < 0) return res.status(400).json({ error: 'Invalid capacity' });
    const updated = await hospitalistStore.update(id, { capacity });
    res.json(updated);
  }));

  const createHospSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(6),
    fullName: z.string().min(1),
    specialty: z.string().optional(),
    capacity: z.number().int().positive().optional(),
    shiftType: z.enum(['day', 'night', 'swing']).optional(),
    isWorking: z.boolean().optional(),
  });

  r.post('/director/hospitalists', requireAuth, requireRole('director'), ah(async (req, res) => {
    const parsed = createHospSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid hospitalist payload' });
    const orgId = req.user!.orgId;
    const existing = await userStore.getByUsername(parsed.data.username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const user = await userStore.create({
      orgId,
      username: parsed.data.username,
      passwordHash: hashPassword(parsed.data.password),
      role: 'hospitalist',
      fullName: parsed.data.fullName,
    });
    const existingHosp = await hospitalistStore.listByOrg(orgId);
    const h = await hospitalistStore.create({
      orgId,
      userId: user.id,
      specialty: parsed.data.specialty ?? 'General',
      capacity: parsed.data.capacity ?? 12,
      shiftType: parsed.data.shiftType ?? 'day',
      isWorking: parsed.data.isWorking ?? false,
      rotationOrder: existingHosp.length,
    });
    await auditStore.log({ orgId, userId: req.user!.id, action: 'hospitalist_created', targetType: 'hospitalist', targetId: h.id });
    res.status(201).json(h);
  }));

  r.patch('/director/hospitalists/reorder', requireAuth, requireRole('director'), ah(async (req, res) => {
    const order: number[] = Array.isArray(req.body.order) ? req.body.order : [];
    for (let i = 0; i < order.length; i++) {
      const h = await hospitalistStore.getById(order[i]);
      if (h && h.orgId === req.user!.orgId) {
        await hospitalistStore.update(order[i], { rotationOrder: i });
      }
    }
    const list = await hospitalistStore.listByOrg(req.user!.orgId);
    res.json(list);
  }));

  r.delete('/director/hospitalists/:id', requireAuth, requireRole('director'), ah(async (req, res) => {
    const id = Number(req.params.id);
    const h = await hospitalistStore.getById(id);
    if (!h) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, h.orgId);
    await hospitalistStore.delete(id);
    await auditStore.log({ orgId: h.orgId, userId: req.user!.id, action: 'hospitalist_deleted', targetType: 'hospitalist', targetId: id });
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------------------
  // Org config
  // -------------------------------------------------------------------------
  r.get('/org/config', requireAuth, ah(async (req, res) => {
    const org = await orgStore.getById(req.user!.orgId);
    if (!org) return res.status(404).json({ error: 'Not found' });
    const settings = await settingsStore.getOrgSettings(org.id);
    res.json({ ...org, settings });
  }));

  r.patch('/org/config', requireAuth, requireRole('director', 'er_director'), ah(async (req, res) => {
    const orgId = req.user!.orgId;
    const patch: Record<string, unknown> = {};
    if (typeof req.body.name === 'string') patch.name = req.body.name;
    if (typeof req.body.timezone === 'string') patch.timezone = req.body.timezone;
    if (Number.isFinite(req.body.assignmentTimeoutMin)) patch.assignmentTimeoutMin = Number(req.body.assignmentTimeoutMin);
    const updated = Object.keys(patch).length ? await orgStore.update(orgId, patch) : await orgStore.getById(orgId);
    res.json(updated);
  }));

  r.post('/org/round-robin/reset', requireAuth, requireRole('director', 'er_director'), ah(async (req, res) => {
    const updated = await orgStore.resetRoundRobin(req.user!.orgId);
    await auditStore.log({ orgId: req.user!.orgId, userId: req.user!.id, action: 'round_robin_reset' });
    res.json(updated);
  }));

  // -------------------------------------------------------------------------
  // Patients (+ AI extract)
  // -------------------------------------------------------------------------
  r.post('/patients/extract', requireAuth, requireRole('er_doctor', 'er_director'), ah(async (req, res) => {
    const text: string = typeof req.body.text === 'string' ? req.body.text : '';
    if (!text.trim()) return res.status(400).json({ error: 'text is required' });
    const extracted = aiExtractor.extract(text, { initials: req.body.initials, room: req.body.room });
    res.json(extracted);
  }));

  const createPatientSchema = z.object({
    initials: z.string().min(1).max(4),
    fullName: z.string().optional(),
    room: z.string().optional(),
    chiefComplaint: z.string().optional(),
    diagnosis: z.string().optional(),
    riskLevel: z.enum(['low', 'medium', 'high']).optional(),
    structuredData: z.any().optional(),
  });

  r.post('/patients', requireAuth, requireRole('er_doctor', 'er_director'), ah(async (req, res) => {
    const parsed = createPatientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid patient payload' });
    const orgId = req.user!.orgId;
    const patient = await patientStore.create({
      orgId,
      initials: parsed.data.initials.toUpperCase(),
      fullName: parsed.data.fullName,
      room: parsed.data.room,
      chiefComplaint: parsed.data.chiefComplaint,
      diagnosis: parsed.data.diagnosis,
      riskLevel: parsed.data.riskLevel ?? 'low',
      status: 'waiting',
      structuredData: parsed.data.structuredData ? JSON.stringify(parsed.data.structuredData) : undefined,
      createdByUserId: req.user!.id,
    });
    await phiStore.log({ orgId, userId: req.user!.id, patientId: patient.id, action: 'patient_created' });
    broadcast(orgId, { type: 'patient.created', patientId: patient.id, initials: patient.initials });
    res.status(201).json(patient);
  }));

  r.get('/patients', requireAuth, ah(async (req, res) => {
    const list = await patientStore.listByOrg(req.user!.orgId);
    res.json(list);
  }));

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------
  const createAssignmentSchema = z.object({
    patientId: z.number().int().positive(),
    hospitalistId: z.number().int().positive().optional(),
    capRelief: z.boolean().optional(),
  });

  r.post('/assignments', requireAuth, requireRole('er_doctor', 'er_director', 'director'), ah(async (req, res) => {
    const parsed = createAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid assignment payload' });
    const result = await assignmentService.create({
      orgId: req.user!.orgId,
      patientId: parsed.data.patientId,
      hospitalistId: parsed.data.hospitalistId,
      assignedByUserId: req.user!.id,
      capRelief: parsed.data.capRelief,
    });
    if (!result.assignment) return res.status(409).json({ error: `Assignment failed: ${result.reason}` });
    res.status(201).json(result.assignment);
  }));

  r.get('/assignments/pending', requireAuth, ah(async (req, res) => {
    const list = await assignmentStore.listPendingByOrg(req.user!.orgId);
    res.json(list);
  }));

  r.get('/assignments/my', requireAuth, ah(async (req, res) => {
    const h = await hospitalistStore.getByUserId(req.user!.id);
    if (!h) return res.json([]);
    const list = await assignmentStore.listByHospitalist(h.id);
    res.json(list);
  }));

  async function loadAssignmentForActor(req: Request, res: Response) {
    const id = Number(req.params.id);
    const a = await assignmentStore.getById(id);
    if (!a) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    await assertSameOrg(req, a.orgId);
    return a;
  }

  r.patch('/assignments/:id/accept', requireAuth, requireRole('hospitalist'), ah(async (req, res) => {
    const a = await loadAssignmentForActor(req, res);
    if (!a) return;
    const result = await assignmentService.accept(a.id, req.user!.id);
    if (result.error) return res.status(409).json({ error: result.error });
    broadcast(a.orgId, { type: 'assignment.accepted', assignmentId: a.id });
    res.json(result.assignment);
  }));

  r.patch('/assignments/:id/reject', requireAuth, requireRole('hospitalist'), ah(async (req, res) => {
    const a = await loadAssignmentForActor(req, res);
    if (!a) return;
    const result = await assignmentService.reject(a.id, req.user!.id, req.body.reason);
    if (result.error) return res.status(409).json({ error: result.error });
    broadcast(a.orgId, { type: 'assignment.rejected', assignmentId: a.id, reassignedId: result.reassigned?.id ?? null });
    res.json({ assignment: result.assignment, reassigned: result.reassigned });
  }));

  r.patch('/assignments/:id/reassign', requireAuth, requireRole('director', 'er_director', 'er_doctor'), ah(async (req, res) => {
    const a = await loadAssignmentForActor(req, res);
    if (!a) return;
    const result = await assignmentService.reassign(a.id, req.user!.id, req.body.hospitalistId);
    if (result.error) return res.status(409).json({ error: result.error });
    broadcast(a.orgId, { type: 'assignment.reassigned', assignmentId: a.id, reassignedId: result.reassigned?.id ?? null });
    res.json({ assignment: result.assignment, reassigned: result.reassigned });
  }));

  r.patch('/assignments/:id/cancel', requireAuth, requireRole('director', 'er_director', 'er_doctor', 'hospitalist'), ah(async (req, res) => {
    const a = await loadAssignmentForActor(req, res);
    if (!a) return;
    const result = await assignmentService.cancel(a.id, req.user!.id);
    if (result.error) return res.status(409).json({ error: result.error });
    broadcast(a.orgId, { type: 'assignment.cancelled', assignmentId: a.id });
    res.json(result.assignment);
  }));

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------
  function isParticipant(participantIds: string, userId: number): boolean {
    try {
      return (JSON.parse(participantIds) as number[]).includes(userId);
    } catch {
      return false;
    }
  }

  r.get('/messaging/conversations', requireAuth, ah(async (req, res) => {
    const list = await conversationStore.listForUser(req.user!.orgId, req.user!.id);
    res.json(list);
  }));

  const createConversationSchema = z.object({
    type: z.enum(['direct', 'group', 'emergency']).default('direct'),
    title: z.string().optional(),
    participantIds: z.array(z.number().int().positive()).min(1),
  });

  r.post('/messaging/conversations', requireAuth, ah(async (req, res) => {
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid conversation payload' });
    const participants = Array.from(new Set([req.user!.id, ...parsed.data.participantIds]));
    // All participants must be in the same org.
    for (const pid of participants) {
      const u = await userStore.getById(pid);
      if (!u || u.orgId !== req.user!.orgId) return res.status(400).json({ error: 'Participant not in org' });
    }
    const conv = await conversationStore.create({
      orgId: req.user!.orgId,
      type: parsed.data.type,
      title: parsed.data.title,
      participantIds: JSON.stringify(participants),
      createdByUserId: req.user!.id,
    });
    res.status(201).json(conv);
  }));

  r.get('/messaging/conversations/:id/messages', requireAuth, ah(async (req, res) => {
    const conv = await conversationStore.getById(Number(req.params.id));
    if (!conv) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, conv.orgId);
    if (req.user!.role !== 'developer' && !isParticipant(conv.participantIds, req.user!.id)) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    const msgs = await messageStore.listByConversation(conv.id);
    res.json(msgs.map((m) => (m.deleted ? { ...m, body: '[deleted]' } : m)));
  }));

  const sendMessageSchema = z.object({ body: z.string().min(1) });

  r.post('/messaging/send', requireAuth, ah(async (req, res) => {
    const body = req.body as { conversationId: number; content: string };
    const conv = await conversationStore.getById(Number(body.conversationId));
    if (!conv) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, conv.orgId);
    if (!isParticipant(conv.participantIds, req.user!.id)) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    const parsed = sendMessageSchema.safeParse({ body: body.content });
    if (!parsed.success) return res.status(400).json({ error: 'Message body required' });
    const msg = await messageStore.create({
      orgId: conv.orgId,
      conversationId: conv.id,
      senderId: req.user!.id,
      body: parsed.data.body,
    });
    const participants: number[] = JSON.parse(conv.participantIds);
    const recipients = participants.filter((p) => p !== req.user!.id);
    await messageStore.createDeliveryStatus(msg.id, recipients);
    await notifications.cascade({
      orgId: conv.orgId,
      userIds: recipients,
      event: 'message.new',
      title: 'New message',
      body: 'You have a new secure message',
      data: { conversationId: conv.id, messageId: msg.id },
    });
    res.status(201).json(msg);
  }));

  r.post('/messaging/messages/mark-read', requireAuth, ah(async (req, res) => {
    const { messageIds } = req.body as { messageIds: number[] };
    if (!Array.isArray(messageIds)) return res.status(400).json({ error: 'messageIds required' });
    const readAt = Math.floor(Date.now() / 1000);
    for (const msgId of messageIds) {
      await db.update(messageDeliveryStatus)
        .set({ readAt })
        .where(and(eq(messageDeliveryStatus.messageId, msgId), eq(messageDeliveryStatus.userId, req.user!.id)))
        .run();
    }
    res.status(204).end();
  }));

  r.delete('/messaging/messages/:id', requireAuth, ah(async (req, res) => {
    const msg = await messageStore.getById(Number(req.params.id));
    if (!msg) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, msg.orgId);
    if (msg.senderId !== req.user!.id && req.user!.role !== 'developer' && req.user!.role !== 'director') {
      return res.status(403).json({ error: 'Cannot delete this message' });
    }
    await messageStore.softDelete(msg.id);
    res.json({ ok: true });
  }));

  // Keep the old /conversations/:id/messages route for backward compat
  r.post('/conversations/:id/messages', requireAuth, ah(async (req, res) => {
    const conv = await conversationStore.getById(Number(req.params.id));
    if (!conv) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, conv.orgId);
    if (!isParticipant(conv.participantIds, req.user!.id)) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Message body required' });
    const msg = await messageStore.create({
      orgId: conv.orgId,
      conversationId: conv.id,
      senderId: req.user!.id,
      body: parsed.data.body,
    });
    const participants: number[] = JSON.parse(conv.participantIds);
    const recipients = participants.filter((p) => p !== req.user!.id);
    await messageStore.createDeliveryStatus(msg.id, recipients);
    await notifications.cascade({
      orgId: conv.orgId,
      userIds: recipients,
      event: 'message.new',
      title: 'New message',
      body: 'You have a new secure message',
      data: { conversationId: conv.id, messageId: msg.id },
    });
    res.status(201).json(msg);
  }));

  r.post('/messaging/conversations/:id/mark-read', requireAuth, ah(async (req, res) => {
    const conv = await conversationStore.getById(Number(req.params.id));
    if (!conv) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, conv.orgId);
    if (!isParticipant(conv.participantIds, req.user!.id)) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    const count = await messageStore.markRead(conv.id, req.user!.id);
    res.json({ ok: true, marked: count });
  }));

  r.delete('/messages/:id', requireAuth, ah(async (req, res) => {
    const msg = await messageStore.getById(Number(req.params.id));
    if (!msg) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, msg.orgId);
    if (msg.senderId !== req.user!.id && req.user!.role !== 'developer' && req.user!.role !== 'director') {
      return res.status(403).json({ error: 'Cannot delete this message' });
    }
    const updated = await messageStore.softDelete(msg.id);
    await auditStore.log({ orgId: msg.orgId, userId: req.user!.id, action: 'message_deleted', targetType: 'message', targetId: msg.id });
    res.json({ ok: true, message: updated });
  }));

  // -------------------------------------------------------------------------
  // Broadcasts
  // -------------------------------------------------------------------------
  const broadcastSchema = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high']).optional(),
  });

  r.post('/broadcasts', requireAuth, requireRole('director', 'er_director'), ah(async (req, res) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid broadcast payload' });
    const b = await broadcastStore.create({
      orgId: req.user!.orgId,
      senderId: req.user!.id,
      title: parsed.data.title,
      body: parsed.data.body,
      severity: parsed.data.severity ?? 'high',
    });
    broadcast(req.user!.orgId, { type: 'broadcast.new', broadcastId: b.id, title: b.title, severity: b.severity });
    res.status(201).json(b);
  }));

  r.post('/broadcasts/:id/ack', requireAuth, ah(async (req, res) => {
    const b = await broadcastStore.getById(Number(req.params.id));
    if (!b) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, b.orgId);
    const ack = await broadcastStore.ack(b.id, req.user!.id);
    res.json(ack);
  }));

  r.get('/broadcasts/:id/status', requireAuth, ah(async (req, res) => {
    const b = await broadcastStore.getById(Number(req.params.id));
    if (!b) return res.status(404).json({ error: 'Not found' });
    await assertSameOrg(req, b.orgId);
    const acks = await broadcastStore.listAcks(b.id);
    res.json({ broadcast: b, acknowledgments: acks });
  }));

  // -------------------------------------------------------------------------
  // Developer endpoints
  // -------------------------------------------------------------------------
  r.get('/dev/organizations', requireAuth, requireRole('developer'), ah(async (_req, res) => {
    res.json(await orgStore.list());
  }));

  r.post('/dev/organizations', requireAuth, requireRole('developer'), ah(async (req, res) => {
    const { name, code, timezone, assignmentTimeoutMin } = req.body ?? {};
    if (!name || !code) return res.status(400).json({ error: 'name and code required' });
    const existing = await orgStore.getByCode(code);
    if (existing) return res.status(409).json({ error: 'Org code taken' });
    const org = await orgStore.create({ name, code, timezone, assignmentTimeoutMin });
    res.status(201).json(org);
  }));

  r.patch('/dev/organizations/:id', requireAuth, requireRole('developer'), ah(async (req, res) => {
    const id = Number(req.params.id);
    const org = await orgStore.getById(id);
    if (!org) return res.status(404).json({ error: 'Not found' });
    const updated = await orgStore.update(id, req.body ?? {});
    res.json(updated);
  }));

  r.post('/dev/impersonate', requireAuth, requireRole('developer'), ah(async (req, res) => {
    const targetUserId = Number(req.body.userId);
    const target = await userStore.getById(targetUserId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    await auditStore.log({
      orgId: target.orgId,
      userId: req.user!.id,
      action: 'developer_impersonate',
      targetType: 'user',
      targetId: target.id,
    });
    req.login(
      { id: target.id, orgId: target.orgId, role: target.role as any, username: target.username, fullName: target.fullName },
      (err) => {
        if (err) return res.status(500).json({ error: 'Impersonation failed' });
        res.json(sanitizeUser(target));
      },
    );
  }));

  r.get('/dev/ai-diagnostics', requireAuth, requireRole('developer'), ah(async (_req, res) => {
    const sample = aiExtractor.extract('Patient with chest pain in room 101. History of hypertension.');
    res.json({
      provider: 'MockAIExtractor',
      deterministic: true,
      sample,
    });
  }));

  // -------------------------------------------------------------------------
  // Settings / flags / suggestions
  // -------------------------------------------------------------------------
  r.get('/settings', requireAuth, ah(async (req, res) => {
    const org = await settingsStore.getOrgSettings(req.user!.orgId);
    const user = await settingsStore.getUserPrefs(req.user!.id);
    res.json({ org, user });
  }));

  r.patch('/settings', requireAuth, ah(async (req, res) => {
    const { scope, key, value } = req.body ?? {};
    if (!key || typeof value === 'undefined') return res.status(400).json({ error: 'key and value required' });
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    if (scope === 'org') {
      if (req.user!.role !== 'director' && req.user!.role !== 'developer') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const updated = await settingsStore.setOrgSetting(req.user!.orgId, key, strVal);
      return res.json(updated);
    }
    const updated = await settingsStore.setUserPref(req.user!.id, key, strVal);
    res.json(updated);
  }));

  r.get('/feature-flags', requireAuth, ah(async (req, res) => {
    res.json(await flagStore.listByOrg(req.user!.orgId));
  }));

  r.patch('/feature-flags', requireAuth, requireRole('director', 'developer'), ah(async (req, res) => {
    const { key, enabled, description } = req.body ?? {};
    if (!key) return res.status(400).json({ error: 'key required' });
    const orgId = req.user!.role === 'developer' && req.body.global ? null : req.user!.orgId;
    const updated = await flagStore.set(orgId, key, !!enabled, description);
    res.json(updated);
  }));

  r.get('/suggestions', requireAuth, ah(async (req, res) => {
    res.json(await suggestionStore.listByOrg(req.user!.orgId));
  }));

  r.post('/suggestions', requireAuth, ah(async (req, res) => {
    const { title, body } = req.body ?? {};
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const s = await suggestionStore.create({ orgId: req.user!.orgId, userId: req.user!.id, title, body });
    res.status(201).json(s);
  }));

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------
  r.get('/presence', requireAuth, ah(async (req, res) => {
    res.json({ online: presence(req.user!.orgId) });
  }));

  // -------------------------------------------------------------------------
  // Mobile
  // -------------------------------------------------------------------------
  r.get('/mobile/org/:code', ah(async (req, res) => {
    const org = await orgStore.getByCode(req.params.code);
    if (!org || !org.active) return res.status(404).json({ error: 'Org not found' });
    res.json({ id: org.id, name: org.name, code: org.code, timezone: org.timezone });
  }));

  r.get('/mobile/assignments', requireAuth, ah(async (req, res) => {
    const h = await hospitalistStore.getByUserId(req.user!.id);
    if (!h) return res.json([]);
    const list = await assignmentStore.listByHospitalist(h.id);
    // PHI-free: only patient initials surfaced.
    const enriched = await Promise.all(
      list.map(async (a) => {
        const p = await patientStore.getById(a.patientId);
        return { id: a.id, status: a.status, via: a.via, patientInitials: p?.initials ?? '??', room: p?.room ?? null, expiresAt: a.expiresAt };
      }),
    );
    res.json(enriched);
  }));

  const deviceTokenSchema = z.object({ token: z.string().min(1), platform: z.enum(['ios', 'android', 'web']).optional() });

  r.post('/mobile/device-tokens', requireAuth, ah(async (req, res) => {
    const parsed = deviceTokenSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'token required' });
    const dt = await deviceStore.register(req.user!.id, parsed.data.token, parsed.data.platform ?? 'ios');
    res.status(201).json(dt);
  }));

  r.delete('/mobile/device-tokens', requireAuth, ah(async (req, res) => {
    const token = req.body?.token ?? req.query.token;
    if (!token) return res.status(400).json({ error: 'token required' });
    await deviceStore.remove(String(token));
    res.json({ ok: true });
  }));

  return r;
}
