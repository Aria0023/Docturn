import { isRealPhiMode } from "../phi-preflight.js";
import { demoPassword } from "../seed.js";
import { storage } from "../storage.js";

/**
 * Live demo: makes a SYNTHETIC-DATA organization come alive for a sales call.
 *
 * Every few seconds the driver acts as one of the organization's seeded demo
 * accounts through the app's REAL endpoints (signed in over loopback with the
 * demo password), so what viewers see — new admission requests, accepts,
 * routine/urgent/STAT messages, consult requests and answers — are genuine app
 * events with the usual realtime updates, alerts and audit rows.
 *
 * Safety rails:
 *   • refused outright on a real-PHI instance (SYNTHETIC_DATA=false);
 *   • only accounts that sign in with the demo password can be driven;
 *   • it never acts AS an account that has the app open (a "viewer": any
 *     account that polled the demo status in the last 20 s), and it leaves
 *     requests, consults and STATs addressed to viewers for them to handle;
 *   • it stops by itself after 30 minutes, and it holds the patient count down.
 */

export type DemoPace = "steady" | "busy";
export type DemoMode = "free" | "story";
let STORY_TICK_MS = 1500;
let STORY_DWELL_MS = 13_000;
let STORY_WAIT_MS = 45_000;
const TICK_MS: Record<DemoPace, number> = { steady: 9000, busy: 5000 };
const RUN_MS = 30 * 60_000;
const VIEWER_WINDOW_MS = 20_000;
let RESPOND_AFTER_MS = 25_000;
let STAT_ACK_AFTER_MS = 30_000;

/** Tests only: shorter delays so a run can be observed in seconds. */
export function _setDemoTimingForTests(t: { tickMs?: number; respondAfterMs?: number; statAckAfterMs?: number; storyDwellMs?: number; storyWaitMs?: number; storyTickMs?: number }) {
  if (t.tickMs) { TICK_MS.steady = t.tickMs; TICK_MS.busy = t.tickMs; }
  if (t.respondAfterMs != null) RESPOND_AFTER_MS = t.respondAfterMs;
  if (t.statAckAfterMs != null) STAT_ACK_AFTER_MS = t.statAckAfterMs;
  if (t.storyDwellMs != null) STORY_DWELL_MS = t.storyDwellMs;
  if (t.storyWaitMs != null) STORY_WAIT_MS = t.storyWaitMs;
  if (t.storyTickMs != null) STORY_TICK_MS = t.storyTickMs;
}
const MAX_OPEN_PATIENTS = 18;

interface DemoUser { id: number; username: string; role: string; displayName: string }
interface DemoEvent { at: string; text: string }
interface Run {
  orgId: number;
  orgCode: string;
  base: string;
  pace: DemoPace;
  mode: DemoMode;
  story: StoryState | null;
  startedAt: number;
  endsAt: number;
  startedBy: number;
  timer: NodeJS.Timeout | null;
  ticking: boolean;
  events: DemoEvent[];
  sessions: Map<number, string>;
  refused: Set<number>;
  statAcks: Array<{ messageId: number; recipientId: number; due: number }>;
  counts: { admissions: number; accepted: number; messages: number; stat: number; consults: number; answered: number };
}

const runs = new Map<number, Run>();
const viewers = new Map<number, Map<number, number>>();

export function liveDemoAvailable(): boolean {
  return !isRealPhiMode();
}

/** A signed-in account looked at the app (status poll): never act as it for a while. */
export function noteViewer(orgId: number, userId: number) {
  let m = viewers.get(orgId);
  if (!m) viewers.set(orgId, (m = new Map()));
  m.set(userId, Date.now());
}
function isViewer(orgId: number, userId: number): boolean {
  const t = viewers.get(orgId)?.get(userId);
  return t != null && Date.now() - t < VIEWER_WINDOW_MS;
}
function viewerIds(orgId: number): number[] {
  const m = viewers.get(orgId);
  if (!m) return [];
  const now = Date.now();
  return [...m.entries()].filter(([, t]) => now - t < VIEWER_WINDOW_MS).map(([id]) => id);
}

export function liveDemoStatus(orgId: number) {
  const r = runs.get(orgId);
  if (!r) return { available: liveDemoAvailable(), running: false as const };
  return {
    available: true,
    running: true as const,
    pace: r.pace,
    mode: r.mode,
    story: r.story ? storyView(r.story) : null,
    startedAt: new Date(r.startedAt).toISOString(),
    endsAt: new Date(r.endsAt).toISOString(),
    counts: r.counts,
    events: r.events.slice(0, 12),
  };
}

export function stopLiveDemo(orgId: number): boolean {
  const r = runs.get(orgId);
  if (!r) return false;
  if (r.timer) clearInterval(r.timer);
  runs.delete(orgId);
  // Sign the driver's sessions out so a run leaves nothing behind.
  for (const cookie of r.sessions.values()) {
    void fetch(r.base + "/api/logout", { method: "POST", headers: { Cookie: cookie, "X-Forwarded-Proto": "https" } }).catch(() => {});
  }
  r.sessions.clear();
  return true;
}

export function stopAllLiveDemos() {
  for (const id of [...runs.keys()]) stopLiveDemo(id);
}

function schedule(run: Run) {
  if (run.timer) clearInterval(run.timer);
  const every = run.mode === "story" ? STORY_TICK_MS : TICK_MS[run.pace];
  run.timer = setInterval(() => void (run.mode === "story" ? storyTick(run) : tick(run)), every);
  setTimeout(() => void (run.mode === "story" ? storyTick(run) : tick(run)), Math.min(1200, every));
}

export function startLiveDemo(opts: { orgId: number; orgCode: string; base: string; pace: DemoPace; startedBy: number; mode?: DemoMode }) {
  if (!liveDemoAvailable()) throw new Error("real_phi_mode");
  const mode: DemoMode = opts.mode ?? "free";
  const existing = runs.get(opts.orgId);
  if (existing) {
    existing.pace = opts.pace;
    if (opts.mode && opts.mode !== existing.mode) {
      existing.mode = opts.mode;
      existing.story = opts.mode === "story" ? newStory() : null;
    }
    existing.endsAt = Date.now() + RUN_MS;
    schedule(existing);
    return existing;
  }
  const run: Run = {
    orgId: opts.orgId, orgCode: opts.orgCode, base: opts.base, pace: opts.pace, startedBy: opts.startedBy,
    mode,
    story: mode === "story" ? newStory() : null,
    startedAt: Date.now(),
    endsAt: Date.now() + RUN_MS,
    timer: null,
    ticking: false,
    events: [],
    sessions: new Map(),
    refused: new Set(),
    statAcks: [],
    counts: { admissions: 0, accepted: 0, messages: 0, stat: 0, consults: 0, answered: 0 },
  };
  runs.set(opts.orgId, run);
  schedule(run);
  return run;
}

/** Presenter controls for the guided story: next step, pause, resume, replay. */
export function storyControl(orgId: number, action: "next" | "pause" | "resume" | "replay"): boolean {
  const r = runs.get(orgId);
  if (!r || r.mode !== "story" || !r.story) return false;
  const st = r.story;
  if (action === "pause") st.paused = true;
  else if (action === "resume") { st.paused = false; if (st.beatDoneAt) st.beatDoneAt = Date.now(); }
  else if (action === "next") st.skip = true;
  else if (action === "replay") { r.story = newStory(); }
  return true;
}

/* ── HTTP as a demo account ─────────────────────────────────────────────── */

async function signIn(run: Run, u: DemoUser): Promise<string | null> {
  if (run.refused.has(u.id)) return null;
  const r = await fetch(run.base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    body: JSON.stringify({ orgCode: run.orgCode, username: u.username, password: demoPassword() }),
  }).catch(() => null);
  // Only a refused sign-in (wrong password, deactivated) rules the account
  // out for the run; a busy or failing server is retried on the next tick.
  if (!r || !r.ok) { if (r && (r.status === 401 || r.status === 403)) run.refused.add(u.id); return null; }
  const cookies = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) { run.refused.add(u.id); return null; }
  run.sessions.set(u.id, cookie);
  return cookie;
}

async function as(run: Run, u: DemoUser, method: string, path: string, body?: unknown): Promise<{ status: number; json: any } | null> {
  if (isViewer(run.orgId, u.id)) return null; // never act as someone who has the app open
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = run.sessions.get(u.id) ?? (await signIn(run, u));
    if (!cookie) return null;
    const r = await fetch(run.base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-Forwarded-Proto": "https" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!r) return null;
    if (r.status === 401 && attempt === 0) { run.sessions.delete(u.id); continue; }
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  return null;
}

/* ── the script ─────────────────────────────────────────────────────────── */

const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(Math.random() * xs.length)] : undefined);
const LETTERS = "ABCDEFGHJKLMNPRSTVW";
const COMPLAINTS: Array<[string, number]> = [
  ["Chest pain, troponin pending", 2], ["Sepsis, suspected pneumonia", 2], ["COPD exacerbation", 3], ["CHF exacerbation", 3],
  ["DKA", 2], ["GI bleed, stable", 2], ["Syncope, telemetry", 3], ["Cellulitis, failed outpatient therapy", 4],
  ["Altered mental status", 2], ["Acute kidney injury", 3], ["Pyelonephritis", 3], ["New atrial fibrillation, RVR", 2],
  ["Hyponatremia", 3], ["Fall with hip pain, ortho consulted", 3], ["Pancreatitis", 3], ["Stroke alert, out of window", 2],
];
const SPECIALTIES = ["Cardiology", "Nephrology", "Pulmonology", "Gastroenterology", "Infectious Disease", "Neurology"];
const MESSAGES: Record<"routine" | "urgent" | "stat", string[]> = {
  routine: [
    "Labs are back on {p}. Potassium 3.4, repleting.",
    "Family for {p} would like an update this morning.",
    "Can you co-sign the med rec for {p}?",
    "{p} is cleared by PT for discharge tomorrow.",
    "Bed assigned for {p}, moving up to the floor.",
    "Thanks for taking the last admit. I owe you one.",
  ],
  urgent: [
    "{p} spiking to 39.1, cultures drawn. Can you take a look?",
    "Pressure soft on {p}, 88/50 after fluids. Please call when free.",
    "Nurse reports new confusion on {p}.",
    "{p} desatting to 88% on 2L.",
  ],
  stat: [
    "Rapid response on {p}. Need you at bedside.",
    "{p} now in RVR 160s, hypotensive. Please come now.",
    "Troponin up sharply on {p}. Repeat ECG changed.",
  ],
};

function log(run: Run, text: string) {
  run.events.unshift({ at: new Date().toISOString(), text });
  run.events.length = Math.min(run.events.length, 40);
}

async function demoUsers(orgId: number): Promise<DemoUser[]> {
  const rows = await storage().listUsers(orgId);
  return rows
    .filter((u) => !u.disabledAt && u.username && ["hospitalist", "er_doctor", "er_director", "director"].includes(String(u.role)))
    .map((u) => ({ id: u.id, username: u.username, role: String(u.role), displayName: u.displayName ?? u.username }));
}

async function tick(run: Run) {
  if (run.ticking || runs.get(run.orgId) !== run) return; // stopped
  if (Date.now() > run.endsAt) { stopLiveDemo(run.orgId); return; }
  run.ticking = true;
  try {
    await dueStatAcks(run);
    const users = await demoUsers(run.orgId);
    // Anything that has waited long enough gets its answer first (an accept,
    // a consult reply), so the story moves forward; then something new happens.
    if (await accept(run, users)) return;
    if (await answerConsult(run, users)) return;
    const roll = Math.random();
    const steps =
      roll < 0.40 ? [admit, message, consult] :
      roll < 0.78 ? [message, admit, consult] :
                    [consult, message, admit];
    for (const step of steps) {
      if (await step(run, users)) break;
    }
  } catch (e) {
    console.warn("[demo-live] tick failed:", (e as Error).message);
  } finally {
    run.ticking = false;
  }
}

async function admit(run: Run, users: DemoUser[]): Promise<boolean> {
  const open = (await storage().listPatients(run.orgId)).filter((p) => p.status !== "discharged");
  if (open.length >= MAX_OPEN_PATIENTS) return false;
  const er = pick(users.filter((u) => (u.role === "er_doctor" || u.role === "er_director") && !isViewer(run.orgId, u.id)));
  if (!er) return false;
  const [issue, esi] = pick(COMPLAINTS)!;
  const initials = LETTERS[Math.floor(Math.random() * LETTERS.length)]! + LETTERS[Math.floor(Math.random() * LETTERS.length)]!;
  const room = "ER-" + String(1 + Math.floor(Math.random() * 24)).padStart(2, "0");
  const p = await as(run, er, "POST", "/api/patients", { initials, roomNumber: room, issueSummary: issue, acuity: esi, department: "ER" });
  if (!p || p.status !== 201) return false;
  // Round-robin, as the ER does. But when a watched hospitalist (the presenter)
  // already has two requests waiting, send this one to a named colleague (the
  // ER's manual option) so the rest of the service keeps moving too.
  const hosp = (await storage().listHospitalists(run.orgId)).filter((h) => h.working && h.currentPatientCount < h.patientCap);
  const pendingBy = new Map<number, number>();
  for (const x of await storage().listAssignments(run.orgId)) if (x.status === "pending") pendingBy.set(x.hospitalistId, (pendingBy.get(x.hospitalistId) ?? 0) + 1);
  const viewerBacklog = hosp.some((h) => isViewer(run.orgId, h.userId) && (pendingBy.get(h.id) ?? 0) >= 2);
  const other = viewerBacklog ? pick(hosp.filter((h) => !isViewer(run.orgId, h.userId) && (pendingBy.get(h.id) ?? 0) < 2)) : undefined;
  const a = await as(run, er, "POST", "/api/assignments", other ? { patientId: p.json.id, mode: "manual", hospitalistId: other.id } : { patientId: p.json.id, mode: "round_robin" });
  run.counts.admissions++;
  log(run, a && a.status === 201 ? `ER sent ${initials} (${room}, ESI ${esi}) to ${other ? "a named hospitalist" : "the next hospitalist"}` : `ER added ${initials} (${room}); no hospitalist available`);
  return true;
}

async function accept(run: Run, users: DemoUser[]): Promise<boolean> {
  const hosp = await storage().listHospitalists(run.orgId);
  const pending = (await storage().listAssignments(run.orgId))
    .filter((a) => a.status === "pending" && Date.now() - new Date(a.createdAt).getTime() > RESPOND_AFTER_MS);
  for (const a of pending) {
    const h = hosp.find((x) => x.id === a.hospitalistId);
    const u = h && users.find((x) => x.id === h.userId);
    if (!u || isViewer(run.orgId, u.id)) continue; // a viewer's request is theirs to accept
    const r = await as(run, u, "PATCH", `/api/assignments/${a.id}/accept`, {});
    if (r && r.status < 300) { run.counts.accepted++; log(run, `${u.displayName} accepted an admission`); return true; }
  }
  return false;
}

async function patientLabel(orgId: number): Promise<string> {
  const ps = (await storage().listPatients(orgId)).filter((p) => p.status !== "discharged");
  const p = pick(ps);
  return p ? `${p.initials}${p.roomNumber ? " in " + p.roomNumber : ""}` : "bed 12";
}

async function directConversation(run: Run, sender: DemoUser, recipient: DemoUser): Promise<number | null> {
  const mine = await storage().listConversationsForUser(run.orgId, sender.id);
  const hit = mine.find((c) => c.type === "direct" && !c.patientId && c.participantIds.length === 2 && c.participantIds.includes(recipient.id));
  if (hit) return hit.id;
  const r = await as(run, sender, "POST", "/api/messaging/conversations", { type: "direct", participantIds: [recipient.id] });
  return r && r.status === 201 ? r.json.id : null;
}

async function message(run: Run, users: DemoUser[]): Promise<boolean> {
  const senders = users.filter((u) => !isViewer(run.orgId, u.id));
  const sender = pick(senders);
  if (!sender) return false;
  const watching = viewerIds(run.orgId).map((id) => users.find((u) => u.id === id)).filter(Boolean) as DemoUser[];
  const others = users.filter((u) => u.id !== sender.id);
  const recipient = (watching.length && Math.random() < 0.75 ? pick(watching.filter((u) => u.id !== sender.id)) : undefined) ?? pick(others);
  if (!recipient) return false;
  const r = Math.random();
  const priority: "routine" | "urgent" | "stat" = r < 0.16 ? "stat" : r < 0.42 ? "urgent" : "routine";
  const cid = await directConversation(run, sender, recipient);
  if (!cid) return false;
  const content = pick(MESSAGES[priority])!.replace("{p}", await patientLabel(run.orgId));
  const sent = await as(run, sender, "POST", "/api/messaging/send", { conversationId: cid, content, priority });
  if (!sent || sent.status >= 300) return false;
  run.counts.messages++;
  if (priority === "stat") {
    run.counts.stat++;
    const id = Number(sent.json?.id ?? sent.json?.message?.id);
    if (id) run.statAcks.push({ messageId: id, recipientId: recipient.id, due: Date.now() + STAT_ACK_AFTER_MS + Math.random() * (STAT_ACK_AFTER_MS / 2) });
  }
  log(run, `${priority === "routine" ? "Message" : priority.toUpperCase() + " message"} from ${sender.displayName} to ${recipient.displayName}`);
  return true;
}

async function dueStatAcks(run: Run) {
  const users = await demoUsers(run.orgId);
  const now = Date.now();
  const due = run.statAcks.filter((s) => s.due <= now);
  run.statAcks = run.statAcks.filter((s) => s.due > now);
  for (const s of due) {
    const u = users.find((x) => x.id === s.recipientId);
    if (!u || isViewer(run.orgId, u.id)) continue; // the viewer acknowledges their own STAT
    const r = await as(run, u, "POST", "/api/messaging/messages/ack", { messageIds: [s.messageId] });
    if (r && r.status < 300) log(run, `${u.displayName} acknowledged a STAT`);
  }
}

async function consult(run: Run, users: DemoUser[]): Promise<boolean> {
  const patients = (await storage().listPatients(run.orgId)).filter((p) => p.status === "assigned" && p.assignedHospitalistId);
  const p = pick(patients);
  if (!p) return false;
  const hosp = await storage().listHospitalists(run.orgId);
  const owner = users.find((u) => u.id === hosp.find((h) => h.id === p.assignedHospitalistId)?.userId);
  if (!owner || isViewer(run.orgId, owner.id)) return false;
  const named = Math.random() < 0.5 ? pick(users.filter((u) => u.role === "hospitalist" && u.id !== owner.id)) : undefined;
  const specialty = named ? "Hospital Medicine" : pick(SPECIALTIES)!;
  const body = named ? { specialty, consultantUserId: named.id } : { specialty };
  const r = await as(run, owner, "POST", `/api/patients/${p.id}/consults`, body);
  if (!r || r.status >= 300) return false;
  run.counts.consults++;
  log(run, `${owner.displayName} requested ${named ? "a consult from " + named.displayName : specialty + " for " + p.initials}`);
  return true;
}

async function answerConsult(run: Run, users: DemoUser[]): Promise<boolean> {
  const open = (await storage().listConsultsForOrg(run.orgId))
    .filter((c) => c.status === "requested" && c.consultantUserId && Date.now() - new Date(c.createdAt).getTime() > RESPOND_AFTER_MS);
  for (const c of open) {
    const u = users.find((x) => x.id === c.consultantUserId);
    if (!u || isViewer(run.orgId, u.id)) continue;
    const r = await as(run, u, "PATCH", `/api/consults/${c.id}`, { status: Math.random() < 0.85 ? "accepted" : "declined" });
    if (r && r.status < 300) { run.counts.answered++; log(run, `${u.displayName} answered a consult`); return true; }
  }
  return false;
}


/* ── guided story: one patient, start to finish ──────────────────────────────
 * Seven steps, each told as "what just happened" + "why it matters". The
 * driver performs every step through the real endpoints as a NON-viewer demo
 * account. When a step belongs to the person presenting (an admission sent to
 * them, a STAT addressed to them), the story waits for them to tap it — that
 * is the moment the audience remembers — and moves on by itself after a while.
 */
interface StoryCtx {
  patientId?: number; assignmentId?: number; ownerUserId?: number; ownerName?: string;
  erUserId?: number; erName?: string; consultantName?: string; consultId?: number;
  statMessageId?: number; patient2Owner?: string;
}
interface StoryState {
  index: number;
  started: boolean;
  startedAt: number;
  beatDoneAt: number | null;
  waitingText: string | null;
  waitUntil: number | null;
  paused: boolean;
  skip: boolean;
  done: boolean;
  ctx: StoryCtx;
  happened: string | null;
}
type Role = "hospitalist" | "er_doctor" | "er_director" | "director";
interface Beat {
  title: string;
  why: string;
  /** Which screen to open, per presenter role. */
  nav: Partial<Record<Role, string>>;
  /** Perform the step; return the "what just happened" line. */
  act: (run: Run, users: DemoUser[], ctx: StoryCtx) => Promise<string>;
  /** Waiting on the presenter? Return the instruction while waiting, null when done. */
  wait?: (run: Run, ctx: StoryCtx) => Promise<string | null>;
  /** The line shown once the presenter has done their part. */
  doneText?: (ctx: StoryCtx) => string;
  /** If the presenter did not act in time, finish the step for them (as a non-viewer if possible). */
  finish?: (run: Run, users: DemoUser[], ctx: StoryCtx) => Promise<void>;
}

function newStory(): StoryState {
  return { index: 0, started: false, startedAt: Date.now(), beatDoneAt: null, waitingText: null, waitUntil: null, paused: false, skip: false, done: false, ctx: {}, happened: null };
}

const firstName = (u: DemoUser) => u.displayName;

async function protagonist(run: Run, users: DemoUser[]): Promise<{ user: DemoUser; hospId: number } | null> {
  const hosp = (await storage().listHospitalists(run.orgId)).filter((h) => h.working && h.currentPatientCount < h.patientCap);
  // The presenter, when they are a hospitalist: the request lands on THEIR screen.
  const mine = hosp.find((h) => isViewer(run.orgId, h.userId));
  const h = mine ?? pick(hosp.filter((x) => users.some((u) => u.id === x.userId && u.role === "hospitalist")));
  const u = h && users.find((x) => x.id === h.userId);
  return h && u ? { user: u, hospId: h.id } : null;
}
function erActor(run: Run, users: DemoUser[]): DemoUser | undefined {
  return users.find((u) => u.role === "er_doctor" && !isViewer(run.orgId, u.id))
    ?? users.find((u) => u.role === "er_director" && !isViewer(run.orgId, u.id));
}

const BEATS: Beat[] = [
  {
    title: "A patient arrives in the ER",
    why: "No paging operator and no phone tag. DocTurn routes the admission and starts a response clock.",
    nav: { hospitalist: "dashboard", director: "board", er_doctor: "dashboard", er_director: "dashboard" },
    act: async (run, users, ctx) => {
      const er = erActor(run, users);
      const owner = await protagonist(run, users);
      if (!er || !owner) return "No ER physician or hospitalist is available for the story.";
      const p = await as(run, er, "POST", "/api/patients", { initials: "JM", roomNumber: "ER-07", issueSummary: "Chest pain, troponin pending", acuity: 2, department: "ER" });
      if (!p || p.status !== 201) return "The ER could not add the patient.";
      const a = await as(run, er, "POST", "/api/assignments", { patientId: p.json.id, mode: "manual", hospitalistId: owner.hospId });
      Object.assign(ctx, { patientId: p.json.id, assignmentId: a?.json?.id, ownerUserId: owner.user.id, ownerName: firstName(owner.user), erUserId: er.id, erName: firstName(er) });
      run.counts.admissions++;
      log(run, `${er.displayName} sent JM (ER-07, chest pain) to ${owner.user.displayName}`);
      return `${er.displayName} admitted patient JM (room ER-07, chest pain) and sent the request to ${owner.user.displayName}.`;
    },
  },
  {
    title: "The hospitalist accepts",
    why: "One tap. The ER sees who has the patient, and the census updates for everyone.",
    nav: { hospitalist: "dashboard", director: "board", er_doctor: "dashboard", er_director: "dashboard" },
    act: async (run, users, ctx) => {
      if (!ctx.assignmentId || !ctx.ownerUserId) return "Waiting for the request.";
      const owner = users.find((u) => u.id === ctx.ownerUserId)!;
      if (isViewer(run.orgId, owner.id)) return `The request is on ${owner.displayName}'s screen with a 15-minute clock.`;
      const r = await as(run, owner, "PATCH", `/api/assignments/${ctx.assignmentId}/accept`, {});
      if (r && r.status < 300) { run.counts.accepted++; log(run, `${owner.displayName} accepted JM`); }
      return `${owner.displayName} accepted JM. The request disappears from their queue and JM is on their census.`;
    },
    wait: async (run, ctx) => {
      if (!ctx.assignmentId || !ctx.ownerUserId || !isViewer(run.orgId, ctx.ownerUserId)) return null;
      const a = (await storage().listAssignments(run.orgId)).find((x) => x.id === ctx.assignmentId);
      return a && a.status === "pending" ? "Your turn: tap Accept on JM's request." : null;
    },
    doneText: (ctx) => `Accepted. JM is on ${ctx.ownerName ?? "the hospitalist"}'s census, and the ER can see who has the patient.`,
    finish: async (run, users, ctx) => {
      // The presenter moved on without accepting: leave it pending for them.
      void run; void users; void ctx;
    },
  },
  {
    title: "Cardiology is consulted",
    why: "Ask the on-call service, or a specific physician by name. Everyone on the case sees the request and its status.",
    nav: { hospitalist: "dashboard", director: "board", er_doctor: "dashboard", er_director: "board" },
    act: async (run, users, ctx) => {
      const er = users.find((u) => u.id === ctx.erUserId);
      const consultant = pick(users.filter((u) => u.role === "hospitalist" && u.id !== ctx.ownerUserId && !isViewer(run.orgId, u.id)));
      if (!er || !ctx.patientId || !consultant) return "No consultant is available for the story.";
      const r = await as(run, er, "POST", `/api/patients/${ctx.patientId}/consults`, { specialty: "Cardiology", consultantUserId: consultant.id });
      const consults = r && r.status < 300 ? (await storage().listConsultsForPatient(run.orgId, ctx.patientId)) : [];
      ctx.consultId = consults.find((c) => c.consultantUserId === consultant.id)?.id;
      ctx.consultantName = consultant.displayName;
      run.counts.consults++;
      log(run, `${er.displayName} consulted ${consultant.displayName} on JM`);
      return `${er.displayName} asked ${consultant.displayName} (Cardiology) to see JM. The consult shows as pending on the board.`;
    },
  },
  {
    title: "The consultant answers",
    why: "No callback loop. The answer reaches the whole team the moment it is given.",
    nav: { hospitalist: "dashboard", director: "board", er_doctor: "dashboard", er_director: "board" },
    act: async (run, users, ctx) => {
      const consultant = users.find((u) => u.displayName === ctx.consultantName);
      if (!consultant || !ctx.consultId) return "The consult is still pending.";
      const r = await as(run, consultant, "PATCH", `/api/consults/${ctx.consultId}`, { status: "accepted" });
      if (r && r.status < 300) { run.counts.answered++; log(run, `${consultant.displayName} accepted the JM consult`); }
      return `${consultant.displayName} accepted the consult. JM's row now shows Cardiology as accepted.`;
    },
  },
  {
    title: "Something urgent happens",
    why: "STAT messages demand an acknowledgement. If nobody responds, DocTurn escalates to the covering physician.",
    nav: { hospitalist: "messages", director: "messages", er_doctor: "messages", er_director: "messages" },
    act: async (run, users, ctx) => {
      const er = users.find((u) => u.id === ctx.erUserId);
      const owner = users.find((u) => u.id === ctx.ownerUserId);
      if (!er || !owner) return "No one to message.";
      const cid = await directConversation(run, er, owner);
      if (!cid) return "The message could not be sent.";
      const sent = await as(run, er, "POST", "/api/messaging/send", { conversationId: cid, content: "JM in ER-07: troponin rising and the repeat ECG changed. Please come now.", priority: "stat" });
      ctx.statMessageId = Number(sent?.json?.id ?? 0) || undefined;
      run.counts.messages++; run.counts.stat++;
      log(run, `STAT from ${er.displayName} to ${owner.displayName} about JM`);
      return `${er.displayName} sent a STAT message to ${owner.displayName}: troponin rising on JM.`;
    },
    wait: async (run, ctx) => {
      if (!ctx.statMessageId || !ctx.ownerUserId || !isViewer(run.orgId, ctx.ownerUserId)) return null;
      const rows = await storage().listDeliveryForMessages([ctx.statMessageId]);
      const mine = rows.find((d) => d.userId === ctx.ownerUserId);
      return mine && !mine.acknowledgedAt ? "Your turn: open the STAT message and tap Acknowledge." : null;
    },
    doneText: () => "Acknowledged in time, so DocTurn did not need to escalate.",
  },
  {
    title: "The STAT is acknowledged",
    why: "The sender sees exactly who acknowledged and when. Every step is in the audit trail.",
    nav: { hospitalist: "messages", director: "messages", er_doctor: "messages", er_director: "messages" },
    act: async (run, users, ctx) => {
      const owner = users.find((u) => u.id === ctx.ownerUserId);
      if (!owner || !ctx.statMessageId) return "Acknowledged.";
      if (!isViewer(run.orgId, owner.id)) {
        await as(run, owner, "POST", "/api/messaging/messages/ack", { messageIds: [ctx.statMessageId] });
        log(run, `${owner.displayName} acknowledged the STAT`);
      }
      return `${owner.displayName} acknowledged the STAT. ${ctx.erName ?? "The ER"} sees it on the message right away.`;
    },
  },
  {
    title: "The next patient goes to the next hospitalist",
    why: "Admissions stay fair automatically, by census and rotation, while directors watch the whole service live.",
    nav: { hospitalist: "dashboard", director: "dashboard", er_doctor: "dashboard", er_director: "dashboard" },
    act: async (run, users, ctx) => {
      const er = users.find((u) => u.id === ctx.erUserId) ?? erActor(run, users);
      if (!er) return "No ER physician is available.";
      const p = await as(run, er, "POST", "/api/patients", { initials: "RT", roomNumber: "ER-11", issueSummary: "Pneumonia, needs oxygen", acuity: 3, department: "ER" });
      if (!p || p.status !== 201) return "The ER could not add the patient.";
      await as(run, er, "POST", "/api/assignments", { patientId: p.json.id, mode: "round_robin" });
      const a = (await storage().listAssignments(run.orgId)).filter((x) => x.patientId === p.json.id).pop();
      const h = a && (await storage().listHospitalists(run.orgId)).find((x) => x.id === a.hospitalistId);
      const who = h && users.find((u) => u.id === h.userId);
      run.counts.admissions++;
      log(run, `${er.displayName} sent RT (ER-11) round-robin${who ? " to " + who.displayName : ""}`);
      return `${er.displayName} sent patient RT. DocTurn picked ${who ? who.displayName : "the next hospitalist"}, the one with the lowest census.`;
    },
  },
];

function storyView(st: StoryState) {
  const beat = BEATS[Math.min(st.index, BEATS.length - 1)]!;
  return {
    index: st.index,
    total: BEATS.length,
    done: st.done,
    paused: st.paused,
    title: beat.title,
    happened: st.happened,
    why: beat.why,
    nav: beat.nav,
    waiting: st.waitingText,
    // When the step will move on by itself (null while waiting or paused).
    advanceAt: !st.done && !st.paused && !st.waitingText && st.beatDoneAt ? new Date(st.beatDoneAt + STORY_DWELL_MS).toISOString() : null,
  };
}

async function storyTick(run: Run) {
  if (run.ticking || !run.story || runs.get(run.orgId) !== run) return; // stopped
  if (Date.now() > run.endsAt) { stopLiveDemo(run.orgId); return; }
  const st = run.story;
  run.ticking = true;
  try {
    if (st.done) return;
    const beat = BEATS[st.index]!;
    const users = await demoUsers(run.orgId);
    if (!st.started) {
      st.started = true;
      st.happened = null;
      try {
        st.happened = await beat.act(run, users, st.ctx);
      } catch (e) {
        // A failed step never freezes the story: say so and move on in turn.
        console.warn("[demo-live] story step failed:", (e as Error).message);
        st.happened = "This step could not run. Press Next to continue.";
      }
      st.beatDoneAt = Date.now();
      st.waitUntil = beat.wait ? Date.now() + STORY_WAIT_MS : null;
    }
    // Waiting for the presenter's tap?
    if (beat.wait) {
      const w = await beat.wait(run, st.ctx);
      if (w && !st.skip && st.waitUntil && Date.now() < st.waitUntil) { st.waitingText = w; return; }
      if (st.waitingText) {
        st.beatDoneAt = Date.now(); // the tap just happened: dwell from now
        if (!w && beat.doneText) st.happened = beat.doneText(st.ctx);
      }
      st.waitingText = null;
      if (w && beat.finish) await beat.finish(run, users, st.ctx);
    }
    const dwellOver = st.beatDoneAt != null && Date.now() - st.beatDoneAt >= STORY_DWELL_MS;
    if (st.skip || (!st.paused && dwellOver)) {
      st.skip = false;
      if (st.index >= BEATS.length - 1) { st.done = true; return; }
      st.index++;
      st.started = false;
      st.beatDoneAt = null;
    }
  } catch (e) {
    console.warn("[demo-live] story step failed:", (e as Error).message);
  } finally {
    run.ticking = false;
  }
}
