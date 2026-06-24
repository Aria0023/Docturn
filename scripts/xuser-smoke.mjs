/**
 * Concurrent cross-user real-time smoke test.
 *
 * The jsdom UI smoke (scripts/ui-smoke.mjs) drives one browser session at a
 * time. This complements it by holding TWO live sessions open at once — an ER
 * physician and a hospitalist — each with its own session cookie and its own
 * WebSocket, and verifying the real-time handoffs actually cross between them:
 *   • presence, live ASSIGNMENT_CREATED, accept → census, bidirectional
 *     messaging delivery, and RBAC enforcement.
 *
 * Requires the dev server running on :3000 (npm run dev). Exits non-zero on any
 * failure so it can gate a release check.
 */
import WebSocket from "ws";

const BASE = process.env.BASE_URL || "http://localhost:3000";
let pass = 0, fail = 0;
const rec = (n, ok, d) => { console.log((ok ? "PASS  " : "FAIL  ") + n + (ok ? "" : "  ↳ " + d)); ok ? pass++ : fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jar() {
  let c = "";
  return {
    get cookie() { return c; },
    async f(p, o = {}) {
      const h = Object.assign({ "Content-Type": "application/json" }, o.headers || {});
      if (c) h.Cookie = c;
      const r = await fetch(BASE + p, Object.assign({}, o, { headers: h }));
      const s = r.headers.get("set-cookie");
      if (s) c = s.split(";")[0];
      const t = await r.text();
      let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
      return { status: r.status, json: j };
    },
  };
}
function openWs(cookie) {
  const got = [];
  const sock = new WebSocket(BASE.replace("http", "ws") + "/ws", { headers: { Cookie: cookie } });
  const ready = new Promise((res, rej) => { sock.on("open", res); sock.on("error", rej); });
  sock.on("message", (d) => { try { got.push(JSON.parse(d.toString())); } catch {} });
  return { sock, got, ready };
}
const login = (j, u) => j.f("/api/login", { method: "POST", body: JSON.stringify({ orgCode: "ISPN", username: u, password: "docturn" }) });

console.log("\n========== DocTurn concurrent cross-user smoke ==========\n");

const er = jar(), chen = jar();
await login(er, "er.doc");
await login(chen, "chen");
const erU = (await er.f("/api/user")).json, chenU = (await chen.f("/api/user")).json;
rec("two distinct users authenticated concurrently", erU.role === "er_doctor" && chenU.role === "hospitalist", erU.role + "/" + chenU.role);

const erWs = openWs(er.cookie), chenWs = openWs(chen.cookie);
await erWs.ready; await chenWs.ready; await wait(300);
rec("both users' WebSockets connect", erWs.got.some((e) => e.type === "CONNECTION_ESTABLISHED") && chenWs.got.some((e) => e.type === "CONNECTION_ESTABLISHED"));
rec("ER sees hospitalist presence online (cross-user)", erWs.got.some((e) => e.type === "USER_PRESENCE_CHANGED" && e.userId === chenU.id && e.online));

const hosps = (await er.f("/api/hospitalists")).json;
const chenProv = hosps.find((h) => h.userId === chenU.id);

// ER → hospitalist: manual admission delivered live.
let before = chenWs.got.length;
const p = (await er.f("/api/patients", { method: "POST", body: JSON.stringify({ initials: "TT", roomNumber: "hall5", issueSummary: "GSW", acuity: 1 }) })).json;
const a = (await er.f("/api/assignments", { method: "POST", body: JSON.stringify({ patientId: p.id, mode: "manual", hospitalistId: chenProv.id }) })).json;
await wait(500);
rec("ER manual admission → Chen gets ASSIGNMENT_CREATED live", chenWs.got.slice(before).some((e) => e.type === "ASSIGNMENT_CREATED" && e.assignment && e.assignment.id === a.id));
let pend = (await chen.f("/api/assignments/pending")).json;
rec("admission appears in Chen's pending", pend.some((x) => x.id === a.id), "ids=" + pend.map((x) => x.id));

// Hospitalist accepts → leaves pending, enters census.
const acc = await chen.f("/api/assignments/" + a.id + "/accept", { method: "PATCH", body: JSON.stringify({}) });
rec("hospitalist accepts", acc.status === 200 && acc.json.status === "accepted", "status=" + acc.status);
pend = (await chen.f("/api/assignments/pending")).json;
rec("accepted removed from pending", !pend.some((x) => x.id === a.id));
rec("accepted shows in Chen's census", (await chen.f("/api/assignments/my")).json.some((x) => x.id === a.id));

// Bidirectional messaging delivered live both ways.
const convo = (await er.f("/api/messaging/conversations", { method: "POST", body: JSON.stringify({ type: "direct", participantIds: [chenU.id] }) })).json;
before = chenWs.got.length;
const sent = await er.f("/api/messaging/send", { method: "POST", body: JSON.stringify({ conversationId: convo.id, content: "Bed ready for the GSW?" }) });
await wait(500);
rec("ER→Chen message delivered live (MESSAGE_RECEIVED)", chenWs.got.slice(before).some((e) => e.type === "MESSAGE_RECEIVED"), "send=" + sent.status);
rec("Chen sees the ER's message content", ((await chen.f("/api/messaging/conversations/" + convo.id + "/messages")).json || []).some((m) => /Bed ready/.test(m.content)));
before = erWs.got.length;
await chen.f("/api/messaging/send", { method: "POST", body: JSON.stringify({ conversationId: convo.id, content: "Bed 7 open." }) });
await wait(500);
rec("Chen→ER reply delivered live (bidirectional)", erWs.got.slice(before).some((e) => e.type === "MESSAGE_RECEIVED"));

// Decline visibility: ER routes a fresh patient to Chen, Chen declines — the ER
// must SEE the decline live and in its sent feed (and the auto-reroute).
const patelH = hosps.find((h) => h.specialty && h.userId && h.id !== chenProv.id);
const p2 = (await er.f("/api/patients", { method: "POST", body: JSON.stringify({ initials: "DC", roomNumber: "7", issueSummary: "AKI", acuity: 2 }) })).json;
const a2 = (await er.f("/api/assignments", { method: "POST", body: JSON.stringify({ patientId: p2.id, mode: "manual", hospitalistId: chenProv.id }) })).json;
await wait(300);
before = erWs.got.length;
await chen.f("/api/assignments/" + a2.id + "/reject", { method: "PATCH" });
await wait(500);
rec("ER sees the decline live (ASSIGNMENT_UPDATED)", erWs.got.slice(before).some((e) => e.type === "ASSIGNMENT_UPDATED"));
let erSent = (await er.f("/api/assignments/sent")).json;
rec("ER sent feed records the decline", (erSent.find((x) => x.id === a2.id) || {}).status !== "pending", "status=" + ((erSent.find((x) => x.id === a2.id) || {}).status));

// ER re-routes their patient to a different hospitalist (own-patient reassign).
const reroute = erSent.find((x) => x.patientId === p2.id && x.status === "pending");
if (reroute && patelH) {
  const re = await er.f("/api/assignments/" + reroute.id + "/reassign", { method: "PATCH", body: JSON.stringify({ hospitalistId: patelH.id }) });
  rec("ER can re-route their own patient", re.status === 200, "status=" + re.status);
}

// Director reassign reaches the new hospitalist live.
const dir = jar();
await login(dir, "director");
const p3 = (await er.f("/api/patients", { method: "POST", body: JSON.stringify({ initials: "DR", roomNumber: "9", issueSummary: "obs", acuity: 3 }) })).json;
const a3 = (await er.f("/api/assignments", { method: "POST", body: JSON.stringify({ patientId: p3.id, mode: "manual", hospitalistId: patelH.id }) })).json;
await wait(300); before = chenWs.got.length;
const board = (await dir.f("/api/patient-board")).json;
const row = board.find((b) => b.patient.id === p3.id);
rec("board row exposes assignmentId for reassign", !!(row && row.assignmentId === a3.id));
await dir.f("/api/assignments/" + a3.id + "/reassign", { method: "PATCH", body: JSON.stringify({ hospitalistId: chenProv.id }) });
await wait(500);
rec("director reassign reaches the hospitalist live", chenWs.got.slice(before).some((e) => e.type === "ASSIGNMENT_CREATED"));

// RBAC: hospitalist cannot perform the ER-only action.
const forbidden = await chen.f("/api/assignments", { method: "POST", body: JSON.stringify({ patientId: p.id, mode: "manual", hospitalistId: chenProv.id }) });
rec("RBAC: hospitalist blocked from ER-only action", forbidden.status === 403, "status=" + forbidden.status);

erWs.sock.close(); chenWs.sock.close();
console.log("\n" + pass + " passed, " + fail + " failed, " + (pass + fail) + " total\n");
process.exit(fail ? 1 : 0);
