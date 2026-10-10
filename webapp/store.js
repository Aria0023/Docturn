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
  // A live deployment: api-bridge.js (loaded right after this file) sets
  // window.DT_LIVE and every slice below that the server owns comes from the
  // server. The kit's demo tenants, demo staff and demo notifications are
  // then never seeded — not even for the first paint before the server
  // answers (A.CON developer #23/#24). The bridge also clears them from the
  // first seed, which ran before it loaded.
  function isLive() { try { return !!(typeof window !== "undefined" && window.DT_LIVE); } catch (e) { return false; } }
  var uid = (function () { var n = 1000; return function (p) { return (p || "id") + "_" + (++n) + "_" + Math.floor(Math.random() * 1e4); }; })();

  /* ---- time helpers ------------------------------------------------------
     ONE clock format for every label in the app (A.CON-MIN-18): the device
     locale's own hour cycle via Intl.DateTimeFormat — "3:04 PM" on a 12-hour
     device, "15:04" on a 24-hour one — instead of a hard-coded 24-hour HH:MM
     next to locale 12-hour labels. Formatters are built once (they are costly)
     and the fallback is only for an engine without Intl. */
  var FMT = {};
  function intlFmt(key, opts) {
    if (FMT[key] === undefined) {
      try { FMT[key] = new Intl.DateTimeFormat(undefined, opts); } catch (e) { FMT[key] = null; }
    }
    return FMT[key];
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function hhmm(ts) {
    var d = (ts == null) ? new Date() : new Date(ts);
    var f = intlFmt("hm", { hour: "numeric", minute: "2-digit" });
    return f ? f.format(d) : pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  /** Same clock with seconds (audit trails). */
  function hhmmss(ts) {
    var d = (ts == null) ? new Date() : new Date(ts);
    var f = intlFmt("hms", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    return f ? f.format(d) : pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }
  /** "Today" / "Yesterday" / a locale short date ("Oct 6", "6 Oct"; + year when not this year). */
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayLabel(ts) {
    var d = (ts == null) ? new Date() : new Date(ts);
    var today = new Date();
    var yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1); // calendar day, DST-safe
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, yesterday)) return "Yesterday";
    var sameYear = d.getFullYear() === today.getFullYear();
    var f = sameYear ? intlFmt("md", { month: "short", day: "numeric" }) : intlFmt("ymd", { year: "numeric", month: "short", day: "numeric" });
    return f ? f.format(d) : d.toDateString();
  }
  /** Day + clock ("Today · 3:04 PM", "Oct 6 · 3:04 PM"). */
  function stamp(ts) { return dayLabel(ts) + " · " + hhmm(ts); }
  function clockLabel() { return hhmm(); }

  /* ---- shift-time helpers ------------------------------------------------
     On-call follows the schedule by current time: a provider's shift is
     "active now" when the clock falls inside that shift's window. Night wraps
     past midnight. atHour is injectable for deterministic tests. */
  var SHIFT_WINDOWS = {
    day:   [7, 19],
    swing: [13, 23],
    night: [19, 7],
    nocturnist: [19, 7],
    rounding: [7, 19],
  };
  function shiftActiveNow(shiftType, atHour) {
    var w = SHIFT_WINDOWS[shiftType] || SHIFT_WINDOWS.day;
    var h = (atHour == null) ? new Date().getHours() : atHour;
    var start = w[0], end = w[1];
    return (start < end) ? (h >= start && h < end) : (h >= start || h < end);
  }
  // Schedule-driven on-call by specialty: for each specialty pick the best
  // candidate — on-shift-now AND working (the true on-call) > working > on-shift
  // > anyone registered. onCall is true only when someone of that specialty is
  // both working and on shift at this hour, so it auto-rotates with the clock.
  function onCallRoster(directory, atHour) {
    var roster = {};
    (directory || []).forEach(function (d) {
      if (!d.specialty) return;
      var a = shiftActiveNow(d.shift, atHour);
      var r = (a && d.working) ? 3 : d.working ? 2 : a ? 1 : 0;
      var cur = roster[d.specialty];
      if (!cur || r > cur._rank) {
        roster[d.specialty] = { name: d.name, avatar: d.avatar, onCall: !!(d.working && a), shift: d.shift || "", _rank: r };
      }
    });
    return roster;
  }
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
  // Suggest an ESI triage level (1 = resuscitation … 5 = non-urgent) from the
  // free-text note via keyword rules. This is a deterministic suggestion the ER
  // physician confirms — NOT a predictive model. Defaults to 3 (urgent).
  function suggestAcuity(text) {
    var t = " " + String(text || "").toLowerCase() + " ";
    var has = function (re) { return re.test(t); };
    if (has(/\b(gsw|gunshot|stab|cardiac arrest|\bcode\b|cpr|unresponsive|no pulse|pulseless|apneic|anaphylaxis|stemi|major trauma|septic shock|respiratory failure|active seizure|status epilepticus|intubat)/)) return 1;
    if (has(/\b(chest pain|stroke|\bcva\b|facial droop|sob\b|shortness of breath|hypox|altered mental|\bams\b|\bdka\b|overdose|\bod\b|sepsis|syncope|suicidal|severe|hemorrhage|\bgi bleed\b|melena|\brvr\b|\bpe\b)/)) return 2;
    if (has(/\b(abdominal pain|abd pain|fever|fracture|\bfx\b|pneumonia|dehydration|vomiting|moderate|copd|cellulitis|pancreatitis|\baki\b)/)) return 3;
    if (has(/\b(laceration|sprain|\buti\b|minor|rash|earache|sore throat)/)) return 4;
    if (has(/\b(med refill|medication refill|suture removal|prescription|recheck|follow.?up|cold\b)/)) return 5;
    return 3;
  }

  function extractIntake(note) {
    var text = (note || "").trim();
    if (!text) return { initials: "", room: "", complaint: "", specialty: "", consults: [], acuity: 3, empty: true };
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
    // Capture the room token after a keyword, then absorb only a genuine
    // continuation — a number ("disc 44", "hall 5"), a slashed pair ("A/B"), or
    // a lone unit letter ("Bay A"). Plain words ("here", "for", "with") are NOT
    // continuations, so an un-delimited "hall5 here for GSW" stops at "hall5".
    // Don't let a leading "<INITIALS> <age><sex>" (e.g. "RM 72F") be misread as a
    // room — strip it before the "rm"/"room" keyword scan (initials are still
    // pulled from the original text above).
    var roomText = text.replace(/^\s*[A-Z]{1,3}\.?,?\s*\d{1,3}\s*[MFmf]\b/, "");
    // The token after the keyword must look like a room id — digit-bearing
    // ("5", "412A", "hall5"), a slashed pair ("A/B"), or a lone unit letter
    // ("Bay A") — so "no bed yet" doesn't capture "yet".
    var rm = roomText.match(/\b(?:room|rm\.?|bed|bay|loc(?:ation)?)\s*#?\s*([0-9]+[A-Za-z]?(?:\/[A-Za-z0-9]+)?|[A-Za-z]+\d[A-Za-z0-9]*|[A-Za-z]\/[A-Za-z]|[A-Za-z](?![A-Za-z]))/i);
    if (rm) room = rm[1].trim();
    // Bare ward / unit designations (no "room" keyword): "HALL", "hall5",
    // "DISC 44", "ICU 4", "CCU-12", "TELE 5", "Stepdown 9", "OBS 2"… Two tiers:
    // distinctive unit names may stand alone, while short ambiguous codes
    // (ED/ER/OR/MED/SURG…) only count as a room when a bed number follows — so
    // prose like "chest pain or SOB" or "seen in the ED" isn't misread.
    function fmtUnit(p, n) { return (String(p).toUpperCase() + (n ? " " + String(n).toUpperCase() : "")).replace(/\s+/g, " ").trim(); }
    if (!room) {
      // longer alternatives first so "discharge"/"observation" win over "disc"/"obs".
      var SAFE_UNIT = "cvicu|micu|sicu|nicu|picu|icu|ccu|pcu|tcu|sdu|telemetry|tele|pacu|observation|obs|ldr|stepdown|step|hallway|hall|discharge|disch|disc|triage|rehab|disaster|lobby|waiting\\s?room";
      // not "disc" of disc herniation/disease, etc.
      var u1 = roomText.match(new RegExp("\\b(" + SAFE_UNIT + ")\\b(?!\\s*(?:herniat|disease|bulg|space|protrus|degener))(?:\\s*[#-]?\\s*([0-9]+[A-Za-z]?|[A-Za-z](?![A-Za-z])))?", "i"));
      if (u1) room = fmtUnit(u1[1], u1[2]);
    }
    if (!room) {
      var AMB_UNIT = "ed|er|ew|or|ft|fast\\s?track|med|surg|wr|ante|post";
      var u2 = roomText.match(new RegExp("\\b(" + AMB_UNIT + ")\\s*[#-]?\\s*([0-9]+[A-Za-z]?)\\b", "i"));
      if (u2) room = fmtUnit(u2[1], u2[2]);
    }
    // Directional ward-prefixed rooms ("3West 12", "4E-22", "3W12").
    if (!room) { var wp = roomText.match(/\b(\d{1,2}\s?(?:east|west|north|south)\s?\d{1,3}[A-Za-z]?|\d\s?[ewns][-\s]?\d{1,3}[A-Za-z]?)\b/i); if (wp) room = fmtUnit(wp[1].replace(/\s+/g, ""), ""); }
    if (!room) room = (text.match(/\b([0-9]{3}[A-Za-z]?)\b/) || [])[1] || "";
    var complaint = text.split(/[.\n;]/)[0].trim().replace(/^\s*(patient|pt\.?)\s+[A-Z][A-Za-z.\s]*?\s*(with|w\/|presenting with|presents with)\s*/i, "");
    complaint = complaint.charAt(0).toUpperCase() + complaint.slice(1);
    if (complaint.length > 90) complaint = complaint.slice(0, 88) + "…";
    var specialty = "Hospital Medicine", consults = [];
    for (var i = 0; i < SPECIALTY_KEYS.length; i++) { if (SPECIALTY_KEYS[i][0].test(text)) { specialty = SPECIALTY_KEYS[i][1]; consults = [specialty]; break; } }
    return { initials: initials || "", room: room, complaint: complaint || text.slice(0, 80), specialty: specialty, consults: consults, acuity: suggestAcuity(text), empty: false };
  }

  /* ---- incoming-admit generator (for live "real" feel) ------------------- */
  var ADMIT_POOL = [
    { initials: "GV", room: "221", complaint: "Septic shock, on pressors", specialty: "Infectious Disease", from: "Dr. Reyes (ER)" },
    { initials: "HP", room: "117", complaint: "PE, hypoxic on room air", specialty: "Pulmonology", from: "Dr. Osei (ER)" },
    { initials: "WN", room: "309", complaint: "AKI on CKD, hyperkalemia", specialty: "Nephrology", from: "Dr. Okafor (ER)" },
    { initials: "EB", room: "402", complaint: "Afib with RVR", specialty: "Cardiology", from: "Dr. Reyes (ER)" },
    { initials: "TS", room: "210", complaint: "Acute pancreatitis", specialty: "GI", from: "Dr. Osei (ER)" },
  ];

  // The consult-service catalog is the ORGANIZATION's (server: org setting
  // "consultServices", Directory → Consult services). There is no client-side
  // default list: an org that has not curated one has none, and the ER intake
  // shows its own generic specialty picker.

  /* ---- seed (initial) state --------------------------------------------- */
  function seed() {
    var t0 = now();
    return {
      // v11: persistence became a non-PHI allowlist — any v10 blob (a full
      // state dump, clinical slices included) is discarded rather than loaded.
      v: 11,
      // Test-only by default until an operator deliberately turns it off for a
      // compliant real-PHI deployment (server: SYNTHETIC_DATA=false).
      syntheticData: true,
      // Personal availability: do-not-disturb + designated covering provider
      // (server-backed; DND without covering makes on-call roles unreachable).
      myPrefs: { dnd: false, coveringUserId: null },
      theme: { appName: "DocTurn", accent: "#2563EB", radius: 8, sidebar: "expanded", contentWidth: "standard" },
      navHidden: {},
      navOrder: {},
      // Per-role patient-board module visibility overrides (merged over the
      // role defaults in boardModulesFor). Lets a director/ER director switch
      // board sections on/off — the FHIR-dependent ones stay off until the EHR
      // census is wired up.
      boardModules: {},
      // Per-role dashboard layout: { order: [widgetId…], hidden: [widgetId…] }.
      // Drives the customizable ER / ER-director dashboards (drag to reorder,
      // remove, re-add). Empty = default order, nothing hidden.
      dashLayout: {},
      // Per-key stat-tile layout: { order: [statId…], hidden: [statId…] }, keyed
      // by an arbitrary string (e.g. "hospitalist:stats"). Same mechanism as
      // dashLayout but for individual KPI tiles — show/hide, drag-reorder, reset.
      statLayout: {},
      // Per-key user-created stat tiles: { [key]: [{ id, label, source,
      // metricKey, manualValue, icon, tint }] }. Users build their own KPI
      // boxes in the CustomizableStats edit mode — either mirroring a live
      // metric from the dashboard's catalog (source:"metric") or showing a
      // typed value (source:"manual"). Auto-persists like every other state key.
      customStats: {},
      // Server-computed comms KPIs ({ messages7d, statAckAvgSec,
      // consultResponseAvgSec }). Null until loadCommsMetrics() fills it (the
      // live override in api-bridge.js fetches the real numbers).
      commsMetrics: null,
      // Per-organization on-call schedule source. Every tenant keeps its
      // schedule somewhere different — a scheduling vendor (Amion/QGenda), an
      // uploaded Word/PDF, or a web page — so the source is modular and keyed by
      // org code (this survives the developer org re-hydrate). Only the Amion
      // org (Cedars) ships a captured demo grid; nobody else defaults to Amion.
      scheduleSources: { CEDARS: "amion", ISPN: "amion", MAYO: "qgenda", STJUDE: "word", CLEVE: "online", PINE: "none" },
      // Director-editable consult-service menu that powers the ER intake.
      consultServices: [],
      consultServicesVersion: null, // the server's catalog revision; null until loaded
      consultHidden: [], // specialty names hidden from the ER route-assignment picker
      session: null, // { role, org, user, name }
      impersonating: null, // { name, role, org } when a developer is viewing a user's portal
      ui: { nav: "dashboard", notifOpen: false, realtime: true, onShift: true },
      me: { name: "Dr. Jordan Chen", avatar: "JC", role: "MD" },
      rotation: null, // server "Next up" (GET /api/rotation/next); see nextUp()

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
        { id: "a1", initials: "RM", room: "318", complaint: "Acute abdominal pain, 2-day onset", from: "Dr. Reyes (ER)", specialty: "General Medicine", acuity: 3, via: "Round-robin", expiresAt: t0 + 272000, acceptedToday: false },
        { id: "a2", initials: "TK", room: "205", complaint: "Diabetic ketoacidosis", from: "Dr. Osei (ER)", specialty: "Endocrinology", acuity: 2, via: "Manual", expiresAt: t0 + 430000, acceptedToday: false },
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

      // Developer console. Live: empty until GET /api/dev/organizations answers
      // (orgsLoaded true, or "error"); `assignments` is the server's count of
      // assignments created in the last 24 h. There is no tenant
      // active/suspended state — the server has none (A.CON developer #19).
      orgs: isLive() ? [] : [
        { code: "MAYO",   name: "Mayo General Hospital",   timezone: "America/New_York",    users: 142, assignments: 88 },
        { code: "STJUDE", name: "St. Jude Medical Center", timezone: "America/Chicago",     users: 96,  assignments: 54 },
        { code: "CLEVE",  name: "Cleveland Care Network",  timezone: "America/New_York",    users: 211, assignments: 132 },
        { code: "ISPN",  name: "Cedars-Sinai (ISP North)",              timezone: "America/Los_Angeles", users: 67,  assignments: 29 },
        { code: "PINE",   name: "Pinecrest Regional",      timezone: "America/Denver",      users: 38,  assignments: 12 },
      ],
      orgsLoaded: !isLive(),
      // The platform (operator) org from the same list: where developer
      // accounts are created. Null until loaded.
      platformOrg: null,
      selectedOrg: isLive() ? null : "MAYO",
      // Registered org people (hydrated from /api/physicians/directory for all
      // roles). Drives the ER Consult-services roster + midlevel pool so newly
      // registered consultants/PAs/NPs appear automatically. Empty = use the
      // component's demo fallback offline.
      directory: [],
      // Soft, muted role palette — distinct hues that stay legible as text on a
      // light tint and as small dots (easier to read than saturated primaries).
      roleColors: {
        hospitalist: "#4666C4",
        er_doctor:   "#C07A33",
        er_director: "#C25A6B",
        director:    "#7A60C0",
        developer:   "#3E9B6E",
        consultant:  "#2C8C92",
      },
      // Every developer account is platform-wide (cross-tenant root): there is
      // no single-organization developer (A.CON developer #1). Live: empty
      // until GET /api/dev/users answers (devUsersLoaded).
      devUsers: isLive() ? [] : [
        { id: uid("u"), name: "Dr. Lena Ortiz", role: "hospitalist", org: "MAYO", specialty: "Nephrology" },
        { id: uid("u"), name: "Priya Shah, NP", role: "hospitalist", org: "CLEVE", specialty: "Pulmonology" },
        { id: uid("u"), name: "Karen Vance", role: "director", org: "MAYO", specialty: "" },
        { id: uid("u"), name: "Dr. Ruth Osei", role: "er_doctor", org: "STJUDE", specialty: "" },
        { id: uid("u"), name: "Dr. Paul Okafor", role: "er_director", org: "CLEVE", specialty: "" },
        { id: uid("u"), name: "Alex Kim", role: "developer", org: "DOCTURN", specialty: "" },
      ],
      devUsersLoaded: !isLive(),
      diagnostics: null,
      // GET /api/dev/platform-health (this server instance, measured). Null
      // until loaded; { error } when the server didn't answer.
      platformHealth: null,

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

      // Integrations (Twilio / push / OpenAI / Amion / Epic) and their per-org
      // switches are NOT client state: Settings → Integrations reads and writes
      // them on the server (/api/integrations). The old local `flags` /
      // `integrations` booleans claimed effects nothing enforced and are gone.
      // Shift types are the org's routable set on the server
      // (organizations.round_robin_shift_types → orgIdentity.roundRobinShiftTypes),
      // not a local list.
      settings: { timeout: 15, autoReassign: true },

      // The signed-in org as the server reports it (GET /api/org/config): name,
      // code, time zone, routable shift types. Null until loaded.
      orgIdentity: null,
      // People an administrator manages (GET /api/accounts) for the session's
      // org — null until loaded, never demo rows. Roles are DocTurn's fixed
      // roles (server/rbac.ts); there is no custom-role list.
      accounts: null,
      accountsOrg: null,
      accountsError: null,

      // Developer console: each tenant's REAL rule values, keyed by org code,
      // loaded from GET /api/dev/organizations/:id/settings. There are no
      // platform-wide "enterprise defaults" — the server has no inheritance.
      orgConfigs: {},

      // The offline kit's demo notification feed. The server has no
      // notification feed, so a live deployment has none (and the shell shows
      // no bell) — A.CON developer #23.
      notifications: isLive() ? [] : [
        { id: uid("n"), icon: "route", title: "New assignment routed", body: "Patient RM → you · round-robin", at: t0 - 90000, read: false },
        { id: uid("n"), icon: "message-square", title: "Dr. Sarah Chen", body: "Accepting the 412 hand-off now.", at: t0 - 120000, read: false },
        { id: uid("n"), icon: "megaphone", title: "Code stroke — Bed 4 ICU", body: "Critical broadcast · ack required", at: t0 - 480000, read: true },
      ],

      // Compliance logs start EMPTY — they fill from real activity (logins,
      // assignments, PHI access) rather than seeded demo rows.
      audit: [],
      // The trail's TRUE size from the server (GET /api/audit auditCount) —
      // the `audit` array is only its latest page. Null until loaded.
      auditCount: null,
      phiLog: [],
      incidents: [],

      lastAdmitAt: t0,
    };
  }

  /* ---- persistence ------------------------------------------------------- */
  /* PHI NEVER TOUCHES localStorage.
     The store used to serialize the ENTIRE state object, which meant server
     PHI — conversation message bodies, the patient board, the hospitalist
     census, admissions, pending assignments, the ER sent board — sat readable
     in a shared workstation's browser storage, and survived logout.

     Persistence is now an explicit ALLOWLIST of non-clinical UI/session
     preferences. Everything not listed here stays in memory only and is
     re-fetched from the server after sign-in (api-bridge restores the session
     from the server cookie on load and re-hydrates every clinical slice).

     Deliberately NOT persisted (PHI or PHI-adjacent):
       conversations (message bodies) · board · myPatients · myAdmissions ·
       pending · sent · admissions · broadcasts (clinical broadcast text) ·
       notifications (bodies quote patient initials + rooms) ·
       audit / phiLog / incidents (compliance trail — server is authoritative)
     Also not persisted (server-owned rosters, cheap to refetch): providers,
     directory, orgPeople, candidates, team, devUsers, orgs, registrations.
     Nor personal settings: `myPrefs` (DND, covering provider, away message)
     is re-read from the server on every sign-in / restore.
     `session` and `me` are kept only WHILE signed in (a reload shows the lock
     screen / restores with the right name): sign-out resets both to their
     signed-out values before the snapshot is purged, so nothing written after
     a sign-out carries the previous clinician's identity (A.CON-SHO-63). */
  var PERSIST_KEYS = [
    "v", "syntheticData", "session", "me", "impersonating",
    "theme", "roleColors", "navHidden", "navOrder", "boardModules",
    "dashLayout", "statLayout", "customStats",
    "scheduleSources", "consultHidden",
    "selectedOrg", "settings",
    "orgRetentionDays", "autoCleanHours", "ui",
  ];
  // Identity is written only while someone is signed in.
  var SIGNED_IN_ONLY = { me: 1, impersonating: 1 };
  function persistable(s) {
    var out = {};
    PERSIST_KEYS.forEach(function (k) {
      if (s[k] === undefined) return;
      if (SIGNED_IN_ONLY[k] && !s.session) return;
      out[k] = s[k];
    });
    return out;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || saved.v !== 11) return null;
      // Rebuild from a fresh seed and lay ONLY the allowlisted preferences over
      // it — a save written by an older build could still contain clinical
      // slices, and this drops them on the floor instead of rehydrating them.
      var s = seed();
      PERSIST_KEYS.forEach(function (k) { if (saved[k] !== undefined) s[k] = saved[k]; });
      // Drop the retired local-only integration booleans an older build saved
      // (they claimed "Connected" for things nothing enforced).
      if (s.settings) {
        s.settings = Object.assign({}, s.settings);
        delete s.settings.flags; delete s.settings.integrations;
        delete s.settings.onCallOnly; delete s.settings.activeOnly;
        // Retired local shift-type list (the org's routable shifts are the server's).
        delete s.settings.shiftTypes;
      }
      if (!s.myPrefs) s.myPrefs = { dnd: false, coveringUserId: null };
      // transient UI bits always reset sensibly
      s.ui = s.ui || { nav: "dashboard", notifOpen: false, realtime: true };
      s.ui.notifOpen = false;
      // Migrate role colors to the softer palette unless the user customized
      // them (only replace values still set to the old saturated defaults).
      var OLD_ROLE = { hospitalist: "#2563EB", er_doctor: "#D97706", er_director: "#DC2626", director: "#7C3AED", developer: "#0F766E", consultant: "#0891B2" };
      var NEW_ROLE = { hospitalist: "#4666C4", er_doctor: "#C07A33", er_director: "#C25A6B", director: "#7A60C0", developer: "#3E9B6E", consultant: "#2C8C92" };
      s.roleColors = s.roleColors || {};
      Object.keys(NEW_ROLE).forEach(function (k) {
        if (!s.roleColors[k] || s.roleColors[k] === OLD_ROLE[k]) s.roleColors[k] = NEW_ROLE[k];
      });
      return s;
    } catch (e) { return null; }
  }

  var state = load() || seed();
  var listeners = new Set();
  var clockListeners = new Set();

  // Debounced persistence: batch write-heavy flows (e.g. typing, the 1s clock)
  // into one localStorage write at most every 250ms; flush on unload so nothing
  // is lost on refresh. Only `persistable(state)` is ever written — see
  // PERSIST_KEYS above.
  var persistTimer = null;
  function persistNow() { try { localStorage.setItem(KEY, JSON.stringify(persistable(state))); } catch (e) {} }
  function persist() { if (persistTimer) return; persistTimer = setTimeout(function () { persistTimer = null; persistNow(); }, 250); }
  /** Drop the persisted snapshot entirely (logout / lock). */
  function purgePersisted() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  // Rewrite the key immediately on boot so a blob left by an older build (which
  // persisted everything, PHI included) is replaced before anything can read it.
  persistNow();
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
  // ---- round-robin "Next up" (A.CON-SHO-29) ------------------------------
  // In a live session the ONLY source is the server's routing planner
  // (GET /api/rotation/next, written to state.rotation by api-bridge.js): it
  // applies the routable shift set (org.roundRobinShiftTypes), census < cap,
  // simulated cap relief and the sequential cursor — exactly what the next
  // round-robin admission will do. The local rules below run only when no
  // server has ever answered (the offline demo); they apply the same
  // eligibility so even the demo never names an at-cap / off-shift provider.
  // state.rotation:
  //   null                                   no server answer (offline demo)
  //   { source: "server", nextId, order, capRelief, mode, shiftTypes }
  //   { source: "loading" }                  live session, preview not back yet
  //   { source: "unavailable" | "disabled" } live session, server gave no answer
  var DEFAULT_RR_SHIFTS = ["day", "night"];
  function localRotationQueue() {
    var shifts = DEFAULT_RR_SHIFTS;
    var pool = rotationList().filter(function (p) { return shifts.indexOf(p.shift) >= 0; });
    var elig = pool.filter(function (p) { return p.census < p.cap; });
    // Cap relief: nobody routable has capacity → every routable cap goes +1.
    if (!elig.length) elig = pool.filter(function (p) { return p.census < p.cap + 1; });
    var mode = (state.settings && state.settings.rotationMode) || "lowest_census";
    if (mode === "sequential") return elig.slice();
    return elig.slice().sort(function (a, b) { return a.census - b.census; });
  }
  function byKitId(id) { return state.providers.find(function (p) { return p.id === id; }) || null; }
  /** Eligible providers in pick order (next first). Empty when nobody can take the next patient. */
  function rotationQueue() {
    var r = state.rotation;
    if (!r) return localRotationQueue();
    if (r.source !== "server") return [];
    return (r.order || []).map(byKitId).filter(Boolean);
  }
  /** The provider the next round-robin admission goes to, or null (nobody / unknown). */
  function nextUp() {
    var r = state.rotation;
    if (!r) return localRotationQueue()[0] || null;
    if (r.source !== "server" || !r.nextId) return null;
    return byKitId(r.nextId);
  }
  /** What the UI may say about rotation: whose word it is, cap relief, mode. */
  function rotationStatus() {
    var r = state.rotation;
    if (!r) {
      var q = localRotationQueue();
      var anyFree = q.some(function (p) { return p.census < p.cap; });
      return { source: "local", capRelief: q.length > 0 && !anyFree, mode: (state.settings && state.settings.rotationMode) || "lowest_census" };
    }
    return { source: r.source, capRelief: !!r.capRelief, mode: r.mode || (state.settings && state.settings.rotationMode) || "lowest_census", shiftTypes: r.shiftTypes || null };
  }
  // Specialty-aware preview for the ER intake: the server applies the
  // patient's specialty preference exactly like the real pick. api-bridge.js
  // replaces this in a live session; offline it is the local queue's head.
  function previewRotation(specialty) {
    var nx = nextUp();
    return Promise.resolve({ source: state.rotation ? state.rotation.source : "local", next: nx, capRelief: rotationStatus().capRelief, specialty: specialty || "" });
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

  // Resolve a role's dashboard layout against the widgets it currently offers:
  // honor the saved order, append any newly-added widgets, and report hidden.
  function dashLayoutFor(role, allIds) {
    var saved = (state.dashLayout && state.dashLayout[role]) || {};
    var hidden = (saved.hidden || []).filter(function (id) { return allIds.indexOf(id) >= 0; });
    var order = (saved.order || []).filter(function (id) { return allIds.indexOf(id) >= 0; });
    allIds.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    return { order: order, hidden: hidden };
  }

  // Same resolution as dashLayoutFor, but for individual stat tiles keyed by an
  // arbitrary string (e.g. "hospitalist:stats"): honor the saved order, append
  // any newly-added tiles, and report which are hidden.
  function statLayoutFor(key, allIds) {
    var saved = (state.statLayout && state.statLayout[key]) || {};
    var hidden = (saved.hidden || []).filter(function (id) { return allIds.indexOf(id) >= 0; });
    var order = (saved.order || []).filter(function (id) { return allIds.indexOf(id) >= 0; });
    allIds.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    return { order: order, hidden: hidden };
  }

  // User-created custom stat tiles for a given key (empty array when none).
  function customStatsFor(key) {
    return (state.customStats && state.customStats[key]) || [];
  }

  /* ---- audit / notify helpers ------------------------------------------- */
  function pushAudit(s, entry) {
    // The audit trail is the SERVER's. A live session never fabricates rows
    // locally (they used to sit next to the real ones with a made-up IP and
    // vanish on reload — A.CON developer #12); only the offline kit keeps a
    // local demo trail.
    if (isLive()) return;
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

  // Clinical (or PHI-quoting) slices that must not outlive a session. Reset to
  // FRESH SEED values rather than empty arrays so the offline/demo fallback
  // still has something to render if the backend is unreachable at next login;
  // a real login overwrites them from the server.
  var PHI_SLICES = [
    "conversations", "board", "myPatients", "myAdmissions", "pending",
    "sent", "admissions", "broadcasts", "notifications",
    "audit", "phiLog", "incidents",
  ];
  // The signed-in person's identity and per-user settings — reset on sign-out
  // so nothing of the previous user survives in memory either.
  var PERSONAL_SLICES = ["me", "myPrefs", "dashLayout", "statLayout", "customStats", "commsMetrics", "opsReport", "peerAvail",
    // the previous person's org: its people, identity, catalog and rules
    "accounts", "accountsOrg", "accountsError", "orgIdentity", "consultServices", "consultServicesVersion", "orgConfigs",
    // the previous operator's cross-tenant view (developer console)
    "orgs", "orgsLoaded", "platformOrg", "devUsers", "devUsersLoaded", "platformHealth", "diagnostics", "auditCount"];
  function clearPhiSlices(s) {
    var fresh = seed();
    PHI_SLICES.forEach(function (k) { s[k] = fresh[k]; });
    s.__activeConvo = null;
    return s;
  }

  function kvPair(key, val) { var o = {}; o[key] = val; return o; }

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
          state.pending = [{ id: uid("a"), initials: tmpl.initials, room: tmpl.room, complaint: tmpl.complaint, specialty: tmpl.specialty, acuity: suggestAcuity(tmpl.complaint), from: tmpl.from, via: "Round-robin", expiresAt: t + state.settings.timeout * 60000 }].concat(state.pending);
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
        s.session = { role: role, org: org || "ISPN", user: user || "dr.chen", name: s.me.name };
        s.ui.nav = "dashboard"; s.ui.notifOpen = false;
        pushAudit(s, { action: "login", resource: "session", risk: "low" });
        return s;
      });
    },
    // Logout clears the in-memory clinical slices, the signed-out person's
    // identity and personal settings, AND the persisted snapshot, so a shared
    // workstation keeps nothing readable — or attributable — after the user
    // walks away (A.CON-SHO-63). The next sign-in re-reads all of it from the
    // server (and the next user never inherits — or saves over their own
    // server copy — the previous user's dashboard layout).
    logout: function () {
      set(function (s) {
        pushAudit(s, { action: "logout", resource: "session", risk: "low" });
        var fresh = seed();
        s.session = null; s.impersonating = null; s.ui.notifOpen = false;
        PERSONAL_SLICES.forEach(function (k) { s[k] = fresh[k]; });
        s.rotation = null; // the next sign-in asks its own org's server
        return clearPhiSlices(s);
      });
      // Last word: whatever the set above scheduled is cancelled and the key
      // removed. (Anything set() later writes only the non-identity allowlist.)
      purgePersisted();
    },
    /** Screen lock: same PHI hygiene as logout, but keeps the session. */
    lock: function () { purgePersisted(); },
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
    // routeMode: "quick" (round-robin) | "manual" — the ER intake tab, never
    // inferred from who the provider happens to be (A.CON-SHO-29).
    sendAssignment: function (provider, fields, consults, routeMode) {
      var manualPick = routeMode === "manual" || (routeMode !== "quick" && !!provider);
      if (!manualPick) provider = nextUp();
      if (!provider) {
        set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't send assignment", msg: "No eligible hospitalist is on shift to receive this." }; return s; });
        return;
      }
      set(function (s) {
        var acuity = fields.acuity || 3;
        var entry = { id: uid("s"), initials: fields.initials, provider: provider.name, complaint: fields.complaint, consultants: consults || [], acuity: acuity, time: "Today · " + clockLabel(), day: "Today", status: "sent" };
        s.sent = [entry].concat(s.sent);
        // create a board row (routing) + a pending request for the receiving hospitalist view
        s.board = [{ id: uid("b"), initials: fields.initials, room: fields.room || "—", dept: "MED", issue: fields.complaint || "—", acuity: acuity, status: "pending", attending: { name: "", avatar: "" }, unit: [], consultants: consults || [], er: { name: s.me.name, avatar: "Er" } }].concat(s.board);
        var via = manualPick ? "Manual" : "Round-robin";
        s.pending = s.pending.concat([{ id: uid("a"), initials: fields.initials, room: fields.room || "—", complaint: fields.complaint || "—", from: "You (ER)", specialty: fields.specialty || "General Medicine", acuity: acuity, via: via, expiresAt: now() + s.settings.timeout * 60000 }]);
        // append to the admissions log (every admission given to a team)
        s.admissions = [{ id: uid("ad"), at: now(), initials: fields.initials, room: fields.room || "—", provider: provider.name, specialty: fields.specialty || "General Medicine", acuity: acuity, via: via, status: "sent" }].concat(s.admissions || []);
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
    },
    // Typing indicators are REAL (relayed peer-to-peer over the live WebSocket by
    // the api bridge). This local fallback is a no-op so demo mode never fakes one.
    setTyping: function () {},
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

    // On-call / role addressing (backend-backed via api-bridge). Local fallback:
    // no resolvable roster, so return an empty set and start a plainly-named
    // local thread if asked.
    listOnCallTargets: function () { set(function (s) { s.onCallTargets = []; return s; }); return Promise.resolve([]); },
    startRoleConversation: function (target) {
      if (!target) return;
      set(function (s) {
        var existing = s.conversations.find(function (c) { return c.name === target.label; });
        if (existing) { s.__activeConvo = existing.id; s.conversations = s.conversations.map(function (c) { return c.id === existing.id ? Object.assign({}, c, { unread: 0 }) : c; }); return s; }
        var id = uid("cv");
        s.conversations = [{ id: id, name: target.label, role: "On-call role", initials: initialsOf(target.label), presence: "online", tint: "blue", unread: 0, typing: false, messages: [] }].concat(s.conversations);
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
        s.orgs = s.orgs.concat([{ code: code, name: data.name, timezone: data.timezone || "America/New_York", users: 1, assignments: 0 }]);
        pushAudit(s, { action: "create_organization", resource: code, risk: "high" });
        s.__toast = { tone: "accepted", title: "Tenant created", msg: data.name + " (" + code + ") provisioned." };
        return s;
      });
    },
    addUser: function (form) {
      set(function (s) {
        if (!form.name.trim()) { s.__toast = { tone: "rejected", title: "Name required", msg: "Enter the user's full name." }; return s; }
        // Offline kit only (the bridge posts to the server). A developer is
        // platform-wide, never scoped to one organization.
        var isDev = form.role === "developer";
        var org = isDev ? "DOCTURN" : form.org;
        s.devUsers = [{ id: uid("u"), name: form.name, username: form.username || "", role: form.role, org: org, specialty: form.role === "hospitalist" ? form.specialty : "" }].concat(s.devUsers);
        if (!isDev) s.orgs = s.orgs.map(function (o) { return o.code === form.org ? Object.assign({}, o, { users: o.users + 1 }) : o; });
        pushAudit(s, { action: "create_user", resource: form.name + " @ " + org, risk: isDev ? "high" : "medium" });
        var label = ({ hospitalist: "Hospitalist", er_doctor: "ER physician", er_director: "ER director", director: "Director", developer: "Developer" })[form.role];
        s.__toast = { tone: "accepted", title: label + " created", msg: form.name + " added to " + (isDev ? "the platform" : form.org) + "." };
        return s;
      });
      return Promise.resolve(true);
    },
    removeUser: function (id) {
      set(function (s) {
        var u = s.devUsers.find(function (x) { return x.id === id; });
        s.devUsers = s.devUsers.filter(function (x) { return x.id !== id; });
        if (u) s.orgs = s.orgs.map(function (o) { return o.code === u.org ? Object.assign({}, o, { users: Math.max(0, o.users - 1) }) : o; });
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
          s.devUsers = [{ id: uid("u"), name: p.name, role: "hospitalist", org: orgCode, specialty: p.group || "" }].concat(s.devUsers || []);
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
    // A per-BROWSER preference (persisted in this browser's localStorage only,
    // PERSIST_KEYS): other devices and other people keep the default colors.
    // Not a server action, so not an audit row (A.CON developer #20).
    setRoleColor: function (role, color) { set(function (s) { s.roleColors = Object.assign({}, s.roleColors, (function () { var o = {}; o[role] = color; return o; })()); return s; }); },
    // Offline kit: there is no server to check, so nothing is claimed. The
    // bridge runs the real check (GET /api/dev/ai-diagnostics).
    runDiagnostics: function () {
      set(function (s) {
        s.diagnostics = { text: "Not connected to a DocTurn server — nothing was checked.", at: now() };
        return s;
      });
    },

    /* dashboard layout — per role: reorder, remove, re-add panels */
    setDashOrder: function (role, order) {
      set(function (s) {
        var cur = Object.assign({}, (s.dashLayout && s.dashLayout[role]) || {});
        cur.order = order.slice();
        s.dashLayout = Object.assign({}, s.dashLayout, (function () { var o = {}; o[role] = cur; return o; })());
        return s;
      });
    },
    toggleDashWidget: function (role, id) {
      set(function (s) {
        var cur = Object.assign({}, (s.dashLayout && s.dashLayout[role]) || {});
        var hidden = (cur.hidden || []).slice();
        var i = hidden.indexOf(id);
        if (i >= 0) hidden.splice(i, 1); else hidden.push(id);
        cur.hidden = hidden;
        s.dashLayout = Object.assign({}, s.dashLayout, (function () { var o = {}; o[role] = cur; return o; })());
        return s;
      });
    },
    resetDashLayout: function (role) {
      set(function (s) {
        var n = Object.assign({}, s.dashLayout); delete n[role];
        s.dashLayout = n;
        return s;
      });
    },

    /* stat-tile layout — per key: reorder, remove, re-add individual KPI tiles */
    setStatOrder: function (key, order) {
      set(function (s) {
        var cur = Object.assign({}, (s.statLayout && s.statLayout[key]) || {});
        cur.order = order.slice();
        s.statLayout = Object.assign({}, s.statLayout, (function () { var o = {}; o[key] = cur; return o; })());
        return s;
      });
    },
    toggleStat: function (key, id) {
      set(function (s) {
        var cur = Object.assign({}, (s.statLayout && s.statLayout[key]) || {});
        var hidden = (cur.hidden || []).slice();
        var i = hidden.indexOf(id);
        if (i >= 0) hidden.splice(i, 1); else hidden.push(id);
        cur.hidden = hidden;
        s.statLayout = Object.assign({}, s.statLayout, (function () { var o = {}; o[key] = cur; return o; })());
        return s;
      });
    },
    resetStatLayout: function (key) {
      set(function (s) {
        var n = Object.assign({}, s.statLayout); delete n[key];
        s.statLayout = n;
        return s;
      });
    },

    /* user-created custom stat tiles — per key: build / delete a bespoke KPI box.
       def = { label, source, metricKey, manualValue, icon, tint }. Ids are stable
       ("custom:"…) so they flow through statLayout order/hidden like any tile. */
    addCustomStat: function (key, def) {
      set(function (s) {
        var entry = Object.assign({ id: "custom:" + uid("cs") }, def);
        var list = ((s.customStats && s.customStats[key]) || []).concat([entry]);
        s.customStats = Object.assign({}, s.customStats, (function () { var o = {}; o[key] = list; return o; })());
        return s;
      });
    },
    removeCustomStat: function (key, id) {
      set(function (s) {
        var list = ((s.customStats && s.customStats[key]) || []).filter(function (e) { return e.id !== id; });
        s.customStats = Object.assign({}, s.customStats, (function () { var o = {}; o[key] = list; return o; })());
        // Scrub the deleted id from any saved layout so no dangling refs remain.
        var cur = Object.assign({}, (s.statLayout && s.statLayout[key]) || {});
        if (cur.order) cur.order = cur.order.filter(function (x) { return x !== id; });
        if (cur.hidden) cur.hidden = cur.hidden.filter(function (x) { return x !== id; });
        s.statLayout = Object.assign({}, s.statLayout, (function () { var o = {}; o[key] = cur; return o; })());
        return s;
      });
    },

    /* comms KPIs — no-op in the pure-demo store; api-bridge.js overrides this to
       fetch real numbers from /api/metrics/comms. Defined so callers never throw. */
    loadCommsMetrics: function () {},

    /* patient-board modules — per role, toggle a section on/off */
    setBoardModule: function (role, key, on) {
      set(function (s) {
        var cur = Object.assign({}, (s.boardModules && s.boardModules[role]) || {});
        cur[key] = on;
        s.boardModules = Object.assign({}, s.boardModules, (function () { var o = {}; o[role] = cur; return o; })());
        return s;
      });
    },

    /* The schedule-source PICKER's position for an org (a view preference).
       What the on-call board really reads is the server's choice
       (PATCH /api/oncall/source, which toasts and audits); this never claims
       a sync or writes an audit row of its own. */
    setScheduleSource: function (code, source) {
      set(function (s) {
        s.scheduleSources = Object.assign({}, s.scheduleSources, (function () { var o = {}; o[code] = source; return o; })());
        return s;
      });
    },

    /* consult services — director-editable menu behind the ER intake */
    addConsultService: function (name) {
      set(function (s) {
        var nm = String(name || "").trim();
        if (!nm) return s;
        var list = (s.consultServices || []).slice();
        if (list.some(function (x) { return x.name.toLowerCase() === nm.toLowerCase(); })) { s.__toast = { tone: "rejected", title: "Already exists", msg: nm + " is already a consult service." }; return s; }
        list.push({ id: uid("cs"), name: nm, onCall: null, members: [] });
        s.consultServices = list;
        s.__toast = { tone: "accepted", title: "Consult service added", msg: nm + " is now available in ER intake." };
        return s;
      });
    },
    renameConsultService: function (id, name) {
      set(function (s) {
        var nm = String(name || "").trim(); if (!nm) return s;
        s.consultServices = (s.consultServices || []).map(function (x) { return x.id === id ? Object.assign({}, x, { name: nm }) : x; });
        return s;
      });
    },
    setConsultOnCall: function (id, onCall) {
      set(function (s) {
        s.consultServices = (s.consultServices || []).map(function (x) { return x.id === id ? Object.assign({}, x, { onCall: onCall || null }) : x; });
        return s;
      });
    },
    addConsultMember: function (serviceId, member) {
      set(function (s) {
        if (!member || !member.name) return s;
        s.consultServices = (s.consultServices || []).map(function (x) {
          if (x.id !== serviceId) return x;
          var members = (x.members || []).slice();
          if (members.some(function (m) { return m.name === member.name; })) return x;
          members.push({ id: member.id || uid("cm"), name: member.name, avatar: member.avatar || "", role: member.role || "NP" });
          return Object.assign({}, x, { members: members });
        });
        return s;
      });
    },
    removeConsultMember: function (serviceId, memberId) {
      set(function (s) {
        s.consultServices = (s.consultServices || []).map(function (x) {
          return x.id === serviceId ? Object.assign({}, x, { members: (x.members || []).filter(function (m) { return m.id !== memberId; }) }) : x;
        });
        return s;
      });
    },
    removeConsultService: function (id) {
      set(function (s) {
        // Delete is reserved for the Hospitalist Director and developer.
        var role = (s.session || {}).role;
        if (role !== "director" && role !== "developer") {
          s.__toast = { tone: "rejected", title: "Not allowed", msg: "Only the Hospitalist Director or developer can remove a consult service." };
          return s;
        }
        s.consultServices = (s.consultServices || []).filter(function (x) { return x.id !== id; });
        s.__toast = { tone: "rejected", title: "Consult service removed", msg: "It's no longer offered in ER intake." };
        return s;
      });
    },

    /* org settings */
    setSetting: function (key, val) { set(function (s) { s.settings = Object.assign({}, s.settings, (function () { var o = {}; o[key] = val; return o; })()); return s; }); },

    /* developer console: a tenant's rule values (local copy of the server's;
       api-bridge.js writes them to /api/dev/organizations/:id and rolls back
       on a refusal) */
    setOrgRule: function (code, key, val) {
      set(function (s) {
        var cfgs = Object.assign({}, s.orgConfigs);
        var c = Object.assign({}, cfgs[code]);
        c.rules = Object.assign({}, c.rules, kvPair(key, val));
        cfgs[code] = c; s.orgConfigs = cfgs;
        return s;
      });
    },
    resolveIncident: function (id) { set(function (s) { s.incidents = s.incidents.map(function (i) { return i.id === id ? Object.assign({}, i, { status: "resolved" }) : i; }); pushAudit(s, { action: "resolve_incident", resource: id, risk: "low" }); return s; }); },

    /* continuous compliance monitor — real implementations live in
       api-bridge.js (they hit /api/compliance/*). The prototype has no way to
       measure the running system, so the defaults return nothing rather than a
       fabricated all-green report. */
    loadComplianceStatus: function () { return Promise.resolve(null); },
    saveAttestation: function () { return Promise.resolve(null); },
    exportEvidence: function () { return Promise.resolve(null); },
    /* policy starter pack — same story: the drafts are rendered server-side
       against the real organization, so the prototype has none. */
    loadPolicyTemplates: function () { return Promise.resolve([]); },
    loadPolicy: function () { return Promise.resolve(null); },
    // Show/hide a specialty in the ER route-assignment consult picker (does NOT
    // delete the director-managed consult service + roster).
    toggleConsultHidden: function (name) {
      set(function (s) {
        var nm = String(name || "").trim(); if (!nm) return s;
        var h = (s.consultHidden || []).slice();
        var i = h.indexOf(nm);
        if (i >= 0) h.splice(i, 1); else h.push(nm);
        s.consultHidden = h;
        return s;
      });
    },

    /* toast lifecycle */
    toast: function (t) { set(function (s) { s.__toast = t; return s; }); },
    clearToast: function () { set(function (s) { s.__toast = null; return s; }); },

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
        s.theme = { appName: "DocTurn", accent: "#2563EB", radius: 8, sidebar: "expanded", contentWidth: "standard", palette: "classic" };
        s.navHidden = Object.assign({}, s.navHidden, (function () { var o = {}; o[role] = []; return o; })());
        s.navOrder = Object.assign({}, s.navOrder, (function () { var o = {}; o[role] = null; return o; })());
        s.__toast = { tone: "accepted", title: "Layout reset", msg: "Appearance and navigation restored to defaults." };
        return s;
      });
    },

    /* danger zone */
    resetAll: function () { state = seed(); persist(); emit(); },
  };

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
  window.DT = { getState: getState, subscribe: subscribe, actions: actions, set: set, seed: seed, purgePersisted: purgePersisted, sortedProviders: sortedProviders, rotationList: rotationList, nextUp: nextUp, rotationQueue: rotationQueue, rotationStatus: rotationStatus, previewRotation: previewRotation, unreadMessages: unreadMessages, unreadNotifs: unreadNotifs, extractIntake: extractIntake, boardModules: boardModulesFor, dashLayout: dashLayoutFor, statLayout: statLayoutFor, customStats: customStatsFor };
  window.useStore = useStore;
  window.useActions = function () { return actions; };
  window.useClock = useClock;
  window.dtFmt = { mmss: mmss, ago: ago, hhmm: hhmm, hhmmss: hhmmss, dayLabel: dayLabel, stamp: stamp, clockLabel: clockLabel, initialsOf: initialsOf };
  window.extractIntake = extractIntake;
  window.shiftActiveNow = shiftActiveNow;
  window.SHIFT_WINDOWS = SHIFT_WINDOWS;
  window.onCallRoster = onCallRoster;
})();
