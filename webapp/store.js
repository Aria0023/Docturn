/* ============================================================================
   DocTurn — application store (single source of truth).

   Plain JS (no JSX) so it loads synchronously before the Babel component
   scripts. Everything the app shows lives here; it is persisted to
   localStorage on every real mutation and rehydrated on load, so the whole
   prototype survives a refresh. A 1-second clock drives live countdowns,
   expiry-based auto re-routing, presence and typing — without thrashing
   localStorage (we persist only when data actually changes).

   Exposes:  window.DT  ........ { getState, subscribe, actions, ... }
             window.useStore() .. React hook -> whole state (re-renders on change)
             window.useActions() React hook -> stable actions object
             window.useClock() .. React hook -> seconds counter (live ticking UI)
             window.dtFmt ....... small formatting helpers
   ============================================================================ */
(function () {
  "use strict";

  var KEY = "docturn:store:v6";
  var now = function () { return Date.now(); };
  var uid = (function () { var n = 1000; return function (p) { return (p || "id") + "_" + (++n) + "_" + Math.floor(Math.random() * 1e4); }; })();

  /* ---- time helpers ------------------------------------------------------ */
  function hhmm(ts) {
    var d = (ts == null) ? new Date() : new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function clockLabel() { return hhmm(); }
  function mmss(ms) {
    if (ms <= 0) return "0:00";
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function ago(ts) {
    var s = Math.max(0, Math.round((now() - ts) / 1000));
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }
  function initialsOf(name) {
    return name.replace(/^Dr\.?\s*/, "").split(/[\s,]+/).map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }

  /* ---- AI intake extraction (deterministic, note-driven) ----------------- */
  var SPECIALTY_KEYS = [
    [/chest pain|troponin|nstemi|stemi|cardiac|afib|chf|angina/i, "Cardiology"],
    [/copd|pneumonia|sob|short(ness)? of breath|asthma|pe\b|pulmonary|hypox/i, "Pulmonology"],
    [/dka|diabet|ketoacidosis|hyperglyc|thyroid|endocrine/i, "Endocrine"],
    [/aki|ckd|renal|kidney|electrolyte|dialysis/i, "Nephrology"],
    [/gi bleed|melena|hematemesis|abdominal|pancreatitis|hepatic|liver/i, "GI"],
    [/sepsis|septic|infection|cellulitis|abscess|febrile/i, "Infectious Disease"],
    [/stroke|seizure|altered mental|neuro|headache/i, "Neurology"],
  ];
  function extractIntake(note) {
    var text = (note || "").trim();
    if (!text) return { initials: "", room: "", complaint: "", specialty: "", consults: [], empty: true };
    var initials = "";
    // Leading name (handles lowercase too): the words at the start — after an
    // optional "patient/pt/name" — when they look like a name (prefixed, or
    // followed by an age/sex like "55M", or "presents/complains").
    var lead = text.replace(/^\s*(?:patient|pt\.?|name)\s*:?\s*/i, "");
    var prefixed = /^\s*(?:patient|pt\.?|name)\b/i.test(text);
    var nameM = lead.match(/^([A-Za-z][A-Za-z'\-]*)\s+([A-Za-z][A-Za-z'\-]*)\b/);
    if (nameM) {
      var after = lead.slice(nameM[0].length);
      var looksName = prefixed
        || /^\s*,?\s*\d{1,3}\s*(?:y\/?o\b|yo\b|years?\b|m\b|f\b|male\b|female\b|man\b|woman\b)/i.test(after)
        || /^\s*(presents|presenting|complains|c\/o)\b/i.test(after);
      if (looksName) initials = (nameM[1][0] + nameM[2][0]).toUpperCase();
    }
    // Capitalized two-word name anywhere (skip common non-name words).
    if (!initials) {
      var STOP = { Patient: 1, Pt: 1, Room: 1, Rm: 1, Bed: 1, Bay: 1, Hall: 1, Hallway: 1, The: 1, Mr: 1, Mrs: 1, Ms: 1, Dr: 1, Male: 1, Female: 1, ER: 1, ED: 1, Disaster: 1, With: 1, Chest: 1 };
      var caps = (text.match(/\b[A-Z][a-z]+\b/g) || []).filter(function (w) { return !STOP[w]; });
      if (caps.length >= 2) initials = (caps[0][0] + caps[1][0]).toUpperCase();
    }
    // Explicit initials: "patient J.S." / standalone "JS" / "J.S."
    if (!initials) { var im = text.match(/\b(?:patient|pt\.?)\s+([A-Z])\.?\s?([A-Z])\b/i); if (im) initials = (im[1] + im[2]).toUpperCase(); }
    if (!initials) { var im2 = text.match(/\b([A-Z])\.?\s?([A-Z])\b/); if (im2) initials = (im2[1] + im2[2]).toUpperCase(); }
    // Room/location — accepts any designation incl. spaces: 412, A/B, Hall,
    // Bay 3, "disc 44", Disaster. Capture after the keyword up to punctuation
    // or a clinical phrase, so multi-word designations ("disc 44") are kept.
    var room = "";
    var rm = text.match(/\b(?:room|rm\.?|bed|bay|loc(?:ation)?)\s*#?\s*([A-Za-z0-9][A-Za-z0-9\/\- ]*?)(?=\s*(?:[,.;]|\bwith\b|\bw\/|\bpresent|\bcomplain|\bc\/o\b|\bhx\b|\bfor\b|$))/i);
    if (rm) room = rm[1].trim();
    if (!room) { var spot = text.match(/\b(hall\s?way|hallway|hall|disaster(?:\s+bay)?|triage|waiting\s+room|lobby)\b/i); if (spot) room = spot[1].replace(/\s+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
    if (!room) room = (text.match(/\b([0-9]{3}[A-Za-z]?)\b/) || [])[1] || "";
    var complaint = text.split(/[.\n;]/)[0].trim().replace(/^\s*(patient|pt\.?)\s+[A-Z][A-Za-z.\s]*?\s*(with|w\/|presenting with|presents with)\s*/i, "");
    complaint = complaint.charAt(0).toUpperCase() + complaint.slice(1);
    if (complaint.length > 90) complaint = complaint.slice(0, 88) + "…";
    var specialty = "Hospital Medicine", consults = [];
    for (var i = 0; i < SPECIALTY_KEYS.length; i++) { if (SPECIALTY_KEYS[i][0].test(text)) { specialty = SPECIALTY_KEYS[i][1]; consults = [specialty]; break; } }
    return { initials: initials || "", room: room, complaint: complaint || text.slice(0, 80), specialty: specialty, consults: consults, empty: false };
  }

  /* ---- incoming-admit generator (for live "real" feel) ------------------- */
  var ADMIT_POOL = [
    { initials: "GV", room: "221", complaint: "Septic shock, on pressors", specialty: "Infectious Disease", from: "Dr. Reyes (ER)" },
    { initials: "HP", room: "117", complaint: "PE, hypoxic on room air", specialty: "Pulmonology", from: "Dr. Osei (ER)" },
    { initials: "WN", room: "309", complaint: "AKI on CKD, hyperkalemia", specialty: "Nephrology", from: "Dr. Okafor (ER)" },
    { initials: "EB", room: "402", complaint: "Afib with RVR", specialty: "Cardiology", from: "Dr. Reyes (ER)" },
    { initials: "TS", room: "210", complaint: "Acute pancreatitis", specialty: "GI", from: "Dr. Osei (ER)" },
  ];

  /* ---- seed (initial) state --------------------------------------------- */
  function seed() {
    var t0 = now();
    return {
      v: 7,
      theme: { appName: "DocTurn", accent: "#2563EB", radius: 8, sidebar: "expanded", contentWidth: "standard" },
      navHidden: {},
      navOrder: {},
      // Per-role patient-board module visibility overrides (merged over the
      // role defaults in boardModulesFor). Lets a director/ER director switch
      // board sections on/off — the FHIR-dependent ones stay off until the EHR
      // census is wired up.
      boardModules: {},
      // Per-organization on-call schedule source. Every tenant can use a
      // different scheduling vendor (Amion, QGenda, …) — keyed by org code so it
      // survives the developer org re-hydrate (which rebuilds the orgs array).
      scheduleSources: { MAYO: "amion", STJUDE: "qgenda", CLEVE: "amion", MERCY: "amion", PINE: "none" },
      session: null, // { role, org, user, name }
      ui: { nav: "dashboard", notifOpen: false, realtime: true, onShift: true },
      me: { name: "Dr. Jordan Chen", avatar: "JC", role: "MD" },

      providers: [
        { id: "h1", name: "Dr. Sarah Chen",  avatar: "SC", specialty: "Cardiology",        census: 3, cap: 12, working: true,  shift: "day",   inRotation: true },
        { id: "h2", name: "Dr. Amir Patel",  avatar: "AP", specialty: "Hospital Medicine", census: 5, cap: 12, working: true,  shift: "day",   inRotation: true },
        { id: "h3", name: "Dr. Maria Lopez", avatar: "ML", specialty: "Pulmonology",       census: 7, cap: 10, working: true,  shift: "swing", inRotation: true },
        { id: "h5", name: "Dr. Nina Roy",    avatar: "NR", specialty: "Hospital Medicine", census: 4, cap: 12, working: true,  shift: "swing", inRotation: false },
        { id: "h6", name: "Dr. Omar Haddad", avatar: "OH", specialty: "Hospital Medicine", census: 6, cap: 12, working: true,  shift: "night", inRotation: true },
        { id: "h4", name: "Dr. James Liu",   avatar: "JL", specialty: "Nephrology",        census: 2, cap: 8,  working: false, shift: "night", inRotation: false },
      ],
      shifts: [
        { id: "day",   label: "Day call", start: "07:00", end: "15:00" },
        { id: "swing", label: "Swing",    start: "15:00", end: "23:00" },
        { id: "night", label: "Nights",   start: "23:00", end: "07:00" },
      ],
      rotationCursor: 0,

      erPhysicians: [
        { id: "e1", name: "Dr. Ruth Osei",   avatar: "RO", working: true,  shift: "day",   admitsToday: 6 },
        { id: "e2", name: "Dr. Paul Okafor", avatar: "PO", working: true,  shift: "day",   admitsToday: 4 },
        { id: "e3", name: "Dr. Dana Reyes",  avatar: "DR", working: true,  shift: "swing", admitsToday: 5 },
        { id: "e4", name: "Dr. Sam Iyer",    avatar: "SI", working: false, shift: "night", admitsToday: 0 },
      ],
      diversion: false,
      avgAcceptSec: 252,
      fhir: { connected: false, lastSync: null, source: "Epic FHIR", endpoint: "fhir.mayo.org/api/r4" },

      pending: [
        { id: "a1", initials: "RM", room: "318", complaint: "Acute abdominal pain, 2-day onset", from: "Dr. Reyes (ER)", specialty: "General Medicine", via: "Round-robin", expiresAt: t0 + 272000, acceptedToday: false },
        { id: "a2", initials: "TK", room: "205", complaint: "Diabetic ketoacidosis", from: "Dr. Osei (ER)", specialty: "Endocrinology", via: "Manual", expiresAt: t0 + 430000, acceptedToday: false },
      ],
      myPatients: [
        { id: "p1", initials: "DW", room: "410", complaint: "CHF exacerbation" },
        { id: "p2", initials: "BG", room: "402", complaint: "Community-acquired pneumonia" },
        { id: "p3", initials: "SC", room: "412", complaint: "Chest pain — observation" },
      ],
      acceptedToday: 7,
      // Timestamped log of THIS hospitalist's accepted admissions. The dashboard
      // shows the current shift (since 7am); the History tab keeps 3+ days.
      myAdmissions: [
        { id: uid("ma"), at: now() - 40 * 60000,    initials: "DW", room: "410", complaint: "CHF exacerbation" },
        { id: uid("ma"), at: now() - 3 * 3600000,   initials: "BG", room: "402", complaint: "Community-acquired pneumonia" },
        { id: uid("ma"), at: now() - 26 * 3600000,  initials: "MR", room: "318", complaint: "Sepsis, source unclear" },
        { id: uid("ma"), at: now() - 31 * 3600000,  initials: "JT", room: "221", complaint: "AKI on CKD" },
        { id: uid("ma"), at: now() - 50 * 3600000,  initials: "TK", room: "205", complaint: "Diabetic ketoacidosis" },
      ],

      sent: [
        { id: uid("s"), initials: "MJ", provider: "Dr. Amir Patel",  complaint: "NSTEMI, troponin trending", consultants: ["Cardiology"],  time: "Today · 08:41",     day: "Today",     status: "accepted" },
        { id: uid("s"), initials: "RV", provider: "Dr. Maria Lopez", complaint: "COPD exacerbation",          consultants: ["Pulmonology"], time: "Today · 07:55",     day: "Today",     status: "sent" },
        { id: uid("s"), initials: "DK", provider: "Dr. Sarah Chen",  complaint: "Syncope, workup",            consultants: [],              time: "Yesterday · 21:10", day: "Yesterday", status: "accepted" },
        { id: uid("s"), initials: "LP", provider: "Dr. Omar Haddad", complaint: "GI bleed, melena",           consultants: ["GI"],          time: "Yesterday · 16:32", day: "Yesterday", status: "rejected" },
      ],

      // Full, append-only log of every admission routed to a team. The main
      // dashboard shows a rolling count since `admissionsResetAt`, which the
      // hospitalist director can reset on command; this log keeps everything.
      admissions: [
        { id: uid("ad"), at: now() - 35 * 60000,    initials: "MJ", room: "402", provider: "Dr. Amir Patel",  specialty: "Cardiology",  via: "Round-robin", status: "accepted" },
        { id: uid("ad"), at: now() - 95 * 60000,    initials: "RV", room: "318", provider: "Dr. Maria Lopez", specialty: "Pulmonology", via: "Manual",      status: "sent" },
        { id: uid("ad"), at: now() - 5 * 3600000,   initials: "DK", room: "210", provider: "Dr. Sarah Chen",  specialty: "Neurology",   via: "Round-robin", status: "accepted" },
        { id: uid("ad"), at: now() - 26 * 3600000,  initials: "LP", room: "115", provider: "Dr. Omar Haddad", specialty: "GI",          via: "Manual",      status: "accepted" },
      ],
      admissionsResetAt: 0,

      team: [
        { id: "m1", name: "Jordan Wu, PA-C", avatar: "JW", role: "PA", specialty: "Hospital Medicine", onCall: true },
        { id: "m2", name: "Nina Roy, NP",    avatar: "NR", role: "NP", specialty: "Cardiology",        onCall: false },
      ],
      candidates: [
        { id: "c1", name: "Dr. Omar Haddad",  avatar: "OH", role: "MD", specialty: "Hospital Medicine" },
        { id: "c2", name: "Priya Shah, NP",    avatar: "PS", role: "NP", specialty: "Pulmonology" },
        { id: "c3", name: "Marcus Bell, PA-C", avatar: "MB", role: "PA", specialty: "General Medicine" },
        { id: "c4", name: "Dr. Lena Ortiz",    avatar: "LO", role: "DO", specialty: "Nephrology" },
        { id: "c5", name: "Sam Cole, RN",      avatar: "SC", role: "RN", specialty: "Telemetry" },
      ],

      board: [
        { id: uid("b"), initials: "RM", room: "318", dept: "MED",  issue: "Acute abdominal pain, 2-day onset", status: "admitted",
          attending: { name: "Dr. Sarah Chen", avatar: "SC" }, unit: [{ avatar: "JW", role: "PA" }], consultants: ["GI"], er: { name: "Dr. Reyes", avatar: "Re" } },
        { id: uid("b"), initials: "TK", room: "205", dept: "ICU",  issue: "Diabetic ketoacidosis", status: "observation",
          attending: { name: "Dr. Maria Lopez", avatar: "ML" }, unit: [{ avatar: "NR", role: "NP" }], consultants: ["Endocrine", "Nephro"], er: { name: "Dr. Osei", avatar: "Os" } },
        { id: uid("b"), initials: "DW", room: "410", dept: "TELE", issue: "CHF exacerbation", status: "admitted",
          attending: { name: "Dr. Amir Patel", avatar: "AP" }, unit: [], consultants: ["Cardiology"], er: { name: "Dr. Reyes", avatar: "Re" } },
        { id: uid("b"), initials: "BG", room: "402", dept: "MED",  issue: "Community-acquired pneumonia", status: "admitted",
          attending: { name: "Dr. Sarah Chen", avatar: "SC" }, unit: [{ avatar: "JW", role: "PA" }], consultants: [], er: { name: "Dr. Okafor", avatar: "Ok" } },
        { id: uid("b"), initials: "LH", room: "—", dept: "ER", issue: "Chest pain, rule-out ACS", status: "pending",
          attending: { name: "", avatar: "" }, unit: [], consultants: [], er: { name: "Dr. Osei", avatar: "Os" } },
        { id: uid("b"), initials: "PV", room: "221", dept: "ICU", issue: "Septic shock, on pressors", status: "observation",
          attending: { name: "Dr. Maria Lopez", avatar: "ML" }, unit: [{ avatar: "PS", role: "NP" }], consultants: ["ID", "Pulm"], er: { name: "Dr. Reyes", avatar: "Re" } },
        { id: uid("b"), initials: "AC", room: "308", dept: "MED", issue: "AKI on CKD, electrolyte derangement", status: "transfer",
          attending: { name: "Dr. James Liu", avatar: "JL" }, unit: [], consultants: ["Nephro"], er: { name: "Dr. Okafor", avatar: "Ok" } },
      ],

      orgs: [
        { code: "MAYO",   name: "Mayo General Hospital",   timezone: "America/New_York",    users: 142, assignments: 88,  active: true },
        { code: "STJUDE", name: "St. Jude Medical Center", timezone: "America/Chicago",     users: 96,  assignments: 54,  active: true },
        { code: "CLEVE",  name: "Cleveland Care Network",  timezone: "America/New_York",    users: 211, assignments: 132, active: true },
        { code: "MERCY",  name: "Mercy West",              timezone: "America/Los_Angeles", users: 67,  assignments: 29,  active: true },
        { code: "PINE",   name: "Pinecrest Regional",      timezone: "America/Denver",      users: 38,  assignments: 12,  active: false },
      ],
      selectedOrg: "MAYO",
      roleColors: {
        hospitalist: "#2563EB",
        er_doctor:   "#D97706",
        er_director: "#DC2626",
        director:    "#7C3AED",
        developer:   "#0F766E",
      },
      devUsers: [
        { id: uid("u"), name: "Dr. Lena Ortiz", role: "hospitalist", org: "MAYO", specialty: "Nephrology" },
        { id: uid("u"), name: "Priya Shah, NP", role: "hospitalist", org: "CLEVE", specialty: "Pulmonology" },
        { id: uid("u"), name: "Karen Vance", role: "director", org: "MAYO", specialty: "" },
        { id: uid("u"), name: "Dr. Ruth Osei", role: "er_doctor", org: "STJUDE", specialty: "" },
        { id: uid("u"), name: "Dr. Paul Okafor", role: "er_director", org: "CLEVE", specialty: "" },
        { id: uid("u"), name: "Sam Rivera", role: "developer", org: "MAYO", specialty: "", scope: "local" },
        { id: uid("u"), name: "Alex Kim (root)", role: "developer", org: "*", specialty: "", scope: "root" },
      ],
      diagnostics: null,

      conversations: [
        { id: "cv1", name: "Dr. Sarah Chen", role: "Cardiology", initials: "SC", presence: "online", tint: "emerald", unread: 2, typing: false,
          messages: [
            { me: false, text: "Got the round-robin assignment for patient SC, room 412.", at: t0 - 200000 },
            { me: true,  text: "Thanks — chest pain, SOB on exertion. Cardiology suggested.", at: t0 - 190000 },
            { me: false, text: "Accepting the 412 hand-off now.", at: t0 - 120000, read: true },
          ] },
        { id: "cv2", name: "ICU Care Team", role: "Group · 6 members", initials: "IC", presence: "online", tint: "blue", unread: 0, group: true, typing: false,
          messages: [{ me: false, text: "Bed 3 is open for the next admit.", at: t0 - 840000 }] },
        { id: "cv3", name: "Dr. Amir Patel", role: "Hospital Medicine", initials: "AP", presence: "pending", tint: "amber", unread: 0, typing: false,
          messages: [{ me: false, text: "On my way up — give me 5.", at: t0 - 3600000 }] },
        { id: "cv4", name: "Emergency broadcast", role: "Code · all providers", initials: "!", presence: "offline", tint: "slate", unread: 0, broadcast: true, typing: false,
          messages: [{ me: false, text: "Mass casualty drill at 14:00.", at: t0 - 10800000 }] },
      ],

      broadcasts: [
        { id: uid("bc"), title: "Code stroke — Bed 4 ICU", sev: "critical", at: t0 - 480000, acked: 11, total: 14, ackReq: true },
        { id: uid("bc"), title: "Diversion lifted — accepting transfers", sev: "info", at: t0 - 3600000, acked: 0, total: 0, ackReq: false },
        { id: uid("bc"), title: "Mass casualty drill at 15:00", sev: "warning", at: t0 - 10800000, acked: 22, total: 24, ackReq: true },
      ],

      settings: { timeout: 15, autoReassign: true, onCallOnly: false, activeOnly: true,
        flags: { sms: true, push: true, ai: true, broadcasts: true, amion: false },
        shiftTypes: [
          { id: "rounding",   name: "Rounding",   time: "07:00–19:00", color: "var(--status-active)" },
          { id: "swing",      name: "Swing",      time: "13:00–23:00", color: "var(--status-pending)" },
          { id: "nocturnist", name: "Nocturnist", time: "19:00–07:00", color: "var(--status-neutral)" },
        ],
        integrations: { twilio: true, firebase: true, openai: true, amion: false } },

      roles: [
        { id: "r_super", name: "Super Admin", desc: "Full platform access across all tenants and portals.", system: true,
          portals: ["hospitalist", "hosp_director", "er_physician", "er_director", "admin", "developer"],
          perms: ["view_census", "assign_patients", "manage_assignments", "view_reports", "manage_staff", "system_settings"],
          features: ["ai_chatbot", "portal_customization"], users: 3 },
        { id: "r_hospdir", name: "Hospitalist Director", desc: "Runs the hospitalist group — rotation, staff and census.", system: true,
          portals: ["hospitalist", "hosp_director"],
          perms: ["view_census", "assign_patients", "manage_assignments", "view_reports", "manage_staff"],
          features: ["ai_chatbot", "portal_customization"], users: 4 },
        { id: "r_hosp", name: "Hospitalist", desc: "Accepts hand-offs and manages their own census.", system: true,
          portals: ["hospitalist"], perms: ["view_census", "manage_assignments"], features: ["ai_chatbot"], users: 38 },
        { id: "r_erdir", name: "ER Director", desc: "Oversees ER intake and routing performance.", system: false,
          portals: ["er_physician", "er_director"], perms: ["view_census", "assign_patients", "view_reports"], features: ["ai_chatbot"], users: 2 },
        { id: "r_er", name: "ER Physician", desc: "Admits patients and routes them to hospitalists.", system: false,
          portals: ["er_physician"], perms: ["view_census", "assign_patients"], features: ["ai_chatbot"], users: 21 },
        { id: "r_tech", name: "Technician", desc: "Read-only census visibility for floor support.", system: false,
          portals: ["hospitalist"], perms: ["view_census"], features: [], users: 12 },
      ],

      notifications: [
        { id: uid("n"), icon: "route", title: "New assignment routed", body: "Patient RM → you · round-robin", at: t0 - 90000, read: false },
        { id: uid("n"), icon: "message-square", title: "Dr. Sarah Chen", body: "Accepting the 412 hand-off now.", at: t0 - 120000, read: false },
        { id: uid("n"), icon: "megaphone", title: "Code stroke — Bed 4 ICU", body: "Critical broadcast · ack required", at: t0 - 480000, read: true },
      ],

      audit: [
        { id: uid("a"), at: t0 - 1000,   actor: "Dr. R. Osei",   role: "er_doctor",   action: "create_assignment", resource: "assignment #a8842", ip: "10.2.4.18", risk: "low", org: "MAYO" },
        { id: uid("a"), at: t0 - 380000, actor: "Admin K. Vance", role: "director",    action: "reassign_patient",  resource: "assignment #a8830", ip: "10.2.4.6",  risk: "medium", org: "MAYO" },
        { id: uid("a"), at: t0 - 760000, actor: "Dr. S. Chen",    role: "hospitalist", action: "accept_assignment", resource: "assignment #a8829", ip: "10.2.7.91", risk: "low", org: "MAYO" },
        { id: uid("a"), at: t0 - 1500000,actor: "Admin K. Vance", role: "director",    action: "delete_conversation", resource: "conversation 3f9a", ip: "10.2.4.6", risk: "high", org: "MAYO" },
        { id: uid("a"), at: t0 - 1980000,actor: "Dr. A. Patel",   role: "hospitalist", action: "login",             resource: "session", ip: "10.2.7.40", risk: "low", org: "MAYO" },
      ],
      phiLog: [
        { id: uid("ph"), at: t0 - 1000,   actor: "Dr. R. Osei",  patient: "RM", access: "view", fields: "initials, room, issue", purpose: "Admission intake", ok: true },
        { id: uid("ph"), at: t0 - 290000, actor: "Dr. S. Chen",  patient: "DW", access: "edit", fields: "issue summary", purpose: "Care update", ok: true },
        { id: uid("ph"), at: t0 - 1010000,actor: "Dr. M. Lopez", patient: "TK", access: "view", fields: "full record", purpose: "—", ok: false },
        { id: uid("ph"), at: t0 - 2900000,actor: "Dr. A. Patel", patient: "BG", access: "export", fields: "discharge summary", purpose: "Transfer", ok: true },
      ],
      incidents: [
        { id: uid("i"), type: "failed_login", sev: "medium", desc: "5 failed logins for user #214 from 84.21.x.x", status: "investigating", at: t0 - 720000 },
        { id: uid("i"), type: "unauthorized_access", sev: "critical", desc: "Cross-tenant read attempt blocked — STJUDE → MAYO", status: "open", at: t0 - 1860000 },
        { id: uid("i"), type: "suspicious_activity", sev: "high", desc: "PHI export volume spike for user #51", status: "open", at: t0 - 3600000 },
        { id: uid("i"), type: "failed_login", sev: "low", desc: "Expired session reuse rejected", status: "resolved", at: t0 - 10800000 },
      ],

      lastAdmitAt: t0,
    };
  }

  /* ---- persistence ------------------------------------------------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 7) return null;
      // transient UI bits always reset sensibly
      s.ui = s.ui || { nav: "dashboard", notifOpen: false, realtime: true };
      s.ui.notifOpen = false;
      return s;
    } catch (e) { return null; }
  }

  var state = load() || seed();
  var listeners = new Set();
  var clockListeners = new Set();

  // Debounced persistence: batch write-heavy flows (e.g. typing, the 1s clock)
  // into one localStorage write at most every 250ms; flush on unload so nothing
  // is lost on refresh.
  var persistTimer = null;
  function persistNow() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function persist() { if (persistTimer) return; persistTimer = setTimeout(function () { persistTimer = null; persistNow(); }, 250); }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeunload", function () { if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; } persistNow(); });
  }
  function emit() { listeners.forEach(function (l) { l(); }); }

  // Mutate via a producer that always yields a NEW top-level object (so
  // useSyncExternalStore sees a changed reference), persists, and notifies.
  function set(producer) {
    var next = producer(state) || state;
    state = Object.assign({}, next);
    persist();
    emit();
  }
  function getState() { return state; }
  function subscribe(l) { listeners.add(l); return function () { listeners.delete(l); }; }
  function subscribeClock(l) { clockListeners.add(l); ensureClock(); return function () { clockListeners.delete(l); ensureClock(); }; }

  /* ---- derived ----------------------------------------------------------- */
  function sortedProviders() {
    return state.providers.slice().sort(function (a, b) { return (b.working - a.working) || (a.census - b.census); });
  }
  function rotationList() {
    return state.providers.filter(function (p) { return p.working && p.inRotation; });
  }
  function nextUp() {
    var r = rotationList();
    if (!r.length) return null;
    return r.slice().sort(function (a, b) { return a.census - b.census; })[0];
  }
  function unreadMessages() { return state.conversations.reduce(function (a, c) { return a + (c.unread || 0); }, 0); }
  function unreadNotifs() { return state.notifications.filter(function (n) { return !n.read; }).length; }

  // Patient-board modules a role sees, defaults merged with any saved overrides.
  // ER director starts with just the working tiles (admissions/accepted); the
  // census-table + FHIR-dependent sections stay off until the EHR is connected.
  function boardModulesFor(role) {
    var base = (role === "er_director")
      ? { admissions: true, accepted: true, awaiting: false, consultants: false, dataSource: false, census: false }
      : { admissions: true, accepted: true, awaiting: true, consultants: true, dataSource: true, census: true };
    var ov = (state.boardModules && state.boardModules[role]) || {};
    return Object.assign({}, base, ov);
  }

  /* ---- audit / notify helpers ------------------------------------------- */
  function pushAudit(s, entry) {
    var who = s.session ? actorName(s) : "System";
    var role = s.session ? s.session.role : "system";
    s.audit = [Object.assign({ id: uid("a"), at: now(), actor: who, role: role, ip: "10.2.7.40", org: s.selectedOrg || "MAYO", risk: "low" }, entry)].concat(s.audit).slice(0, 60);
  }
  function pushPhi(s, entry) {
    s.phiLog = [Object.assign({ id: uid("ph"), at: now(), actor: actorName(s), ok: true }, entry)].concat(s.phiLog).slice(0, 40);
  }
  function pushNotif(s, entry) {
    s.notifications = [Object.assign({ id: uid("n"), at: now(), read: false }, entry)].concat(s.notifications).slice(0, 30);
  }
  function actorName(s) { return (s.session && s.session.name) || s.me.name; }

  /* ---- the 1-second clock: live countdowns + expiry re-routing ---------- */
  var lastTickRender = 0;
  function tick() {
    var changed = false;
    var t = now();
    if (state.ui.realtime && !window.DT_LIVE) {
      // expiry-driven auto re-route
      if (state.settings.autoReassign) {
        state.pending.forEach(function (p) {
          if (!p.rerouted && p.via === "Round-robin" && p.expiresAt - t <= 0) {
            p.rerouted = true;
            var nx = nextUp();
            p.expiresAt = t + state.settings.timeout * 60000;
            p.from = p.from;
            changed = true;
            pushAudit(state, { action: "auto_reassign", resource: "assignment " + p.id, risk: "medium" });
            pushNotif(state, { icon: "repeat", title: "Assignment re-routed", body: "Patient " + p.initials + " expired — sent to next provider" });
          }
        });
      }
      // occasional new incoming admit (kept rare + capped)
      if (t - state.lastAdmitAt > 45000 && state.pending.length < 4 && Math.random() < 0.5) {
        var tmpl = ADMIT_POOL[Math.floor(Math.random() * ADMIT_POOL.length)];
        if (!state.pending.some(function (p) { return p.initials === tmpl.initials; })) {
          state.pending = [{ id: uid("a"), initials: tmpl.initials, room: tmpl.room, complaint: tmpl.complaint, specialty: tmpl.specialty, from: tmpl.from, via: "Round-robin", expiresAt: t + state.settings.timeout * 60000 }].concat(state.pending);
          state.lastAdmitAt = t;
          changed = true;
          pushNotif(state, { icon: "route", title: "New assignment routed", body: "Patient " + tmpl.initials + " → you · round-robin" });
          pushAudit(state, { actor: tmpl.from.replace(" (ER)", ""), role: "er_doctor", action: "create_assignment", resource: "assignment " + tmpl.initials, risk: "low" });
        } else { state.lastAdmitAt = t; }
      }
      // broadcast ack progress creeps up
      state.broadcasts.forEach(function (b) {
        if (b.ackReq && b.acked < b.total && Math.random() < 0.25) { b.acked = Math.min(b.total, b.acked + 1); changed = true; }
      });
    }
    if (changed) { state = Object.assign({}, state); persist(); emit(); }
    // clock listeners always fire (drives countdown labels) — throttled to 1s
    clockListeners.forEach(function (l) { l(); });
  }
  // Managed clock: only tick while live countdown UI is mounted (i.e. something
  // subscribed via useClock). Pauses entirely on the login screen / when idle.
  var clockTimer = null;
  function ensureClock() {
    if (clockListeners.size > 0 && !clockTimer) clockTimer = setInterval(tick, 1000);
    else if (clockListeners.size === 0 && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  /* ---- actions ----------------------------------------------------------- */
  var actions = {
    /* session */
    login: function (role, org, user) {
      set(function (s) {
        s.session = { role: role, org: org || "MERCY", user: user || "dr.chen", name: s.me.name };
        s.ui.nav = "dashboard"; s.ui.notifOpen = false;
        pushAudit(s, { action: "login", resource: "session", risk: "low" });
        return s;
      });
    },
    logout: function () { set(function (s) { pushAudit(s, { action: "logout", resource: "session", risk: "low" }); s.session = null; s.ui.notifOpen = false; return s; }); },
    setNav: function (nav) { set(function (s) { s.ui.nav = nav; s.ui.notifOpen = false; return s; }); },
    setRole: function (role) { set(function (s) { s.session = Object.assign({}, s.session, { role: role }); s.ui.nav = "dashboard"; s.ui.notifOpen = false; return s; }); },
    toggleNotif: function (open) { set(function (s) { s.ui.notifOpen = open == null ? !s.ui.notifOpen : open; if (s.ui.notifOpen) s.notifications = s.notifications.map(function (n) { return Object.assign({}, n, { read: true }); }); return s; }); },
    toggleRealtime: function (on) { set(function (s) { s.ui.realtime = on == null ? !s.ui.realtime : on; return s; }); },
    toggleOnShift: function () { set(function (s) { s.ui.onShift = !s.ui.onShift; return s; }); },
    markNotifRead: function (id) { set(function (s) { s.notifications = s.notifications.map(function (n) { return n.id === id ? Object.assign({}, n, { read: true }) : n; }); return s; }); },

    /* hospitalist */
    accept: function (id) {
      set(function (s) {
        var p = s.pending.find(function (x) { return x.id === id; }); if (!p) return s;
        s.pending = s.pending.filter(function (x) { return x.id !== id; });
        s.myPatients = [{ id: "n" + id, initials: p.initials, room: p.room, complaint: p.complaint }].concat(s.myPatients);
        s.myAdmissions = [{ id: "ma" + id, at: now(), initials: p.initials, room: p.room, complaint: p.complaint }].concat(s.myAdmissions || []);
        s.acceptedToday = (s.acceptedToday || 0) + 1;
        // reflect on the board
        var bd = s.board.find(function (b) { return b.initials === p.initials; });
        if (bd) { bd.status = "admitted"; bd.attending = { name: s.me.name, avatar: s.me.avatar }; }
        else s.board = [{ id: uid("b"), initials: p.initials, room: p.room, dept: "MED", issue: p.complaint, status: "admitted", attending: { name: s.me.name, avatar: s.me.avatar }, unit: s.team.filter(function (m) { return m.onCall; }).map(function (m) { return { avatar: m.avatar, role: m.role }; }), consultants: [], er: { name: p.from.replace(" (ER)", ""), avatar: "Er" } }].concat(s.board);
        pushAudit(s, { action: "accept_assignment", resource: "assignment " + id, risk: "low" });
        pushPhi(s, { patient: p.initials, access: "view", fields: "initials, room, issue", purpose: "Assignment accept" });
        s.__toast = { tone: "accepted", title: "Assignment accepted", msg: "Patient " + p.initials + " added to your census." };
        return s;
      });
    },
    decline: function (id) {
      set(function (s) {
        var p = s.pending.find(function (x) { return x.id === id; }); if (!p) return s;
        s.pending = s.pending.filter(function (x) { return x.id !== id; });
        pushAudit(s, { action: "decline_assignment", resource: "assignment " + id, risk: "low" });
        s.__toast = { tone: "rejected", title: "Declined — re-routing", msg: "Patient " + p.initials + " sent to the next provider." };
        return s;
      });
    },

    /* ER */
    sendAssignment: function (provider, fields, consults) {
      set(function (s) {
        var entry = { id: uid("s"), initials: fields.initials, provider: provider.name, complaint: fields.complaint, consultants: consults || [], time: "Today · " + clockLabel(), day: "Today", status: "sent" };
        s.sent = [entry].concat(s.sent);
        // create a board row (routing) + a pending request for the receiving hospitalist view
        s.board = [{ id: uid("b"), initials: fields.initials, room: fields.room || "—", dept: "MED", issue: fields.complaint || "—", status: "pending", attending: { name: "", avatar: "" }, unit: [], consultants: consults || [], er: { name: s.me.name, avatar: "Er" } }].concat(s.board);
        var via = provider.id === (nextUp() || {}).id ? "Round-robin" : "Manual";
        s.pending = s.pending.concat([{ id: uid("a"), initials: fields.initials, room: fields.room || "—", complaint: fields.complaint || "—", from: "You (ER)", specialty: fields.specialty || "General Medicine", via: via, expiresAt: now() + s.settings.timeout * 60000 }]);
        // append to the admissions log (every admission given to a team)
        s.admissions = [{ id: uid("ad"), at: now(), initials: fields.initials, room: fields.room || "—", provider: provider.name, specialty: fields.specialty || "General Medicine", via: via, status: "sent" }].concat(s.admissions || []);
        s.lastAdmitAt = now();
        pushAudit(s, { action: "create_assignment", resource: "assignment " + entry.id, risk: "low" });
        pushPhi(s, { patient: fields.initials, access: "view", fields: "initials, room, issue", purpose: "Admission intake" });
        var extra = (consults && consults.length) ? " + " + consults.length + " consult" + (consults.length > 1 ? "s" : "") + " · push + SMS fallback." : " Notified by push and SMS fallback.";
        s.__toast = { tone: "sent", title: "Assignment sent to " + provider.name, msg: extra.trim() };
        return s;
      });
    },
    reassignSent: function (id, name) {
      set(function (s) {
        s.sent = s.sent.map(function (x) { return x.id === id ? Object.assign({}, x, { provider: name, status: "sent" }) : x; });
        pushAudit(s, { action: "reassign_patient", resource: "assignment " + id, risk: "medium" });
        s.__toast = { tone: "sent", title: "Reassigned to " + name, msg: "Previous provider notified of the hand-off change." };
        return s;
      });
    },

    /* director — provider mgmt */
    toggleWorking: function (id) { set(function (s) { s.providers = s.providers.map(function (p) { return p.id === id ? Object.assign({}, p, { working: !p.working }) : p; }); return s; }); },
    adjustCensus: function (id, d) { set(function (s) { s.providers = s.providers.map(function (p) { return p.id === id ? Object.assign({}, p, { census: Math.max(0, Math.min(p.cap, p.census + d)) }) : p; }); return s; }); },
    adjustCap: function (id, d) { set(function (s) { s.providers = s.providers.map(function (p) { return p.id === id ? Object.assign({}, p, { cap: Math.max(1, p.cap + d) }) : p; }); return s; }); },
    bulkWorking: function (on) { set(function (s) { s.providers = s.providers.map(function (p) { return Object.assign({}, p, { working: on }); }); return s; }); },
    setAllCap: function (n) { set(function (s) { s.providers = s.providers.map(function (p) { return Object.assign({}, p, { cap: n, census: Math.min(p.census, n) }); }); s.__toast = { tone: "accepted", title: "Cap applied", msg: "Daily census limit set to " + n + " for all providers." }; return s; }); },
    toggleRotation: function (id) { set(function (s) { s.providers = s.providers.map(function (p) { return p.id === id ? Object.assign({}, p, { inRotation: !p.inRotation }) : p; }); return s; }); },
    setShiftFor: function (id, sid) { set(function (s) { s.providers = s.providers.map(function (p) { return p.id === id ? Object.assign({}, p, { shift: sid }) : p; }); return s; }); },
    updateShift: function (sid, patch) { set(function (s) { s.shifts = s.shifts.map(function (x) { return x.id === sid ? Object.assign({}, x, patch) : x; }); return s; }); },
    reorderProviders: function (dragId, targetId) {
      set(function (s) {
        var a = s.providers.slice();
        var from = a.findIndex(function (p) { return p.id === dragId; }), to = a.findIndex(function (p) { return p.id === targetId; });
        if (from < 0 || to < 0 || from === to) return s;
        var m = a.splice(from, 1)[0]; a.splice(to, 0, m); s.providers = a; return s;
      });
    },
    addProvider: function (data) {
      set(function (s) {
        var name = data.name.trim(); if (!name) return s;
        var fmt = /,|PA|NP|RN/.test(name) ? name : (/^Dr\.?/i.test(name) ? name : "Dr. " + name);
        s.providers = s.providers.concat([{ id: uid("h"), name: fmt, avatar: initialsOf(fmt), specialty: data.specialty || "Hospital Medicine", census: 0, cap: parseInt(data.cap, 10) || 12, working: true, shift: data.shift || "day", inRotation: true }]);
        pushAudit(s, { action: "create_provider", resource: fmt, risk: "low" });
        s.__toast = { tone: "accepted", title: "Provider added", msg: fmt + " added to " + (s.shifts.find(function (x) { return x.id === (data.shift || "day"); }) || {}).label + "." };
        return s;
      });
    },
    updateProvider: function (id, patch) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          if (p.id !== id) return p;
          var np = Object.assign({}, p, patch);
          if (patch.name != null) np.avatar = initialsOf(patch.name) || p.avatar;
          return np;
        });
        if (patch.name != null) pushAudit(s, { action: "rename_provider", resource: id, risk: "low" });
        return s;
      });
    },
    removeProvider: function (id) {
      set(function (s) {
        var p = s.providers.find(function (x) { return x.id === id; });
        s.providers = s.providers.filter(function (x) { return x.id !== id; });
        if (p) { pushAudit(s, { action: "remove_provider", resource: p.name, risk: "medium" }); s.__toast = { tone: "rejected", title: "Provider removed", msg: p.name + " removed from the group." }; }
        return s;
      });
    },
    renameShift: function (sid, label) { set(function (s) { s.shifts = s.shifts.map(function (x) { return x.id === sid ? Object.assign({}, x, { label: label }) : x; }); return s; }); },
    resetRotation: function () { set(function (s) { s.rotationCursor = 0; pushAudit(s, { action: "reset_rotation_index", resource: "rotation", risk: "low" }); s.__toast = { tone: "accepted", title: "Rotation index reset", msg: "Round-robin will start from the top." }; return s; }); },
    // Director command: reset the dashboard's rolling 24h admissions counter.
    // The admissions log is untouched — only the "since reset" window moves.
    resetAdmissions24h: function () {
      set(function (s) {
        s.admissionsResetAt = now();
        pushAudit(s, { action: "reset_admissions_counter", resource: "admissions (24h)", risk: "low" });
        s.__toast = { tone: "accepted", title: "24h admissions reset", msg: "Daily count cleared. Full history stays in the admissions log." };
        return s;
      });
    },

    /* ER director — ER physician staffing + diversion */
    toggleErPhysician: function (id) { set(function (s) { s.erPhysicians = s.erPhysicians.map(function (p) { return p.id === id ? Object.assign({}, p, { working: !p.working }) : p; }); return s; }); },
    updateErPhysician: function (id, patch) { set(function (s) { s.erPhysicians = s.erPhysicians.map(function (p) { return p.id === id ? Object.assign({}, p, patch) : p; }); if (patch.name != null) pushAudit(s, { action: "rename_er_physician", resource: id, risk: "low" }); return s; }); },
    setErShift: function (id, sid) { set(function (s) { s.erPhysicians = s.erPhysicians.map(function (p) { return p.id === id ? Object.assign({}, p, { shift: sid }) : p; }); return s; }); },
    addErPhysician: function (data) {
      set(function (s) {
        var name = data.name && data.name.trim(); if (!name) { s.__toast = { tone: "rejected", title: "Name required", msg: "Enter the physician's name." }; return s; }
        var fmt = /^Dr\.?/i.test(name) ? name : "Dr. " + name;
        s.erPhysicians = s.erPhysicians.concat([{ id: uid("e"), name: fmt, avatar: initialsOf(fmt), working: true, shift: data.shift || "day", admitsToday: 0 }]);
        pushAudit(s, { action: "create_er_physician", resource: fmt, risk: "low" });
        s.__toast = { tone: "accepted", title: "ER physician added", msg: fmt + " added to the ER roster." };
        return s;
      });
    },
    removeErPhysician: function (id) { set(function (s) { var p = s.erPhysicians.find(function (x) { return x.id === id; }); s.erPhysicians = s.erPhysicians.filter(function (x) { return x.id !== id; }); if (p) { pushAudit(s, { action: "remove_er_physician", resource: p.name, risk: "medium" }); s.__toast = { tone: "rejected", title: "Removed", msg: p.name + " removed from the ER roster." }; } return s; }); },
    toggleDiversion: function () {
      set(function (s) {
        s.diversion = !s.diversion;
        pushAudit(s, { action: s.diversion ? "declare_diversion" : "lift_diversion", resource: s.selectedOrg || "ER", risk: s.diversion ? "high" : "low" });
        s.broadcasts = [{ id: uid("bc"), title: s.diversion ? "ER on diversion — divert incoming ambulances" : "Diversion lifted — accepting transfers", sev: s.diversion ? "critical" : "info", at: now(), acked: 0, total: s.diversion ? 18 : 0, ackReq: s.diversion }].concat(s.broadcasts);
        s.__toast = { tone: s.diversion ? "rejected" : "accepted", title: s.diversion ? "Diversion declared" : "Diversion lifted", msg: s.diversion ? "EMS notified; broadcast sent to all providers." : "Now accepting incoming transfers." };
        return s;
      });
    },

    /* org + board editing */
    updateOrg: function (code, patch) {
      set(function (s) {
        s.orgs = s.orgs.map(function (o) { return o.code === code ? Object.assign({}, o, patch) : o; });
        if (patch.code && patch.code !== code) { if (s.selectedOrg === code) s.selectedOrg = patch.code; }
        pushAudit(s, { action: "update_organization", resource: code, risk: "medium" });
        return s;
      });
    },
    updateShiftType: function (id, patch) { set(function (s) { s.settings = Object.assign({}, s.settings, { shiftTypes: s.settings.shiftTypes.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; }) }); return s; }); },
    removeShiftType: function (id) { set(function (s) { s.settings = Object.assign({}, s.settings, { shiftTypes: s.settings.shiftTypes.filter(function (x) { return x.id !== id; }) }); return s; }); },
    updateBoardRow: function (id, patch) { set(function (s) { s.board = s.board.map(function (b) { return b.id === id ? Object.assign({}, b, patch) : b; }); pushAudit(s, { action: "edit_admission", resource: id, risk: "low" }); return s; }); },
    addBoardPatient: function (data) {
      set(function (s) {
        var init = (data.initials || "").toUpperCase().slice(0, 3); if (!init) { s.__toast = { tone: "rejected", title: "Initials required", msg: "Enter the patient's initials." }; return s; }
        var pr = data.attending ? s.providers.find(function (p) { return p.name === data.attending; }) : null;
        var row = { id: uid("b"), initials: init, room: data.room || "—", dept: data.dept || "MED", issue: data.issue || "—",
          status: data.attending ? "admitted" : "pending",
          attending: data.attending ? { name: data.attending, avatar: pr ? pr.avatar : initialsOf(data.attending) } : { name: "", avatar: "" },
          unit: [], consultants: data.consultants || [], er: { name: data.er || actorName(s), avatar: "Er" } };
        s.board = [row].concat(s.board);
        pushAudit(s, { action: "create_admission", resource: "patient " + init, risk: "low" });
        pushPhi(s, { patient: init, access: "create", fields: "initials, room, issue", purpose: "Manual admission" });
        s.__toast = { tone: "accepted", title: "Admission added", msg: "Patient " + init + (data.attending ? " admitted to " + data.attending + "." : " queued for acceptance.") };
        return s;
      });
    },
    removeBoardPatient: function (id) {
      set(function (s) {
        var b = s.board.find(function (x) { return x.id === id; });
        s.board = s.board.filter(function (x) { return x.id !== id; });
        if (b) { pushAudit(s, { action: "remove_admission", resource: "patient " + b.initials, risk: "medium" }); s.__toast = { tone: "rejected", title: "Admission removed", msg: "Patient " + b.initials + " removed from the board." }; }
        return s;
      });
    },
    connectFhir: function () {
      set(function (s) {
        s.fhir = Object.assign({}, s.fhir, { connected: true, lastSync: now() });
        // simulate a sync pulling two admissions from the EHR
        var pull = [
          { id: uid("b"), initials: "EHR1", room: "514", dept: "MED", issue: "Cellulitis, IV antibiotics", status: "admitted", attending: { name: "Dr. Amir Patel", avatar: "AP" }, unit: [], consultants: ["Infectious Disease"], er: { name: "Epic FHIR", avatar: "FH" }, synced: true },
          { id: uid("b"), initials: "EHR2", room: "230", dept: "ICU", issue: "Respiratory failure, intubated", status: "observation", attending: { name: "Dr. Maria Lopez", avatar: "ML" }, unit: [{ avatar: "PS", role: "NP" }], consultants: ["Pulmonology"], er: { name: "Epic FHIR", avatar: "FH" }, synced: true },
        ].filter(function (n) { return !s.board.some(function (b) { return b.initials === n.initials; }); });
        s.board = pull.concat(s.board);
        pushAudit(s, { action: "connect_fhir", resource: s.fhir.source, risk: "medium" });
        s.__toast = { tone: "accepted", title: "Connected to " + s.fhir.source, msg: "Census is now syncing from the EHR (" + pull.length + " pulled)." };
        return s;
      });
    },
    disconnectFhir: function () { set(function (s) { s.fhir = Object.assign({}, s.fhir, { connected: false }); pushAudit(s, { action: "disconnect_fhir", resource: s.fhir.source, risk: "low" }); s.__toast = { tone: "rejected", title: "EHR disconnected", msg: "Switched to manual census entry." }; return s; }); },
    syncFhir: function () { set(function (s) { s.fhir = Object.assign({}, s.fhir, { lastSync: now() }); s.__toast = { tone: "accepted", title: "Census synced", msg: "Pulled the latest admissions from " + s.fhir.source + "." }; return s; }); },
    reassignBoard: function (id, providerName) {
      set(function (s) {
        var pr = s.providers.find(function (p) { return p.name === providerName; });
        s.board = s.board.map(function (b) { return b.id === id ? Object.assign({}, b, { attending: { name: providerName, avatar: pr ? pr.avatar : initialsOf(providerName) }, status: b.status === "pending" ? "admitted" : b.status }) : b; });
        pushAudit(s, { action: "reassign_patient", resource: id + " → " + providerName, risk: "medium" });
        s.__toast = { tone: "sent", title: "Reassigned to " + providerName, msg: "Board updated; previous owner notified." };
        return s;
      });
    },
    renameMe: function (name) { set(function (s) { if (!name.trim()) return s; s.me = Object.assign({}, s.me, { name: name, avatar: initialsOf(name) }); if (s.session) s.session = Object.assign({}, s.session, { name: name }); return s; }); },

    /* care team */
    addMember: function (id) {
      set(function (s) {
        var c = s.candidates.find(function (x) { return x.id === id; }); if (!c) return s;
        s.team = s.team.concat([Object.assign({}, c, { onCall: true })]);
        s.__toast = { tone: "accepted", title: c.name + " added to your unit", msg: "They now share your requests and threads." };
        return s;
      });
    },
    removeMember: function (id) { set(function (s) { s.team = s.team.filter(function (m) { return m.id !== id; }); return s; }); },
    toggleMemberCall: function (id) { set(function (s) { s.team = s.team.map(function (m) { return m.id === id ? Object.assign({}, m, { onCall: !m.onCall }) : m; }); return s; }); },

    /* messaging */
    openConversation: function (id) { set(function (s) { s.conversations = s.conversations.map(function (c) { return c.id === id ? Object.assign({}, c, { unread: 0 }) : c; }); s.__activeConvo = id; return s; }); },
    sendMessage: function (id, text) {
      if (!text || !text.trim()) return;
      set(function (s) {
        s.conversations = s.conversations.map(function (c) {
          if (c.id !== id) return c;
          return Object.assign({}, c, { messages: c.messages.concat([{ me: true, text: text.trim(), at: now() }]), unread: 0 });
        });
        pushAudit(s, { action: "send_message", resource: "conversation " + id, risk: "low" });
        return s;
      });
      // simulated reply + typing
      var convo = state.conversations.find(function (c) { return c.id === id; });
      if (convo && !convo.broadcast) {
        set(function (s) { s.conversations = s.conversations.map(function (c) { return c.id === id ? Object.assign({}, c, { typing: true }) : c; }); return s; });
        setTimeout(function () {
          set(function (s) {
            s.conversations = s.conversations.map(function (c) {
              if (c.id !== id) return c;
              s2reply = REPLIES[Math.floor(Math.random() * REPLIES.length)];
              return Object.assign({}, c, { typing: false, messages: c.messages.concat([{ me: false, text: s2reply, at: now(), read: false }]) });
            });
            return s;
          });
        }, 1800 + Math.random() * 1400);
      }
    },
    startConversation: function (participant) {
      set(function (s) {
        var existing = s.conversations.find(function (c) { return c.name === participant.name; });
        if (existing) { s.__activeConvo = existing.id; s.conversations = s.conversations.map(function (c) { return c.id === existing.id ? Object.assign({}, c, { unread: 0 }) : c; }); return s; }
        var id = uid("cv");
        s.conversations = [{ id: id, name: participant.name, role: participant.specialty || participant.role || "Provider", initials: participant.avatar || initialsOf(participant.name), presence: participant.working === false ? "offline" : "online", tint: participant.tint || "blue", unread: 0, typing: false, messages: [] }].concat(s.conversations);
        s.__activeConvo = id;
        return s;
      });
    },

    /* broadcasts */
    sendBroadcast: function (data) {
      set(function (s) {
        var total = data.ackReq ? (10 + Math.floor(Math.random() * 14)) : 0;
        s.broadcasts = [{ id: uid("bc"), title: data.title || "(untitled broadcast)", sev: data.severity, at: now(), acked: 0, total: total, ackReq: data.ackReq }].concat(s.broadcasts);
        pushAudit(s, { action: "send_broadcast", resource: data.title || "broadcast", risk: data.severity === "emergency" || data.severity === "critical" ? "high" : "low" });
        s.__toast = { tone: "sent", title: "Broadcast sent", msg: (data.audience.length) + " audience group(s) notified" + (data.ackReq ? " · ack required" : "") + "." };
        return s;
      });
    },

    /* developer */
    selectOrg: function (code) { set(function (s) { s.selectedOrg = code; return s; }); },
    addTenant: function (data) {
      set(function (s) {
        var code = (data.code || data.name.slice(0, 5)).toUpperCase().replace(/[^A-Z]/g, "");
        if (!data.name.trim() || !code) { s.__toast = { tone: "rejected", title: "Name & code required", msg: "Enter a hospital name and short code." }; return s; }
        s.orgs = s.orgs.concat([{ code: code, name: data.name, timezone: data.timezone || "America/New_York", users: 1, assignments: 0, active: true }]);
        pushAudit(s, { action: "create_organization", resource: code, risk: "high" });
        s.__toast = { tone: "accepted", title: "Tenant created", msg: data.name + " (" + code + ") provisioned." };
        return s;
      });
    },
    toggleTenant: function (code) { set(function (s) { s.orgs = s.orgs.map(function (o) { return o.code === code ? Object.assign({}, o, { active: !o.active }) : o; }); return s; }); },
    addUser: function (form) {
      set(function (s) {
        if (!form.name.trim()) { s.__toast = { tone: "rejected", title: "Name required", msg: "Enter the user's full name." }; return s; }
        var isRoot = form.role === "developer" && form.scope === "root";
        var org = isRoot ? "*" : form.org;
        s.devUsers = [{ id: uid("u"), name: form.name, role: form.role, org: org, specialty: form.role === "hospitalist" ? form.specialty : "", scope: form.role === "developer" ? (form.scope || "local") : undefined }].concat(s.devUsers);
        if (!isRoot) s.orgs = s.orgs.map(function (o) { return o.code === form.org ? Object.assign({}, o, { users: o.users + 1 }) : o; });
        pushAudit(s, { action: "create_user", resource: form.name + " @ " + (isRoot ? "ALL ORGS" : form.org), risk: isRoot ? "high" : "medium" });
        var label = ({ hospitalist: "Hospitalist", er_doctor: "ER physician", er_director: "ER director", director: "Director", developer: isRoot ? "Root developer" : "Local developer" })[form.role];
        s.__toast = { tone: "accepted", title: label + " created", msg: form.name + " added to " + (isRoot ? "all organizations" : form.org) + "." };
        return s;
      });
    },
    removeUser: function (id) {
      set(function (s) {
        var u = s.devUsers.find(function (x) { return x.id === id; });
        s.devUsers = s.devUsers.filter(function (x) { return x.id !== id; });
        if (u && u.org !== "*") s.orgs = s.orgs.map(function (o) { return o.code === u.org ? Object.assign({}, o, { users: Math.max(0, o.users - 1) }) : o; });
        if (u) { pushAudit(s, { action: "remove_user", resource: u.name, risk: "medium" }); s.__toast = { tone: "rejected", title: "User removed", msg: u.name + " removed." }; }
        return s;
      });
    },
    // Import providers parsed from an external schedule (Amion) as real users.
    // Demo base: adds them to the local devUsers list; the live bridge overrides
    // this to actually provision them in the org via the backend.
    importProviders: function (orgCode, providers) {
      set(function (s) {
        var added = 0;
        (providers || []).forEach(function (p) {
          var exists = (s.devUsers || []).some(function (u) { return u.name === p.name && u.org === orgCode; });
          if (exists) return;
          s.devUsers = [{ id: uid("u"), name: p.name, role: "hospitalist", org: orgCode, specialty: p.group || "", scope: "local" }].concat(s.devUsers || []);
          added++;
        });
        if (added) s.orgs = (s.orgs || []).map(function (o) { return o.code === orgCode ? Object.assign({}, o, { users: o.users + added }) : o; });
        s.__toast = added
          ? { tone: "accepted", title: "Imported " + added + " provider(s)", msg: "Added to " + orgCode + " as users." }
          : { tone: "rejected", title: "Nothing to import", msg: "Those providers already exist." };
        return s;
      });
      return Promise.resolve({ added: (providers || []).length, skipped: 0 });
    },
    setRoleColor: function (role, color) { set(function (s) { s.roleColors = Object.assign({}, s.roleColors, (function () { var o = {}; o[role] = color; return o; })()); pushAudit(s, { action: "customize_role_color", resource: role, risk: "low" }); return s; }); },
    runDiagnostics: function () {
      set(function (s) {
        var insights = [
          "STJUDE assignment expiry rate up 18% this shift — likely the delayed Twilio queue. Suggest enabling push-first fallback.",
          "MAYO round-robin fairness within 4% across providers — no cap relief triggered in the last 24h.",
          "CLEVE WebSocket reconnect rate normal; 0 dropped events in the last hour.",
          "Cross-tenant isolation checks: 0 violations. 1 attempt blocked and logged (STJUDE → MAYO).",
        ];
        s.diagnostics = { text: insights[Math.floor(Math.random() * insights.length)], at: now() };
        pushAudit(s, { action: "run_ai_diagnostics", resource: "platform", risk: "low" });
        return s;
      });
    },

    /* patient-board modules — per role, toggle a section on/off */
    setBoardModule: function (role, key, on) {
      set(function (s) {
        var cur = Object.assign({}, (s.boardModules && s.boardModules[role]) || {});
        cur[key] = on;
        s.boardModules = Object.assign({}, s.boardModules, (function () { var o = {}; o[role] = cur; return o; })());
        return s;
      });
    },

    /* per-organization on-call schedule source (Amion / QGenda / custom / …) */
    setScheduleSource: function (code, source) {
      set(function (s) {
        s.scheduleSources = Object.assign({}, s.scheduleSources, (function () { var o = {}; o[code] = source; return o; })());
        pushAudit(s, { action: "set_schedule_source", resource: code + " → " + source, risk: "low" });
        s.__toast = { tone: "accepted", title: "Schedule source updated", msg: code + " now syncs via " + source + "." };
        return s;
      });
    },

    /* org settings */
    setSetting: function (key, val) { set(function (s) { s.settings = Object.assign({}, s.settings, (function () { var o = {}; o[key] = val; return o; })()); return s; }); },
    toggleFlag: function (key) { set(function (s) { s.settings = Object.assign({}, s.settings, { flags: Object.assign({}, s.settings.flags, (function () { var o = {}; o[key] = !s.settings.flags[key]; return o; })()) }); pushAudit(s, { action: "toggle_feature_flag", resource: key, risk: "low" }); return s; }); },
    toggleIntegration: function (key) { set(function (s) { s.settings = Object.assign({}, s.settings, { integrations: Object.assign({}, s.settings.integrations, (function () { var o = {}; o[key] = !s.settings.integrations[key]; return o; })()) }); pushAudit(s, { action: "toggle_integration", resource: key, risk: "medium" }); s.__toast = { tone: "accepted", title: (s.settings.integrations[key] ? "Connected" : "Disconnected"), msg: key + " integration updated." }; return s; }); },
    addShiftType: function () {
      set(function (s) {
        var n = s.settings.shiftTypes.length + 1;
        s.settings.shiftTypes = s.settings.shiftTypes.concat([{ id: uid("st"), name: "Custom shift " + n, time: "08:00–20:00", color: "var(--primary)" }]);
        return s;
      });
    },
    // Agentically add shift types detected from an external schedule (Amion):
    // any time interval the schedule uses that the org doesn't already have
    // becomes a shift type. Returns count added. Dedupes by time range.
    importShiftTypes: function (types) {
      var added = 0;
      set(function (s) {
        var have = {};
        s.settings.shiftTypes.forEach(function (x) { have[x.time] = true; have[(x.name || "").toLowerCase()] = true; });
        var fresh = (types || []).filter(function (t) {
          if (have[t.time] || have[(t.name || "").toLowerCase()]) return false;
          have[t.time] = true; have[(t.name || "").toLowerCase()] = true; added++;
          return true;
        }).map(function (t) {
          return { id: uid("st"), name: t.name, time: t.time, color: t.color || "var(--primary)" };
        });
        s.settings.shiftTypes = s.settings.shiftTypes.concat(fresh);
        s.__toast = added
          ? { tone: "accepted", title: "Added " + added + " shift type(s)", msg: "Detected from the schedule's time intervals." }
          : { tone: "rejected", title: "No new shift types", msg: "All detected intervals already exist." };
        return s;
      });
      return Promise.resolve({ added: added });
    },
    resolveIncident: function (id) { set(function (s) { s.incidents = s.incidents.map(function (i) { return i.id === id ? Object.assign({}, i, { status: "resolved" }) : i; }); pushAudit(s, { action: "resolve_incident", resource: id, risk: "low" }); return s; }); },

    /* toast lifecycle */
    toast: function (t) { set(function (s) { s.__toast = t; return s; }); },
    clearToast: function () { set(function (s) { s.__toast = null; return s; }); },

    /* role management */
    createRole: function (data) {
      set(function (s) {
        if (!data.name || !data.name.trim()) { s.__toast = { tone: "rejected", title: "Role name required", msg: "Give the role a name." }; return s; }
        s.roles = s.roles.concat([{ id: uid("r"), name: data.name.trim(), desc: (data.desc || "").trim(), system: false,
          portals: data.portals || [], perms: data.perms || [], features: data.features || [], users: 0 }]);
        pushAudit(s, { action: "create_role", resource: data.name.trim(), risk: "medium" });
        s.__toast = { tone: "accepted", title: "Role created", msg: data.name.trim() + " is ready to assign." };
        return s;
      });
    },
    updateRole: function (id, patch) {
      set(function (s) {
        s.roles = s.roles.map(function (r) { return r.id === id ? Object.assign({}, r, patch) : r; });
        pushAudit(s, { action: "update_role", resource: id, risk: "medium" });
        return s;
      });
    },
    deleteRole: function (id) {
      set(function (s) {
        var r = s.roles.find(function (x) { return x.id === id; });
        if (r && r.system) { s.__toast = { tone: "rejected", title: "Protected role", msg: "Built-in roles can't be deleted." }; return s; }
        s.roles = s.roles.filter(function (x) { return x.id !== id; });
        if (r) { pushAudit(s, { action: "delete_role", resource: r.name, risk: "high" }); s.__toast = { tone: "rejected", title: "Role deleted", msg: r.name + " removed." }; }
        return s;
      });
    },

    /* appearance & layout customization */
    setTheme: function (patch) { set(function (s) { s.theme = Object.assign({}, s.theme, patch); pushAudit(s, { action: "update_appearance", resource: Object.keys(patch).join(","), risk: "low" }); return s; }); },
    toggleNavItem: function (role, id) {
      set(function (s) {
        if (id === "dashboard") return s; // home is always present
        var hidden = (s.navHidden[role] || []).slice();
        var i = hidden.indexOf(id);
        if (i >= 0) hidden.splice(i, 1); else hidden.push(id);
        s.navHidden = Object.assign({}, s.navHidden, (function () { var o = {}; o[role] = hidden; return o; })());
        return s;
      });
    },
    moveNavItem: function (role, ids, id, dir) {
      set(function (s) {
        var arr = ids.slice();
        var from = arr.indexOf(id), to = from + dir;
        if (from < 0 || to < 0 || to >= arr.length) return s;
        var m = arr.splice(from, 1)[0]; arr.splice(to, 0, m);
        s.navOrder = Object.assign({}, s.navOrder, (function () { var o = {}; o[role] = arr; return o; })());
        return s;
      });
    },
    resetLayout: function (role) {
      set(function (s) {
        s.theme = { appName: "DocTurn", accent: "#2563EB", radius: 8, sidebar: "expanded", contentWidth: "standard" };
        s.navHidden = Object.assign({}, s.navHidden, (function () { var o = {}; o[role] = []; return o; })());
        s.navOrder = Object.assign({}, s.navOrder, (function () { var o = {}; o[role] = null; return o; })());
        s.__toast = { tone: "accepted", title: "Layout reset", msg: "Appearance and navigation restored to defaults." };
        return s;
      });
    },

    /* danger zone */
    resetAll: function () { state = seed(); persist(); emit(); },
  };

  var REPLIES = [
    "Copy — on it.", "Thanks for the heads up.", "Accepting now.", "Give me 5 minutes.",
    "Got it, will round shortly.", "Understood. I'll update the chart.", "On my way up.",
  ];
  var s2reply;

  /* ---- React hooks ------------------------------------------------------- */
  function useStore() {
    var R = window.React;
    return R.useSyncExternalStore(subscribe, getState, getState);
  }
  function useClock() {
    var R = window.React;
    var sub = R.useCallback(function (cb) { return subscribeClock(cb); }, []);
    return R.useSyncExternalStore(sub, function () { return Math.floor(Date.now() / 1000); });
  }

  /* ---- expose ------------------------------------------------------------ */
  window.DT = { getState: getState, subscribe: subscribe, actions: actions, set: set, seed: seed, sortedProviders: sortedProviders, rotationList: rotationList, nextUp: nextUp, unreadMessages: unreadMessages, unreadNotifs: unreadNotifs, extractIntake: extractIntake, boardModules: boardModulesFor };
  window.useStore = useStore;
  window.useActions = function () { return actions; };
  window.useClock = useClock;
  window.dtFmt = { mmss: mmss, ago: ago, hhmm: hhmm, clockLabel: clockLabel, initialsOf: initialsOf };
  window.extractIntake = extractIntake;
})();
