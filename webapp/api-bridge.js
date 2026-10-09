/* ============================================================================
   DocTurn — live API bridge.

   Loads AFTER store.js. Replaces the prototype's in-browser mock actions with
   calls to the real backend (/api), and hydrates live data into the EXACT same
   state shapes the screens read — so the UI stays byte-identical while the data
   and actions become real and multi-tenant.

   Defensive by design: every call is wrapped; if the backend is unreachable or
   a mapping fails, we fall back to the prototype's demo behavior so a screen
   never fully breaks.
   ============================================================================ */
(function () {
  "use strict";
  if (!window.DT || !window.DT.set) return; // store.js must have loaded
  window.DT_LIVE = true; // disables the demo admit/auto-reroute generators

  var DT = window.DT;
  var fmt = window.dtFmt;
  var origLogin = DT.actions.login;
  // True only once GET /api/config has answered syntheticData:true in THIS page
  // load. The offline demo fallbacks (sign-in, role switch) require it; the
  // store's persisted `syntheticData` flag is a banner default, not evidence.
  var serverSaidSynthetic = false;
  // True while the signed-in UI is the kit's LOCAL demo (entered by the offline
  // fallbacks below), never for a real server session. Only a local demo may
  // keep optimistic results when the network fails; a real session must say
  // that nothing reached the server.
  var localDemoSession = false;
  var meId = null;   // current user's backend id (for messaging "me" / participants)
  // A message window is mapped FOR one identity: mapMessage() derives "me",
  // "unread by me" and the receipt from meId, and hydrateConversations() keeps
  // a known conversation's loaded window. So when a DIFFERENT person takes over
  // this page without a sign-out — the demo role switch signs straight in as
  // another account; a developer opens, leaves or manages a portal — the
  // previous person's threads are dropped in the same update that installs the
  // new identity (never re-used, not even a conversation both are in) and the
  // new identity's list maps every thread from its own side. No previous
  // identity (fresh page, or after a sign-out, which already cleared them) is
  // not a switch.
  function adoptIdentity(id) {
    var switched = meId != null && id !== meId;
    meId = id;
    return switched;
  }
  function dropPreviousThreads(s, switched) {
    if (switched) { s.conversations = []; s.__activeConvo = null; s.__openThread = null; }
    return s;
  }
  var auditLoaded = false; // fetch the per-org audit trail once per context, then only while viewing Compliance
  var prefsLoaded = false; // load per-org consult catalog + theme once per context (later rehydrates keep local edits)
  // Demo console: when loaded as an iframe pane with ?token=<t>, this pane
  // authenticates with that bearer token instead of the shared session cookie,
  // so three users can run side by side in one browser. Null for normal use.
  var DEMO_TOKEN = (function () { try { return new URLSearchParams(window.location.search).get("token"); } catch (e) { return null; } })();
  var ws = null;     // live WebSocket for real-time messages + assignment events

  // ---- app lock (A.CON-SHO-7) ---------------------------------------------
  // The lock is the SERVER's: POST /api/session/lock makes every data route
  // answer 423 session_locked and closes this session's sockets (4423), and
  // only a real sign-in (POST /api/login, the lock screen) unlocks. On this
  // side, while the lock flag (window.__dtLock, index.html) is set the tab
  // sends NOTHING but the sign-in / identity calls below: no hydrate, no
  // re-hydrate on a realtime event, no broadcast catch-up, no resync, no poll,
  // no socket — so a locked tab neither renews the session nor pulls data
  // into memory. A 423 from the server (or a 4423 socket close) engages the
  // lock here too, even if the browser's own flag was deleted.
  var LOCK_ALLOWED = /^\/api\/(login|logout|session|session\/lock|user|config|2fa\/complete-login|2fa\/request-sms)(\?|$)/;
  // True once THIS page load has the server's word that the session is live
  // and unlocked (sign-in, restore, demo-token bootstrap). A session object
  // restored from the persisted snapshot is only a display hint: nothing is
  // fetched on its strength — not even the module map — until the server has
  // confirmed it, so a reload of a locked tab whose browser flag was deleted
  // sends only the restore probe.
  var sessionConfirmed = false;
  function lockActive() {
    try { return !!(window.__dtLock && window.__dtLock.isLocked()); } catch (e) { return false; }
  }
  function lockedError() { var e = new Error("session_locked"); e.status = 423; return e; }
  function dropSocket() {
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    try { if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } } catch (e) {}
  }
  // The server says this session is locked: show the lock screen (index.html
  // listens for dt-lock-change) with the identity to re-authenticate.
  function engageLock(identity) {
    dropSocket();
    sessionConfirmed = false;
    var L = window.__dtLock;
    if (!L) return;
    if (!L.isLocked()) {
      var sess = DT.getState().session || {};
      var id = identity || { org: sess.org, user: sess.user, name: sess.name, role: sess.role };
      if (!L.set(id)) {
        // No identity to re-authenticate with: this tab cannot show a lock
        // screen, so it signs out instead of showing data it cannot refresh.
        if (sess.role) expireSession();
        return;
      }
      try { if (DT.purgePersisted) DT.purgePersisted(); } catch (e) {}
    }
    try { window.dispatchEvent(new Event("dt-lock-change")); } catch (e) {}
  }
  // Another tab of this browser locked: its server call locked the shared
  // session (and closed these sockets too); drop ours at once regardless.
  try {
    window.addEventListener("storage", function (e) {
      if (!window.__dtLock || (e.key !== null && e.key !== window.__dtLock.KEY)) return;
      if (lockActive()) dropSocket();
    });
  } catch (e) {}
  // Safety: some screens call DT.actions.toast(); ensure it exists.
  if (!DT.actions.toast) {
    DT.actions.toast = function (t) { DT.set(function (s) { s.__toast = t; return s; }); };
  }

  // Demo accounts per role (all seed passwords are "docturn").
  var DEMO = {
    hospitalist: "chen",
    er_doctor: "er.doc",
    er_director: "er.director",
    director: "director",
    developer: "dev",
  };

  // The developer account lives in its own platform org, not a clinical tenant,
  // so resolve the right org code by role. Clinical roles must NEVER inherit the
  // platform org (e.g. when switching role from Developer) — their demo accounts
  // live in the ISPN tenant.
  var PLATFORM_ORG = "DOCTURN";
  function orgForRole(role, fallback) {
    if (role === "developer") return PLATFORM_ORG;
    if (!fallback || fallback === PLATFORM_ORG) return "ISPN";
    return fallback;
  }
  // The seeded demo account for a role (synthetic-data mode only). Used to
  // PRE-FILL the sign-in form and by the demo role switcher — never substituted
  // for what a user actually typed.
  DT.demoAccount = function (role) {
    return { org: orgForRole(role), user: DEMO[role] || "chen", pass: "docturn" };
  };

  // Remember the active role/org so we can transparently re-authenticate if the
  // server session goes away (15-min idle expiry, OR a dev-server restart that
  // wipes the in-memory session store). Set on every successful doLogin.
  var lastAuth = null;
  // Set once a response says the org requires MFA for this privileged session
  // (403 mfa_enrollment_required); de-dupes the state flip across the many
  // parallel hydrate calls that all fail the same way.
  var mfaFlagged = false;
  // Same de-dupe for the forced password change (403 password_change_required).
  var pwChangeFlagged = false;
  // Auth epoch: bumped every time the session identity changes (login, role
  // switch, impersonation in/out, logout). A 401 belonging to a request that
  // was issued under an OLDER epoch is a stale response racing the swap — it
  // must never be read as "the current session expired".
  var authEpoch = 0;
  function newAuthEpoch() { authEpoch++; }
  // Analytics (/api/metrics/comms, /api/reports/ops) are director-level.
  var PRIVILEGED = { director: 1, er_director: 1, developer: 1 };
  // GET /api/patient-board: requireRole(hospitalist, er_doctor, er_director, director).
  var BOARD_ROLES = { hospitalist: 1, er_doctor: 1, er_director: 1, director: 1 };

  // `meta` (optional) receives response metadata: meta.hasMore from a paged
  // thread read's X-Has-More header.
  function rawApi(method, path, body, meta) {
    // Locked: nothing but sign-in / identity calls leave this tab (A.CON-SHO-7).
    if (lockActive() && !LOCK_ALLOWED.test(path)) return Promise.reject(lockedError());
    var headers = body ? { "Content-Type": "application/json" } : {};
    if (DEMO_TOKEN) headers["Authorization"] = "Bearer " + DEMO_TOKEN;
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: (body || DEMO_TOKEN) ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (meta) { try { meta.hasMore = !!(r.headers && r.headers.get && r.headers.get("X-Has-More") === "1"); } catch (e) {} }
      if (r.status === 204) return null;
      return r.text().then(function (t) {
        var d = null;
        if (t) { try { d = JSON.parse(t); } catch (e) { d = { error: t.slice(0, 120) }; } }
        if (!r.ok) {
          var err = new Error((d && d.error) || r.statusText || ("HTTP " + r.status));
          err.status = r.status;
          // The server's explanation, for screens that show it (Integrations:
          // the 409 reason / the invalid field). Never a secret — the server
          // does not put one in an error body.
          err.body = d || null;
          if (r.status === 423 && d && d.error === "session_locked" && !lockActive()) engageLock();
          throw err;
        }
        return d;
      });
    });
  }

  // Server-side session loss → sign-in screen, with the same PHI hygiene as an
  // explicit logout (clinical slices + persisted snapshot cleared). De-duped so
  // a burst of failing hydrate calls produces one transition and one message.
  // `why` = "revoked" when the server ended this session because the password
  // was changed or reset elsewhere (WebSocket close 1008 "session_revoked").
  var sessionExpiring = false;
  function expireSession(why) {
    if (sessionExpiring) return;
    sessionExpiring = true;
    sessionConfirmed = false;
    newAuthEpoch();
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    try { if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } } catch (e) {}
    meId = null; lastAuth = null; localDemoSession = false;
    dashHydrated = false; lastDashSnap = null;
    mfaFlagged = false; pendingMfaFinish = null;
    // UI flags first, then the store's logout (which purges the persisted
    // snapshot last), so nothing re-persists after the purge (A.CON-SHO-63).
    DT.set(function (s) {
      s.mfaEnrollmentRequired = false; s.mfaChallenge = null;
      s.loginError = why === "revoked"
        ? "You were signed out because your password was changed or reset. Sign in again."
        : "Your session expired — please sign in again.";
      return s;
    });
    if (origLogout) origLogout();
    setTimeout(function () { sessionExpiring = false; }, 2000);
  }

  // API wrapper: surfaces MFA-enrolment gating and expired sessions to the UI.
  // It never re-authenticates on the caller's behalf.
  function api(method, path, body, meta) {
    var epoch = authEpoch; // which session identity this request belongs to
    return rawApi(method, path, body, meta).catch(function (e) {
      // The org requires MFA for privileged roles and this session hasn't
      // enrolled: the server answers everything but the enrolment routes this
      // way. Route the UI to the enrolment screen; never self-heal (a re-login
      // would just be flagged again).
      if (e && e.status === 403 && String(e.message) === "mfa_enrollment_required") {
        if (!mfaFlagged) {
          mfaFlagged = true;
          DT.set(function (s) { s.mfaEnrollmentRequired = true; return s; });
        }
        throw e;
      }
      // A provisioned / admin-reset account must replace its one-time password
      // before anything else: route the UI to the change-password screen.
      if (e && e.status === 403 && String(e.message) === "password_change_required") {
        if (!pwChangeFlagged) {
          pwChangeFlagged = true;
          DT.set(function (s) { s.passwordChangeRequired = true; return s; });
        }
        throw e;
      }
      var is401 = e && (e.status === 401 || String(e.message) === "unauthorized");
      // The server session is gone (15-min idle expiry, restart, revocation).
      // There is deliberately NO automatic re-login: the client never holds a
      // password, and re-authenticating as a well-known demo account would both
      // defeat the idle timeout and could swap a real user's session for a
      // different account. Drop to the sign-in screen once (the parallel
      // hydrate calls all fail together) and let the user authenticate again.
      if (is401 && epoch === authEpoch && path !== "/api/login" && !DEMO_TOKEN && DT.getState().session) expireSession();
      throw e;
    });
  }
  var get = function (p) { return api("GET", p); };

  function initials(name) {
    try { return fmt.initialsOf(name); } catch (e) { return (name || "?").slice(0, 2).toUpperCase(); }
  }
  function bid(kitId) { return Number(String(kitId).replace(/^h/, "")); }

  // ---- mappers: backend shape -> kit shape --------------------------------
  function mapProviders(hosps, usersById) {
    return (hosps || []).map(function (h) {
      var u = usersById[h.userId] || {};
      return {
        id: "h" + h.id,
        name: u.displayName || ("Provider #" + h.id),
        avatar: initials(u.displayName || "P"),
        specialty: h.specialty,
        census: h.currentPatientCount,
        cap: h.patientCap,
        working: !!h.working,
        shift: h.shiftType,
        inRotation: true,
      };
    });
  }
  // GET /api/rotation/next -> store.rotation (the ONLY "Next up" source in a
  // live session; see store.js nextUp). Kit provider ids are "h" + id.
  function mapRotation(r) {
    return {
      source: "server",
      mode: r.mode || "lowest_census",
      shiftTypes: Array.isArray(r.shiftTypes) ? r.shiftTypes : [],
      capRelief: !!r.capRelief,
      nextId: r.next ? "h" + r.next.hospitalistId : null,
      next: r.next || null,
      order: (r.order || []).map(function (id) { return "h" + id; }),
    };
  }
  // A failed preview never falls back to a local guess in a live session: the
  // UI says "decided when you send" instead of naming someone. (Only the
  // offline demo, which has no server at all, keeps the store's local rules.)
  function rotationFailure(e) {
    if (localDemoSession && isNetworkError(e)) return null;
    return { source: e && e.status === 404 && String(e.message) === "module_disabled" ? "disabled" : "unavailable" };
  }
  var ROTATION_ROLES = { er_doctor: 1, er_director: 1, director: 1, hospitalist: 1 };
  var rotationSess = null; // the session whose preview state.rotation holds
  function mapPending(assignments, patientsById, usersById) {
    return (assignments || []).map(function (a) {
      var p = patientsById[a.patientId] || {};
      var er = usersById[a.erDoctorId] || {};
      return {
        id: a.id,
        patientId: a.patientId,
        initials: p.initials || "??",
        room: p.roomNumber || "—",
        complaint: p.issueSummary || "",
        from: (er.displayName || "ER") + " (ER)",
        specialty: p.specialty || "General Medicine",
        acuity: p.acuity || null,
        via: a.via === "manual" ? "Manual" : "Round-robin",
        expiresAt: a.expiresAt ? new Date(a.expiresAt).getTime() : Date.now() + 600000,
      };
    });
  }
  function mapAccepted(assignments, patientsById, consultByPid, consultDetailByPid) {
    return (assignments || []).map(function (a) {
      var p = patientsById[a.patientId] || {};
      // `at` drives the hospitalist dashboard's "this shift" filter — without it
      // a handed-off/reassigned patient would be filtered out and never show.
      return { id: "p" + a.id, patientId: a.patientId, at: a.createdAt ? new Date(a.createdAt).getTime() : Date.now(), initials: p.initials || "??", room: p.roomNumber || "—", complaint: p.issueSummary || "", consultants: (consultByPid && consultByPid[a.patientId]) || [], consultDetails: (consultDetailByPid && consultDetailByPid[a.patientId]) || [] };
    });
  }
  // ER "Patient board": the assignments this ER routed, with LIVE backend status
  // (so declines show as "re-routed", reassigns show the new provider, accepts
  // show "accepted") — replaces the optimistic-only local list.
  function mapSent(rows) {
    // Keep accept vs decline DISTINCT: a hospitalist reject = "declined" (red),
    // a timeout = "expired", a handoff away = "rerouted" — not all lumped together.
    var SMAP = { pending: "sent", accepted: "accepted", rejected: "declined", expired: "expired", cancelled: "rerouted" };
    var now = new Date();
    return (rows || []).map(function (a) {
      var d = a.createdAt ? new Date(a.createdAt) : now;
      // The app's one locale-aware day/clock format (dtFmt, A.CON-MIN-18).
      var day = fmt.dayLabel ? fmt.dayLabel(d.getTime()) : "Today";
      return {
        id: "as" + a.id, backendId: a.id, patientId: a.patientId,
        initials: a.initials, provider: a.provider, complaint: a.complaint,
        consultants: [], acuity: a.acuity || null,
        time: fmt.stamp ? fmt.stamp(d.getTime()) : day + " · " + fmt.hhmm(d.getTime()), day: day,
        status: SMAP[a.status] || "sent",
      };
    });
  }
  // Backend audit/PHI rows → the kit's Compliance shape (per-org, real).
  function mapAudit(rows, usersById, orgCode) {
    return (rows || []).map(function (r) {
      var u = usersById[r.userId];
      return {
        id: r.id,
        at: new Date(r.createdAt || Date.now()).getTime(),
        actor: (u && u.displayName) || (r.userId ? "User " + r.userId : "System"),
        role: (u && u.role) || "",
        action: r.action || "",
        resource: r.resourceType ? (r.resourceType + (r.resourceId != null ? " #" + r.resourceId : "")) : "",
        ip: "—",
        org: orgCode,
        risk: r.riskLevel || "low",
      };
    });
  }
  function mapPhi(rows, usersById) {
    return (rows || []).map(function (r) {
      var u = usersById[r.userId];
      return {
        id: r.id,
        at: new Date(r.createdAt || Date.now()).getTime(),
        actor: (u && u.displayName) || (r.userId ? "User " + r.userId : "System"),
        patient: r.resource || "—",
        access: r.method || "",
        fields: "", purpose: "",
        ok: true,
      };
    });
  }
  // Normalize a board row's consultDetails → the kit's consult-roster shape:
  // who was consulted, their status, and when they responded.
  function mapConsultDetails(details) {
    return (details || []).map(function (c) {
      return {
        id: c.id, specialty: c.specialty,
        name: c.name || (c.consultantUserId ? "Consultant" : "On-call team"),
        credential: c.credential || "", status: c.status || "requested",
        userId: c.consultantUserId || null,
        respondedAt: c.respondedAt ? new Date(c.respondedAt).getTime() : null,
        requestedAt: c.requestedAt ? new Date(c.requestedAt).getTime() : null,
      };
    });
  }
  function mapBoard(rows) {
    return (rows || []).map(function (r) {
      return {
        id: "b" + r.patient.id,
        assignmentId: r.assignmentId || null, // backend id, for director/ER reassign
        patientId: r.patient.id,
        initials: r.patient.initials,
        room: r.patient.room || "—",
        dept: r.patient.department || "MED",
        issue: r.patient.issue || "",
        acuity: r.patient.acuity || null,
        // Prefer the DERIVED routing status (pending / assigned / rejected /
        // waiting) over the raw patient column, so declines surface on the board.
        status: r.status || r.patient.status,
        attending: r.responsible && r.responsible.attending
          ? { name: r.responsible.attending.displayName, avatar: initials(r.responsible.attending.displayName) }
          : { name: "", avatar: "" },
        unit: (r.responsible && r.responsible.unit ? r.responsible.unit : []).map(function (u) {
          return { avatar: initials(u.displayName), role: u.credential || "" };
        }),
        consultants: r.consultants || [],
        // Per-consultant detail: who was consulted on each specialty + status.
        consultDetails: mapConsultDetails(r.consultDetails),
        er: r.admittedBy ? { name: r.admittedBy.displayName, avatar: initials(r.admittedBy.displayName) } : { name: "", avatar: "" },
      };
    });
  }

  // ---- hydrate live data into the store (best-effort, role-aware) ----------
  function hydrate(role) {
    // Until the server's preview lands, "Next up" is unknown — never the
    // store's local guess, nor the previous identity's (another org's) answer
    // (A.CON-SHO-29). The session object only changes on login / restore.
    var sessNow = DT.getState().session || null;
    if (ROTATION_ROLES[role] && !localDemoSession && (!DT.getState().rotation || sessNow !== rotationSess)) {
      rotationSess = sessNow;
      DT.set(function (s) { s.rotation = { source: "loading" }; return s; });
    }
    return Promise.all([
      get("/api/hospitalists").catch(function () { return null; }),
      // directory is readable by every role and carries provider names; /api/users
      // is director-only, so we derive names from the directory instead.
      get("/api/physicians/directory").catch(function () { return null; }),
      get("/api/patients").catch(function () { return null; }),
      // EVERY org user (all roles) for name resolution — so a DM with an ER
      // physician or director shows their real name, not "Conversation".
      get("/api/care-team/candidates").catch(function () { return null; }),
    ]).then(function (res) {
      var hosps = res[0], directory = res[1], patients = res[2], candidates = res[3];
      var usersById = {};
      (directory || []).forEach(function (d) {
        usersById[d.userId] = { displayName: d.displayName, credential: d.credential };
      });
      var users = directory; // truthy gate below
      var patientsById = {};
      (patients || []).forEach(function (p) { patientsById[p.id] = p; });

      var extra = [];
      // Hospitalists — and directors who also take patients — get the incoming
      // queue + their census.
      if (role === "hospitalist" || role === "director") {
        extra.push(get("/api/assignments/pending").catch(function () { return []; }));
        extra.push(get("/api/assignments/my").catch(function () { return []; }));
      } else {
        extra.push(Promise.resolve([]));
        extra.push(Promise.resolve([]));
      }
      // Role-gated on the server (board.ts requireRole: the four clinical
      // roles, not developer) — never ask for what this role can't read
      // (A.CON-MIN-14: a developer's hydrate logged a 403).
      extra.push(BOARD_ROLES[role] ? get("/api/patient-board").catch(function () { return null; }) : Promise.resolve(null));
      // ER roles: their live "sent" board (declines / re-routes / accepts).
      var wantsSent = (role === "er_doctor" || role === "er_director");
      extra.push(wantsSent ? get("/api/assignments/sent").catch(function () { return null; }) : Promise.resolve(null));
      // Director / ER director: the org settings their Settings screen shows
      // (auto-reassign, STAT SMS fallback, assignment timeout) — always the
      // server's values, never the store's demo defaults.
      extra.push(role === "director" || role === "er_director" ? get("/api/settings").catch(function () { return null; }) : Promise.resolve(null));
      // Director / ER director: pending self-registrations awaiting approval.
      var wantsRegs = (role === "director" || role === "er_director");
      extra.push(wantsRegs ? get("/api/registrations").catch(function () { return null; }) : Promise.resolve(null));
      // Roles that can see compliance get the REAL per-org audit + PHI trail, so
      // the Compliance screen reflects this organization (individualized), not a
      // locally-accumulated demo log. Fetch it once per context, then only while
      // the Compliance screen is open — so routine rehydrates (every action / WS
      // event) don't pay for it.
      var canAudit = (role === "director" || role === "er_director" || role === "developer");
      var onCompliance = (DT.getState().ui && DT.getState().ui.nav) === "compliance";
      var wantsAudit = canAudit && (!auditLoaded || onCompliance);
      extra.push(wantsAudit ? get("/api/audit").catch(function () { return null; }) : Promise.resolve(null));
      // Per-organization preferences (every role): the consult-service catalog and
      // appearance/theme are individualized per tenant. Load ONCE per context so a
      // later rehydrate can't clobber an in-progress local edit.
      extra.push(!prefsLoaded ? get("/api/org/config").catch(function () { return null; }) : Promise.resolve(null));
      // Round-robin "Next up" from the routing planner itself (A.CON-SHO-29):
      // the Director card, the ER Quick hint and the hospitalist chip all read
      // it, so none of them can name an at-cap or off-shift provider.
      extra.push(ROTATION_ROLES[role] ? get("/api/rotation/next").then(mapRotation, rotationFailure) : Promise.resolve(null));

      return Promise.all(extra).then(function (e) {
        var pending = e[0], mine = e[1], board = e[2], sent = e[3], settings = e[4], regs = e[5], auditData = e[6], orgCfg = e[7], rotation = e[8];
        DT.set(function (s) {
          if (hosps && users) s.providers = mapProviders(hosps, usersById);
          if (rotation) {
            s.rotation = rotation;
            // The org's real rotation mode (the card's "lowest census first" /
            // "sequential" wording and the hospitalist chip follow it).
            if (rotation.source === "server") s.settings = Object.assign({}, s.settings, { rotationMode: rotation.mode });
          } else if (s.rotation && s.rotation.source === "loading") {
            s.rotation = null; // no answer and no live server (offline demo): local rules
          }
          // Full registered directory (all roles): drives the ER Consult-services
          // roster + midlevel pool from real people, not hardcoded lists.
          if (directory) s.directory = (directory || []).map(function (d) {
            return { id: d.userId, name: d.displayName, avatar: initials(d.displayName), specialty: d.specialty || "", credential: d.credential || "", working: !!d.working, shift: d.shiftType || "" };
          });
          // Org-wide people map for NAME RESOLUTION in messaging. The directory
          // above only carries hospitalists, so a DM with an ER physician or a
          // director would otherwise show "Conversation". Merge in the care-team
          // candidate roster (every org user except me + already-linked), so any
          // conversation partner resolves to a real name + role/specialty. Never
          // clobber a richer directory entry with a thinner candidate one.
          if (directory || candidates) {
            var people = Object.assign({}, s.orgPeople || {});
            (directory || []).forEach(function (d) {
              people[d.userId] = { id: d.userId, name: d.displayName, credential: d.credential || "", specialty: d.specialty || "", working: !!d.working, role: "hospitalist" };
            });
            (candidates || []).forEach(function (c) {
              if (!people[c.userId]) people[c.userId] = { id: c.userId, name: c.displayName, credential: c.credential || "", specialty: roleLabel(c.role), working: false, role: c.role };
            });
            s.orgPeople = people;
          }
          // Consultants per patient come off the live board so census/sent rows
          // can show who was consulted, their status, and when they responded.
          var consultByPid = {}, consultDetailByPid = {};
          (board || []).forEach(function (r) {
            if (r && r.patient) {
              consultByPid[r.patient.id] = r.consultants || [];
              consultDetailByPid[r.patient.id] = mapConsultDetails(r.consultDetails);
            }
          });
          if (role === "hospitalist" || role === "director") {
            s.pending = mapPending(pending, patientsById, usersById);
            var census = mapAccepted(mine, patientsById, consultByPid, consultDetailByPid);
            s.myPatients = census;
            // The hospitalist dashboard AND the director's "My hospitalist work"
            // widget both render myAdmissions — keep it authoritative from the
            // server so a reassigned/handed-off patient shows up automatically.
            s.myAdmissions = census;
            s.isProvider = (hosps || []).some(function (h) { return h.userId === meId; });
          }
          if (board) s.board = mapBoard(board);
          if (wantsSent && sent) s.sent = mapSent(sent).map(function (row) {
            return Object.assign({}, row, { consultDetails: consultDetailByPid[row.patientId] || [] });
          });
          if (settings && settings.org) {
            s.settings = Object.assign({}, s.settings, { autoReassign: !!settings.org.autoReassignOnDecline, statSmsFallback: settings.org.statSmsFallback !== false },
              typeof settings.org.assignmentTimeoutMin === "number" ? { timeout: settings.org.assignmentTimeoutMin } : {});
            if (typeof settings.org.assignmentTimeoutMin === "number") lastServerTimeout = settings.org.assignmentTimeoutMin;
          }
          if (wantsRegs && regs) s.registrations = regs;
          if (wantsAudit && auditData) {
            var orgCode = (s.session && s.session.org) || s.selectedOrg || "";
            s.audit = mapAudit(auditData.audit, usersById, orgCode);
            s.phiLog = mapPhi(auditData.phiAccess, usersById);
            auditLoaded = true;
          }
          // Per-org consult-service catalog + theme (fall back to defaults when
          // the tenant hasn't customized them). Applied once per context.
          if (orgCfg && !prefsLoaded) {
            if (Array.isArray(orgCfg.consultServices) && orgCfg.consultServices.length) s.consultServices = orgCfg.consultServices;
            if (orgCfg.theme && typeof orgCfg.theme === "object") s.theme = Object.assign({}, s.theme, orgCfg.theme);
            prefsLoaded = true;
          }
          return s;
        });
      });
    }).catch(function () { /* keep demo data on any failure */ });
  }
  function rehydrate() {
    var st = DT.getState();
    return hydrate(st.session && st.session.role);
  }

  // ---- messaging (real, cross-device) --------------------------------------
  // Human label for a raw role code (used when a conversation partner is not a
  // hospitalist, so the directory has no specialty for them).
  function roleLabel(role) {
    return ({ hospitalist: "Provider", er_doctor: "ER physician", er_director: "ER director", director: "Director", developer: "Admin" })[role] || "Provider";
  }
  // Resolve a userId to a person, preferring the rich directory entry and
  // falling back to the org-wide people map (covers ER physicians, directors,
  // and anyone else not in the hospitalist directory).
  function personForUserId(uid) {
    var d = (DT.getState().directory || []).find(function (x) { return x.id === uid; });
    if (d) return d;
    var p = (DT.getState().orgPeople || {})[uid];
    return p || null;
  }
  function nameForUserId(uid) {
    var p = personForUserId(uid);
    return p ? p.name : null;
  }
  function dirByUserId(uid) {
    return personForUserId(uid);
  }
  // Sender-side receipt (A.CON-SHO-26), derived ONLY from the server's
  // per-recipient delivery rows — never assumed:
  //   "read"      every recipient has read (or acknowledged) it;
  //   "delivered" it reached every recipient's inbox, not yet read by all;
  //   "sent"      stored on the server, delivery not recorded yet.
  // The device's own "sending" / "failed" states come from the outbox below.
  function receiptFor(deliveries) {
    var rows = deliveries || [];
    if (!rows.length) return "sent";
    if (rows.every(function (d) { return !!(d.readAt || d.acknowledgedAt); })) return "read";
    if (rows.every(function (d) { return !!d.deliveredAt; })) return "delivered";
    return "sent";
  }
  function countWhere(list, pred) { var n = 0; (list || []).forEach(function (x) { if (pred(x)) n++; }); return n; }
  // Server message (a thread-view row or a live MESSAGE_RECEIVED frame, which
  // the server decorates the same way) -> kit message. A frame from an older
  // server / a covering copy may lack attachments + delivery rows; callers
  // re-sync that one thread in that case (see applyIncoming).
  function mapMessage(m) {
    var mine = m.senderId === meId;
    var hasRows = Array.isArray(m.deliveries);
    var dl = hasRows ? m.deliveries : [];
    var own = null;
    if (!mine) dl.forEach(function (d) { if (d.userId === meId) own = d; });
    var receipt = mine ? receiptFor(dl) : null;
    return {
      id: m.id, me: mine, senderId: m.senderId, text: m.content,
      at: new Date(m.createdAt || Date.now()).getTime(),
      receipt: receipt, read: receipt === "read",
      priority: m.priority || "routine",
      ackCount: typeof m.ackCount === "number" ? m.ackCount : countWhere(dl, function (d) { return !!d.acknowledgedAt; }),
      readCount: typeof m.readCount === "number" ? m.readCount : countWhere(dl, function (d) { return !!d.readAt; }),
      ackedByMe: !!m.acknowledgedByMe || !!(own && own.acknowledgedAt),
      // My own delivery row decides "unread" — the server's rule for unreadCount.
      // A message that arrived without rows has, by definition, just arrived.
      unreadByMe: !mine && (hasRows ? !!own && !own.readAt : true),
      attachments: m.attachments || [],
      // Provenance of a forwarded message ({messageId, senderName, sentAt, ...}).
      forwardedFrom: m.forwardedFrom || null,
      // Per-recipient delivery state (group threads: "Seen by N · Acked by M").
      deliveries: dl,
    };
  }
  // Unread = messages from others that my delivery row says I have not read
  // and that this session has not just marked read (readPosted).
  function unreadOf(msgs) {
    return countWhere(msgs, function (m) { return !m.me && !m.local && m.id != null && m.unreadByMe && !readPosted[m.id]; });
  }
  // A conversation's unread = my unread messages OLDER than its loaded window
  // (counted by the server) + the unread ones inside the window.
  function unreadFor(c, msgs) { return ((c && c.unreadEarlier) || 0) + unreadOf(msgs); }
  function byTime(x, y) { return (x.at - y.at) || ((x.id || 0) - (y.id || 0)); }
  function serverMsgs(c) { return ((c && c.messages) || []).filter(function (m) { return !m.local; }); }
  function minId(msgs) { var n = null; (msgs || []).forEach(function (m) { if (m.id != null && (n === null || m.id < n)) n = m.id; }); return n; }
  function maxId(msgs) { var n = null; (msgs || []).forEach(function (m) { if (m.id != null && (n === null || m.id > n)) n = m.id; }); return n; }
  // Kit conversation from a server conversation row and its loaded window.
  //   serverUnread  the server's unread count for me (sets unreadEarlier);
  //                 omitted → keep the previous unreadEarlier.
  //   flags         { loaded, hasEarlier } — omitted → keep the previous ones.
  function convoView(c, msgs, prev, serverUnread, flags) {
    var others = (c.participantIds || []).filter(function (id) { return id !== meId; });
    var dirOther = others.length ? dirByUserId(others[0]) : null;
    var nm = c.name || (others.length === 1 ? (nameForUserId(others[0]) || "Conversation") : "Group conversation");
    var list = (msgs || []).slice().sort(byTime);
    var f = flags || {};
    var unreadEarlier = typeof serverUnread === "number" ? Math.max(0, serverUnread - unreadOf(list)) : ((prev && prev.unreadEarlier) || 0);
    return {
      id: c.id,
      name: nm,
      role: c.type === "emergency" ? "Code · all providers" : (c.type === "group" ? ("Group · " + (c.participantIds || []).length + " members") : ((dirOther && dirOther.specialty) || "Provider")),
      initials: initials(nm),
      presence: (dirOther && dirOther.working) ? "online" : "offline",
      tint: c.type === "emergency" ? "slate" : (c.type === "group" ? "blue" : "emerald"),
      unread: unreadEarlier + unreadOf(list),
      unreadEarlier: unreadEarlier,
      // The thread itself is read only when it is opened (A.CON-SHO-65):
      // until then `messages` holds the list's newest message (the preview).
      loaded: f.loaded != null ? !!f.loaded : !!(prev && prev.loaded),
      hasEarlier: f.hasEarlier != null ? !!f.hasEarlier : !!(prev && prev.hasEarlier),
      loadingEarlier: false,
      group: c.type === "group",
      broadcast: c.type === "emergency",
      patientId: c.patientId != null ? c.patientId : null,
      typing: prev ? !!prev.typing : false,
      participantIds: c.participantIds || [],
      messages: mergeOutbox(c.id, list),
    };
  }

  // ---- live message state (A.CON-SHO-65) ----------------------------------
  // What reads a thread (each read is a PHI-access audit row on the server):
  //   - sign-in / restore: the conversation LIST only (one row) — every
  //     thread shows its newest message and the server's unread count;
  //   - opening a thread: its newest page (enough to cover what is unread),
  //     then "Load earlier" one page at a time;
  //   - an incomplete frame / an ack this device cannot place, for a thread
  //     that is OPEN (loaded) only: that one page again, debounced.
  // Realtime frames are applied to the store as they arrive. A socket that
  // comes back asks GET /api/messaging/sync once — new messages since the
  // newest id held here, receipts and recalls since the last cursor — and
  // applies the answer; when nothing changed it carries no message content
  // and the server writes no PHI-access row.
  //   liveSeq   stamps messages applied from a frame / sync / send response, so
  //             a page fetch that started before they arrived cannot drop them;
  //   recalled  ids recalled this session, so a stale snapshot cannot revive one.
  var PAGE = 50, PAGE_MAX = 200, SYNC_ROUNDS_MAX = 10;
  var liveSeq = 0;
  var recalled = {};
  var convosLiveEpoch = -1; // authEpoch whose conversations came from the server
  var syncCursor = null, syncEpoch = -1;
  function keepLive(prevMsgs, fetched, sinceSeq) {
    var have = {};
    fetched.forEach(function (m) { have[m.id] = true; });
    var extra = (prevMsgs || []).filter(function (m) { return !m.local && m.id != null && (m.liveSeq || 0) > sinceSeq && !have[m.id] && !recalled[m.id]; });
    return fetched.filter(function (m) { return !recalled[m.id]; }).concat(extra).sort(byTime);
  }
  function threadPath(id) { return "/api/messaging/conversations/" + id + "/messages"; }
  function findConvo(id) { return (DT.getState().conversations || []).find(function (c) { return c.id === id; }) || null; }
  // Newest message id this device holds: every window ends at its thread's
  // newest message, and ids are issued in creation order, so nothing at or
  // below it can be missing from a window's range.
  function maxSeenId() {
    var n = 0;
    (DT.getState().conversations || []).forEach(function (c) { var x = maxId(serverMsgs(c)); if (typeof x === "number" && x > n) n = x; });
    return n;
  }

  // The conversation list: at sign-in / restore, and when a conversation this
  // device does not know appears. Merges into what is loaded; a newer list
  // supersedes an older one.
  var listGen = 0;
  function hydrateConversations() {
    var gen = ++listGen, since = liveSeq, epoch = authEpoch;
    return get("/api/messaging/conversations").then(function (convos) {
      if (gen !== listGen || epoch !== authEpoch) return;
      convosLiveEpoch = epoch; // before the set, so its listeners see live data
      DT.set(function (s) {
        var prevById = {};
        (s.conversations || []).forEach(function (c) { prevById[c.id] = c; });
        s.conversations = (convos || []).map(function (c) {
          var prev = prevById[c.id];
          var preview = c.lastMessage && !recalled[c.lastMessage.id] ? [mapMessage(c.lastMessage)] : [];
          if (!prev) return convoView(c, preview, null, c.unreadCount || 0, { loaded: false, hasEarlier: false });
          var win = serverMsgs(prev);
          var top = maxId(win);
          if (preview.length && !win.some(function (m) { return m.id === preview[0].id; }) && (top === null || preview[0].id > top)) {
            // Newer than what this window holds: show it, and re-read the
            // thread's newest page when it is (next) on screen.
            return convoView(c, keepLive(win, win.concat(preview), since), prev, c.unreadCount || 0, { loaded: false });
          }
          return convoView(c, win, prev, c.unreadCount || 0);
        });
        return s;
      });
    }).catch(function () { /* keep whatever's there on failure */ }).then(function () {
      // First list of this sign-in: take the sync cursor (and anything sent
      // between this list and the socket coming up).
      if (epoch === authEpoch && convosLiveEpoch === epoch && (syncEpoch !== epoch || !syncCursor)) runSync();
    });
  }

  // Newest page of ONE thread — when it is opened, or to refresh an open one.
  var pageInflight = {};
  function fetchLatestPage(convoId) {
    var c0 = findConvo(convoId);
    if (!c0) return Promise.resolve();
    if (pageInflight[convoId]) return pageInflight[convoId];
    var since = liveSeq, epoch = authEpoch, meta = {};
    // Enough to show everything unread (plus context), at least a page, and
    // at least what an open thread already shows.
    var want = Math.min(PAGE_MAX, Math.max(PAGE, (c0.unread || 0) + 10, c0.loaded ? serverMsgs(c0).length : 0));
    var p = api("GET", threadPath(convoId) + "?limit=" + want, null, meta).then(function (rows) {
      if (epoch !== authEpoch) return;
      var fetched = (rows || []).map(mapMessage);
      DT.set(function (s) {
        s.conversations = (s.conversations || []).map(function (x) {
          if (x.id !== convoId) return x;
          var prevWin = serverMsgs(x);
          var merged = keepLive(prevWin, fetched, since);
          var hasEarlier = !!meta.hasMore;
          // Older pages already loaded here stay when the new page overlaps
          // what was shown (the window remains one contiguous run).
          var oldest = minId(fetched);
          if (x.loaded && oldest !== null && hasEarlier) {
            var inPage = {};
            fetched.forEach(function (m) { inPage[m.id] = true; });
            var older = prevWin.filter(function (m) { return m.id != null && m.id < oldest && !recalled[m.id]; });
            if (older.length && prevWin.some(function (m) { return inPage[m.id]; })) {
              merged = older.concat(merged).sort(byTime);
              hasEarlier = !!x.hasEarlier;
            }
          }
          // Unread messages that were "earlier" and are now in the window.
          var low = minId(prevWin);
          var had = {};
          prevWin.forEach(function (m) { had[m.id] = true; });
          var surfaced = merged.filter(function (m) { return m.id != null && !had[m.id] && (low === null || m.id < low); });
          var ue = hasEarlier ? Math.max(0, (x.unreadEarlier || 0) - unreadOf(surfaced)) : 0;
          return Object.assign({}, x, { messages: mergeOutbox(x.id, merged), loaded: true, hasEarlier: hasEarlier, unreadEarlier: ue, unread: ue + unreadOf(merged) });
        });
        return s;
      });
    }).catch(function (e) {
      if (e && (e.status === 403 || e.status === 404)) syncConversationList();
    }).then(function () { delete pageInflight[convoId]; });
    pageInflight[convoId] = p;
    return p;
  }
  // "Load earlier": the page before the oldest message shown.
  DT.actions.loadEarlier = function (convoId) {
    var c = findConvo(convoId);
    if (!c || !c.loaded || !c.hasEarlier || c.loadingEarlier) return Promise.resolve(false);
    var oldest = minId(serverMsgs(c));
    if (oldest === null) return Promise.resolve(false);
    var epoch = authEpoch, meta = {};
    var flag = function (on) {
      DT.set(function (s) { s.conversations = (s.conversations || []).map(function (x) { return x.id === convoId ? Object.assign({}, x, { loadingEarlier: on }) : x; }); return s; });
    };
    flag(true);
    return api("GET", threadPath(convoId) + "?limit=" + PAGE + "&before=" + oldest, null, meta).then(function (rows) {
      if (epoch !== authEpoch) return false;
      var page = (rows || []).map(mapMessage).filter(function (m) { return !recalled[m.id]; });
      DT.set(function (s) {
        s.conversations = (s.conversations || []).map(function (x) {
          if (x.id !== convoId) return x;
          var win = serverMsgs(x);
          var have = {};
          win.forEach(function (m) { have[m.id] = true; });
          var add = page.filter(function (m) { return !have[m.id]; });
          var merged = add.concat(win).sort(byTime);
          var ue = meta.hasMore ? Math.max(0, (x.unreadEarlier || 0) - unreadOf(add)) : 0;
          return Object.assign({}, x, { messages: mergeOutbox(x.id, merged), hasEarlier: !!meta.hasMore, loadingEarlier: false, unreadEarlier: ue, unread: ue + unreadOf(merged) });
        });
        return s;
      });
      return true;
    }, function () {
      if (epoch === authEpoch) flag(false);
      return false;
    });
  };

  // Reconnect resync (GET /api/messaging/sync). One request per established
  // socket — repeated only while the server says there is more.
  var syncInflight = null, syncAgain = false;
  function runSync() {
    if (convosLiveEpoch !== authEpoch) return Promise.resolve();
    if (syncInflight) { syncAgain = true; return syncInflight; }
    var epoch = authEpoch;
    if (syncEpoch !== epoch) { syncEpoch = epoch; syncCursor = null; }
    function round(n) {
      var q = "?after=" + maxSeenId() + (syncCursor ? "&since=" + encodeURIComponent(syncCursor) : "");
      return get("/api/messaging/sync" + q).then(function (r) {
        if (epoch !== authEpoch || !r) return;
        if (r.cursor) syncCursor = r.cursor;
        applySync(r);
        if (r.more && n + 1 < SYNC_ROUNDS_MAX) return round(n + 1);
      });
    }
    syncInflight = round(0).catch(function () {}).then(function () {
      syncInflight = null;
      // Asked again meanwhile (another socket came up, or a new sign-in):
      // run once more — runSync itself checks the current session.
      if (syncAgain) { syncAgain = false; return runSync(); }
    });
    return syncInflight;
  }
  // One recipient's delivery row, as the server now has it, on a message.
  function withDeliveryRow(m, row) {
    var hit = false;
    var dl = (m.deliveries || []).map(function (d) {
      if (d.userId !== row.userId) return d;
      hit = true;
      return Object.assign({}, d, row);
    });
    if (!hit) dl = dl.concat([row]);
    var receipt = m.me ? receiptFor(dl) : null;
    var mineRow = null;
    dl.forEach(function (d) { if (d.userId === meId) mineRow = d; });
    return Object.assign({}, m, {
      deliveries: dl,
      readCount: countWhere(dl, function (d) { return !!d.readAt; }),
      ackCount: countWhere(dl, function (d) { return !!d.acknowledgedAt; }),
      receipt: receipt, read: receipt === "read",
      ackedByMe: m.ackedByMe || !!(mineRow && mineRow.acknowledgedAt),
      unreadByMe: !m.me && !!mineRow && !mineRow.readAt,
    });
  }
  function applySync(r) {
    var known = {};
    (DT.getState().conversations || []).forEach(function (c) { known[c.id] = true; });
    var summary = null;
    var unknown = false;
    if (Array.isArray(r.conversations)) {
      summary = {};
      r.conversations.forEach(function (x) { summary[x.id] = x; if (!known[x.id]) unknown = true; });
    }
    var fresh = {};
    (r.messages || []).forEach(function (raw) {
      if (!raw || raw.id == null || recalled[raw.id]) return;
      if (!known[raw.conversationId]) { unknown = true; return; }
      var m = mapMessage(raw);
      m.liveSeq = ++liveSeq;
      (fresh[raw.conversationId] = fresh[raw.conversationId] || []).push(m);
    });
    var receipts = {};
    (r.receipts || []).forEach(function (d) { if (d && d.messageId != null) (receipts[d.conversationId] = receipts[d.conversationId] || []).push(d); });
    var gone = {};
    (r.recalled || []).forEach(function (x) { if (x && x.messageId != null) { recalled[x.messageId] = true; gone[x.messageId] = true; } });
    var stale = r.complete === false;
    var changed = unknown || stale || Object.keys(fresh).length || Object.keys(receipts).length || Object.keys(gone).length;
    if (!changed && summary) {
      // Nothing new: only a drifted unread count (read on another device)
      // or a thread I left would change anything.
      (DT.getState().conversations || []).forEach(function (c) {
        var sum = summary[c.id];
        if (!sum || Math.max(0, (sum.unreadCount || 0) - unreadOf(serverMsgs(c))) !== (c.unreadEarlier || 0)) changed = true;
      });
    }
    if (changed) {
      DT.set(function (s) {
        s.conversations = (s.conversations || []).filter(function (c) { return !summary || !!summary[c.id]; }).map(function (c) {
          var win = serverMsgs(c);
          var add = fresh[c.id] || [];
          var rc = receipts[c.id] || [];
          if (add.length) {
            var byId = {};
            add.forEach(function (m) { byId[m.id] = m; });
            win = win.map(function (m) { var n = byId[m.id]; if (n) { delete byId[m.id]; return n; } return m; })
              .concat(add.filter(function (m) { return byId[m.id]; }));
          }
          if (rc.length) {
            win = win.map(function (m) {
              var mine = rc.filter(function (d) { return d.messageId === m.id; });
              return mine.reduce(function (acc, d) {
                return withDeliveryRow(acc, { userId: d.userId, displayName: d.displayName, deliveredAt: d.deliveredAt, readAt: d.readAt, acknowledgedAt: d.acknowledgedAt, status: d.status, realertedAt: d.realertedAt || null, escalatedAt: d.escalatedAt || null });
              }, m);
            });
          }
          win = win.filter(function (m) { return !gone[m.id]; }).sort(byTime);
          var sum = summary && summary[c.id];
          var ue = sum ? Math.max(0, (sum.unreadCount || 0) - unreadOf(win)) : (c.unreadEarlier || 0);
          return Object.assign({}, c, { messages: mergeOutbox(c.id, win), unreadEarlier: ue, unread: ue + unreadOf(win), loaded: stale ? false : c.loaded });
        });
        return s;
      });
    }
    if (unknown) syncConversationList();
    if (stale) { var open = DT.getState().__activeConvo; if (open != null) fetchLatestPage(open); }
  }
  // A conversation this device does not know yet (a new thread, or I was added
  // to one): one list request. Debounced so a burst is one call.
  var listSyncTimer = null;
  function syncConversationList() {
    if (listSyncTimer) return;
    listSyncTimer = setTimeout(function () { listSyncTimer = null; hydrateConversations(); }, 250);
  }
  // Re-read the newest page of an OPEN (loaded) thread: an incomplete frame,
  // an ack/read this device cannot place, a send while the socket is down.
  // A thread that was never opened is not read — it is read when opened.
  // Debounced per conversation (~250 ms).
  var threadTimers = {};
  function refreshThread(convoId) {
    if (convoId == null) return;
    clearTimeout(threadTimers[convoId]);
    threadTimers[convoId] = setTimeout(function () {
      delete threadTimers[convoId];
      var c = findConvo(convoId);
      if (!c) { syncConversationList(); return; }
      if (c.loaded) fetchLatestPage(convoId);
    }, 250);
  }
  // Make sure a conversation is in state (after creating / forwarding into
  // one); resolves once it is.
  function ensureConversation(convoId) {
    if (findConvo(convoId)) return Promise.resolve();
    return hydrateConversations();
  }
  function wsLive() { return !!(ws && ws.readyState === 1); }

  // MESSAGE_RECEIVED: the frame carries the message decorated like the thread
  // view — apply it directly. Unknown thread → list sync; a frame without
  // attachments/delivery rows → re-read that thread if it is open.
  function applyIncoming(raw) {
    if (!raw || raw.id == null || raw.conversationId == null || recalled[raw.id]) return;
    var convoId = raw.conversationId;
    if (!findConvo(convoId)) { syncConversationList(); return; }
    var complete = Array.isArray(raw.attachments) && Array.isArray(raw.deliveries);
    var m = mapMessage(raw);
    m.liveSeq = ++liveSeq;
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        if (c.id !== convoId) return c;
        var list = serverMsgs(c);
        var idx = -1;
        list.forEach(function (x, i) { if (x.id === m.id) idx = i; });
        if (idx >= 0) {
          var cur = list[idx];
          // Never trade a richer copy (e.g. the send response's attachments)
          // for a thinner frame.
          var merged = complete ? Object.assign({}, cur, m) : Object.assign({}, m, { attachments: cur.attachments && cur.attachments.length ? cur.attachments : m.attachments, deliveries: cur.deliveries, receipt: cur.receipt, read: cur.read, unreadByMe: cur.unreadByMe, ackCount: cur.ackCount, readCount: cur.readCount });
          list = list.slice(); list[idx] = merged;
        } else {
          list = list.concat([m]);
        }
        list.sort(byTime);
        return Object.assign({}, c, { messages: mergeOutbox(c.id, list), unread: unreadFor(c, list) });
      });
      return s;
    });
    if (!complete) refreshThread(convoId);
  }
  // Patch one recipient's delivery row; returns false when no row matched (the
  // caller then re-reads that thread if it is open).
  function patchDelivery(convoId, messageIds, userId, patchRow) {
    var found = false;
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        if (convoId != null && c.id !== convoId) return c;
        var touched = false;
        var msgs = (c.messages || []).map(function (m) {
          if (m.id == null || messageIds.indexOf(m.id) < 0) return m;
          var row = null;
          (m.deliveries || []).forEach(function (d) { if (d.userId === userId) row = d; });
          if (!row) return m;
          touched = true; found = true;
          return withDeliveryRow(m, patchRow(row));
        });
        if (!touched) return c;
        return Object.assign({}, c, { messages: msgs, unread: unreadFor(c, msgs) });
      });
      return s;
    });
    return found;
  }
  // MESSAGE_ACK {messageId, conversationId, userId}: that recipient acknowledged
  // (which also marks it read). The STAT sweep reuses this frame with the
  // covering provider's id — no row here, so an open thread is re-read once.
  function applyAck(ev) {
    var at = new Date().toISOString();
    var ok = patchDelivery(ev.conversationId, [ev.messageId], ev.userId, function (d) {
      return d.acknowledgedAt ? d : Object.assign({}, d, { acknowledgedAt: at, readAt: d.readAt || at, status: "acknowledged" });
    });
    if (!ok) refreshThread(ev.conversationId);
  }
  // MESSAGE_READ {conversationId, messageIds, userId, readAt}: their receipt
  // rows flip so my receipt turns "Read" and a group's "Seen by" moves live.
  function applyRead(ev) {
    var readAt = ev.readAt || new Date().toISOString();
    var ok = patchDelivery(ev.conversationId, ev.messageIds, ev.userId, function (d) {
      return d.readAt ? d : Object.assign({}, d, { readAt: readAt, status: d.acknowledgedAt ? "acknowledged" : "read" });
    });
    if (!ok) refreshThread(ev.conversationId);
  }
  // STAT_REALERT {messageId, conversationId, userId}: the sweep re-alerted that
  // recipient (the sender's countdown moves on; A.CON-MIN-18). Nothing to fetch
  // when the message is not loaded here.
  function applyRealert(ev) {
    var uid = ev.userId != null ? ev.userId : meId;
    var at = ev.at || new Date().toISOString();
    patchDelivery(ev.conversationId, [ev.messageId], uid, function (d) {
      return d.realertedAt ? d : Object.assign({}, d, { realertedAt: at });
    });
  }
  // MESSAGE_RECALLED (A.CON-SHO-25): drop it from the thread at once — even
  // while it is open on screen — and recount unread from what remains.
  function applyRecall(ev) {
    recalled[ev.messageId] = true;
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        if (ev.conversationId != null && c.id !== ev.conversationId) return c;
        var msgs = (c.messages || []).filter(function (m) { return m.id !== ev.messageId; });
        if (msgs.length === (c.messages || []).length) return c;
        return Object.assign({}, c, { messages: msgs, unread: unreadFor(c, msgs) });
      });
      return s;
    });
  }

  // ---- outbox: messages this device is sending or failed to send ----------
  // A send is never shown as delivered before the server says so: the bubble
  // reads "Sending…" until POST /send answers, and a refused or offline send
  // stays in the thread as "Not sent" with its text, priority and attachments
  // kept for Retry / Edit (A.CON-SHO-26, A.CON-SHO-40). Held in memory only —
  // message text is PHI and never touches localStorage — and dropped on sign-out.
  var outbox = [];
  var outboxSeq = 0;
  function outboxView(o) {
    return {
      id: null, localId: o.localId, local: true, me: true, text: o.text, at: o.at,
      receipt: o.status, read: false, failReason: o.reason || null,
      priority: o.priority, ackCount: 0, readCount: 0, ackedByMe: false,
      attachments: o.attachments, forwardedFrom: null, deliveries: [],
    };
  }
  // Server messages first, then this conversation's unsent ones, by time. A
  // "sending" entry whose server copy has already arrived (the WS fan-out can
  // beat the POST response) is not shown twice.
  function mergeOutbox(convoId, serverMsgs) {
    var mine = outbox.filter(function (o) { return o.convoId === convoId && o.owner === meId; });
    if (!mine.length) return serverMsgs;
    var claimed = {};
    var extra = mine.filter(function (o) {
      if (o.status !== "sending") return true;
      var twin = serverMsgs.find(function (m) {
        return m.me && !claimed[m.id] && m.text === o.text && m.priority === o.priority && m.at >= o.at - 60000;
      });
      if (twin) { claimed[twin.id] = true; return false; }
      return true;
    }).map(outboxView);
    return serverMsgs.concat(extra).sort(function (x, y) { return x.at - y.at; });
  }
  function refreshOutbox(convoId) {
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        if (c.id !== convoId) return c;
        var server = (c.messages || []).filter(function (m) { return !m.local; });
        return Object.assign({}, c, { messages: mergeOutbox(c.id, server) });
      });
      return s;
    });
  }
  // Why a send failed, in words a clinician can act on.
  function sendFailure(e, o) {
    var code = String((e && e.message) || "");
    var offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline || isNetworkError(e)) return { code: "offline", text: "No connection — not sent." };
    if (/module_disabled/.test(code) && o.priority !== "routine") return { code: "priority_disabled", text: "Not sent — " + (o.priority === "stat" ? "STAT" : "urgent") + " messaging is switched off for your organization." };
    if (/module_disabled/.test(code)) return { code: "module_disabled", text: "Not sent — this feature is switched off for your organization." };
    if (e && e.status === 401) return { code: "session", text: "Not sent — your session expired." };
    if (e && (e.status === 403 || e.status === 404)) return { code: "no_access", text: "Not sent — you can no longer post in this conversation." };
    if (e && e.status === 429) return { code: "rate_limited", text: "Not sent — too many requests; try again in a moment." };
    return { code: "server", text: "Not sent — the server couldn't accept it." };
  }
  function postOutbox(o) {
    o.status = "sending"; o.reason = null; o.at = o.at || Date.now();
    refreshOutbox(o.convoId);
    var body = { conversationId: Number(o.convoId), content: o.text, priority: o.priority };
    var ids = o.attachments.map(function (a) { return a.id; }).filter(function (n) { return n != null; });
    if (ids.length) body.attachmentIds = ids;
    return api("POST", "/api/messaging/send", body).then(function (res) {
      outbox = outbox.filter(function (x) { return x !== o; });
      // Swap the local bubble for the stored message right away ("sent"). The
      // server's delivery rows ("delivered") arrive in my own MESSAGE_RECEIVED
      // frame — which may already have landed, in which case that richer copy
      // stays. Without a live socket, re-read just this thread.
      DT.set(function (s) {
        s.conversations = (s.conversations || []).map(function (c) {
          if (c.id !== o.convoId) return c;
          var server = serverMsgs(c);
          var have = res && res.id != null && server.some(function (m) { return m.id === res.id; });
          if (res && res.id != null && !have && !recalled[res.id]) {
            var mine = Object.assign(mapMessage(res), { attachments: o.attachments });
            mine.liveSeq = ++liveSeq;
            server = server.concat([mine]).sort(byTime);
          }
          return Object.assign({}, c, { messages: mergeOutbox(c.id, server) });
        });
        return s;
      });
      if (!wsLive()) refreshThread(o.convoId);
      return { ok: true, message: res };
    }).catch(function (e) {
      if (outbox.indexOf(o) < 0) return { ok: false };
      o.status = "failed"; o.reason = sendFailure(e, o);
      if (moduleRefused(e)) refreshModulesAfterRefusal(); // stale priority chips go away
      refreshOutbox(o.convoId);
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Message not sent", msg: o.reason.text.replace(/^Not sent — /, "") }; return s; });
      return { ok: false, reason: o.reason };
    });
  }
  function findOutbox(localId) { return outbox.find(function (o) { return o.localId === localId; }) || null; }
  // Retry a failed message as-is, or (when only its priority was refused) as routine.
  DT.actions.retryMessage = function (localId, opts) {
    var o = findOutbox(localId);
    if (!o || o.status === "sending") return Promise.resolve({ ok: false });
    if (opts && opts.asRoutine) o.priority = "routine";
    o.at = Date.now();
    return postOutbox(o);
  };
  // Take a failed message back into the composer (Edit): returns its draft and
  // removes the "Not sent" bubble.
  DT.actions.takeFailedMessage = function (localId) {
    var o = findOutbox(localId);
    if (!o || o.status !== "failed") return null;
    outbox = outbox.filter(function (x) { return x !== o; });
    refreshOutbox(o.convoId);
    return { text: o.text, priority: o.priority, attachments: o.attachments.slice() };
  };
  // Nothing unsent (and no per-session message bookkeeping) outlives the
  // session that wrote it.
  var outboxSession = null;
  if (DT.subscribe) DT.subscribe(function () {
    var sess = DT.getState().session || null;
    if (sess === outboxSession) return;
    outboxSession = sess;
    outbox = []; readPosted = {}; recalled = {}; pageInflight = {};
    syncCursor = null; syncEpoch = -1;
    Object.keys(threadTimers).forEach(function (k) { clearTimeout(threadTimers[k]); delete threadTimers[k]; });
    if (listSyncTimer) { clearTimeout(listSyncTimer); listSyncTimer = null; }
    // An unconsumed "open this thread" request belongs to the previous identity.
    if (DT.getState().__openThread != null) DT.set(function (s) { s.__openThread = null; return s; });
  });

  // ---- live WebSocket ------------------------------------------------------
  // Cookie-authenticated socket at /ws. Message frames are applied directly
  // (applyIncoming / applyAck / applyRead / applyRecall); assignment, board and
  // broadcast events refresh the role's data, so a second device updates live.
  //
  // Connection lifecycle (A.CON-SHO-67):
  //   - "connected" means the server's CONNECTION_ESTABLISHED, not onopen: the
  //     server accepts the upgrade and only then closes an unauthenticated
  //     socket with 1008.
  //   - 1008 "session_revoked" (password changed / reset elsewhere) → the
  //     session is dead: sign-in, via expireSession.
  //   - any other 1008 → ask the server (GET /api/user): 401 → sign-in;
  //     still signed in (the realtime channel, not the session, is refusing —
  //     e.g. a proxy dropping the cookie on upgrade) → back off, never sign a
  //     working session out, and after three refusals stop retrying until the
  //     network/app comes back.
  //   - other closes → exponential backoff with jitter, capped at 30 s, and an
  //     immediate retry on `online` / the app returning to the foreground.
  //   - a re-established socket resyncs what was missed while it was down.
  var typingExpiry = {}; // convoId -> timeout clearing a lost typing_stop
  var WS_BACKOFF_CAP_MS = 30000;
  var WS_REFUSALS_BEFORE_PAUSE = 3;
  var wsEpoch = -1;            // authEpoch the counters below belong to
  var wsAttempt = 0;           // consecutive closes without an established socket
  var wsRefusals = 0;          // consecutive 1008 closes
  var wsPaused = false;        // refused repeatedly while HTTP says signed in
  var wsEstablishedOnce = false;
  var wsTimer = null;
  function wsWanted() {
    return !!DT.getState().session && !sessionExpiring && !lockActive() && typeof WebSocket !== "undefined" && typeof location !== "undefined";
  }
  function scheduleReconnect() {
    if (wsTimer || wsPaused || !wsWanted()) return;
    var ceiling = Math.min(WS_BACKOFF_CAP_MS, 1000 * Math.pow(2, wsAttempt));
    var delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2)); // jitter
    wsAttempt++;
    wsTimer = setTimeout(function () { wsTimer = null; if (!ws && wsWanted()) connectWs(); }, delay);
  }
  // The network or the app came back: retry now (and probe again if paused).
  function reconnectNow() {
    if (ws || !wsWanted()) return;
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
    wsPaused = false; wsRefusals = 0; wsAttempt = 0;
    connectWs();
  }
  try {
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") reconnectNow(); });
  } catch (e) {}
  // The server refused the socket (1008).
  function onWsRefused(reason, epoch) {
    wsRefusals++;
    if (DEMO_TOKEN) return scheduleReconnect(); // token panes have no sign-in to return to
    if (reason === "session_revoked") return expireSession("revoked");
    rawApi("GET", "/api/user").then(function () {
      if (epoch !== authEpoch) return;
      if (wsRefusals >= WS_REFUSALS_BEFORE_PAUSE) { wsPaused = true; return; }
      scheduleReconnect();
    }, function (e) {
      if (epoch !== authEpoch) return;
      if (e && e.status === 401 && DT.getState().session) return expireSession();
      scheduleReconnect();
    });
  }
  function connectWs() {
    try { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; } } catch (e) {}
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
    if (wsEpoch !== authEpoch) { wsEpoch = authEpoch; wsAttempt = 0; wsRefusals = 0; wsPaused = false; wsEstablishedOnce = false; }
    if (typeof WebSocket === "undefined" || typeof location === "undefined") return;
    if (lockActive()) return; // a locked session gets no realtime feed (A.CON-SHO-7)
    var epoch = authEpoch;
    try {
      var proto = location.protocol === "https:" ? "wss:" : "ws:";
      var wsUrl = proto + "//" + location.host + "/ws" + (DEMO_TOKEN ? ("?token=" + encodeURIComponent(DEMO_TOKEN)) : "");
      var sock = new WebSocket(wsUrl);
      ws = sock;
      sock.onmessage = function (e) {
        if (epoch !== authEpoch) return;
        // Locked: no event may re-hydrate, resync or fetch anything — those
        // requests would renew the session and pull data into a locked tab.
        if (lockActive()) { dropSocket(); return; }
        var ev; try { ev = JSON.parse(e.data); } catch (_) { return; }
        if (!ev || !ev.type) return;
        if (ev.type === "CONNECTION_ESTABLISHED") {
          wsAttempt = 0; wsRefusals = 0; wsPaused = false;
          // Whatever was sent/read/recalled while no socket was listening is
          // not replayed by the server: ask for it once (A.CON-SHO-65) — one
          // PHI-free request when nothing changed. Before the first list
          // there is nothing to compare against (that list is fresh).
          if (convosLiveEpoch === authEpoch) runSync();
          if (wsEstablishedOnce) { rehydrate(); hydrateBroadcasts(); }
          wsEstablishedOnce = true;
        }
        else if (ev.type === "MESSAGE_RECEIVED") applyIncoming(ev.message);
        // A STAT/urgent message was acknowledged — patch that recipient's row.
        else if (ev.type === "MESSAGE_ACK" && ev.messageId != null) applyAck(ev);
        else if (ev.type === "MESSAGE_RECALLED" && ev.messageId != null) applyRecall(ev);
        // The STAT sweep re-alerted a recipient (sent to them and the sender).
        else if (ev.type === "STAT_REALERT" && ev.messageId != null) applyRealert(ev);
        // Someone read messages in a thread I'm in (A.CON-SHO-26).
        else if (ev.type === "MESSAGE_READ" && Array.isArray(ev.messageIds)) applyRead(ev);
        // Real typing indicator: a peer relayed typing_start/stop through the
        // server (see server/ws). Flip the convo's flag, with a 5s safety expiry
        // in case the stop event is lost.
        else if (ev.type === "user_typing" && ev.conversationId != null) {
          var setTypingFlag = function (on) {
            DT.set(function (s) {
              s.conversations = (s.conversations || []).map(function (c) {
                return c.id === ev.conversationId ? Object.assign({}, c, { typing: !!on }) : c;
              });
              return s;
            });
          };
          setTypingFlag(ev.typing);
          clearTimeout(typingExpiry[ev.conversationId]);
          if (ev.typing) typingExpiry[ev.conversationId] = setTimeout(function () { setTypingFlag(false); }, 5000);
        }
        // Server-emitted event names (see server/services + routes): consult and
        // care-team changes also re-hydrate so boards/rosters stay live.
        else if (ev.type === "ASSIGNMENT_CREATED" || ev.type === "ASSIGNMENT_UPDATED" || ev.type === "CONSULT_UPDATED" || ev.type === "CARE_TEAM_UPDATED") rehydrate();
        else if (ev.type === "BROADCAST_CREATED" && ev.broadcast) {
          // Surface an incoming org-wide broadcast live: insert it (with its
          // real ack requirement) so the banner + card show an Acknowledge
          // button immediately, then re-hydrate from the server for the
          // authoritative list (sender name, tallies).
          var b = ev.broadcast;
          DT.set(function (s) {
            if (!(s.broadcasts || []).some(function (x) { return x.id === b.id; })) {
              s.broadcasts = [mapBroadcast(b)].concat(s.broadcasts || []);
            }
            // A broadcast that needs my acknowledgement is announced by the
            // pinned banner (with its Acknowledge button); raising a toast for
            // it as well put a second, tap-swallowing copy over that very
            // button (A.CON-SHO-2). Only broadcasts with no banner get a toast.
            var bannered = mapBroadcast(b).ackReq && (!DT.moduleOn || DT.moduleOn("broadcasts"));
            if (b.senderId !== meId && !bannered) s.__toast = { tone: "rejected", title: "Broadcast — " + (b.severity || "info"), msg: b.message };
            return s;
          });
          hydrateBroadcasts();
        }
        // Someone acknowledged a broadcast — update that card's tally live
        // (director) and, if it was me on another device, my own ack state.
        else if (ev.type === "BROADCAST_ACKED" && ev.broadcastId != null) {
          DT.set(function (s) {
            s.broadcasts = (s.broadcasts || []).map(function (x) {
              if (x.id !== ev.broadcastId) return x;
              var patch = { acked: typeof ev.ackCount === "number" ? ev.ackCount : x.acked, total: typeof ev.total === "number" ? ev.total : x.total };
              if (ev.userId === meId) patch.ackedByMe = true;
              if (ev.displayName && ev.userId !== meId) patch.ackedBy = (x.ackedBy || []).filter(function (p) { return p.userId !== ev.userId; }).concat([{ userId: ev.userId, displayName: ev.displayName }]);
              return Object.assign({}, x, patch);
            });
            return s;
          });
        }
      };
      sock.onclose = function (e) {
        if (ws === sock) ws = null;
        // The server locked this session (here or in another tab): show the
        // lock screen and do NOT reconnect (A.CON-SHO-7).
        if (e && e.code === 4423) { if (epoch === authEpoch) engageLock(); return; }
        if (epoch !== authEpoch || !wsWanted()) return; // signed out / identity changed
        if (e && e.code === 1008) return onWsRefused(String(e.reason || ""), epoch);
        scheduleReconnect();
      };
      sock.onerror = function () { try { sock.close(); } catch (e) {} };
    } catch (e) { scheduleReconnect(); /* WS unavailable now — retry with backoff */ }
  }

  // Developer: hydrate real organizations into the kit's org shape.
  function hydrateOrgs() {
    return get("/api/dev/organizations").then(function (orgs) {
      var tenants = (orgs || []).filter(function (o) {
        return String(o.code).toUpperCase() !== PLATFORM_ORG; // platform org isn't a tenant
      }).map(function (o) {
        return {
          id: o.id, code: o.code, name: o.name,
          city: o.city, state: o.state, timezone: o.timezone,
          users: o.userCount || 0, assignments: 0, active: true,
        };
      });
      DT.set(function (s) {
        s.orgs = tenants;
        if (s.orgs.length && !s.orgs.some(function (o) { return o.code === s.selectedOrg; })) {
          s.selectedOrg = s.orgs[0].code;
        }
        return s;
      });
      // Pull each tenant's individualized rule settings into orgConfigs so the
      // developer's per-org page reflects real backend state (overrides vs
      // inherited enterprise defaults).
      return Promise.all(tenants.map(function (o) {
        return get("/api/dev/organizations/" + o.id + "/settings")
          .then(function (d) { return { code: o.code, d: d }; })
          .catch(function () { return null; });
      })).then(function (rows) {
        DT.set(function (s) {
          var ent = (s.enterprise || {}).rules || {};
          var cfgs = Object.assign({}, s.orgConfigs);
          (rows || []).filter(Boolean).forEach(function (row) {
            var d = row.d || {}, org = d.org || {}, setg = d.settings || {};
            var rules = {};
            // Only record values that genuinely differ from the enterprise
            // default — so unchanged tenants show "Inherited", not "Custom".
            if (typeof org.assignmentTimeoutMin === "number" && org.assignmentTimeoutMin !== ent.timeout) rules.timeout = org.assignmentTimeoutMin;
            if (org.rotationMode && org.rotationMode !== ent.rotationMode) rules.rotationMode = org.rotationMode;
            if (setg.autoReassignOnDecline === true || setg.autoReassignOnDecline === false) rules.autoReassign = !!setg.autoReassignOnDecline;
            if (typeof setg.autoCleanHours === "number") rules.autoCleanHours = setg.autoCleanHours;
            var c = Object.assign({}, cfgs[row.code]); c.rules = Object.assign({}, c.rules, rules); cfgs[row.code] = c;
          });
          s.orgConfigs = cfgs;
          return s;
        });
      });
    }).catch(function () {});
  }
  function orgIdForCode(code) {
    var o = (DT.getState().orgs || []).find(function (x) { return x.code === code; });
    return o ? o.id : null;
  }
  // Persist the real per-org rule fields to the backend (others stay local).
  var origSetOrgRule = DT.actions.setOrgRule;
  DT.actions.setOrgRule = function (code, key, val) {
    var id = orgIdForCode(code);
    if (id != null) {
      if (key === "timeout") api("PATCH", "/api/dev/organizations/" + id, { assignmentTimeoutMin: Number(val) || 15 }).catch(function () {});
      else if (key === "rotationMode") api("PATCH", "/api/dev/organizations/" + id, { rotationMode: val }).catch(function () {});
      else if (key === "autoReassign") api("PATCH", "/api/dev/organizations/" + id + "/settings", { key: "autoReassignOnDecline", value: !!val }).catch(function () {});
      else if (key === "autoCleanHours") api("PATCH", "/api/dev/organizations/" + id + "/settings", { key: "autoCleanHours", value: Number(val) || 0 }).catch(function () {});
    }
    if (origSetOrgRule) return origSetOrgRule(code, key, val);
  };
  var origResetOrgRule = DT.actions.resetOrgRule;
  DT.actions.resetOrgRule = function (code, key) {
    var id = orgIdForCode(code);
    var ent = (DT.getState().enterprise || {}).rules || {};
    if (id != null) {
      if (key === "timeout") api("PATCH", "/api/dev/organizations/" + id, { assignmentTimeoutMin: Number(ent.timeout) || 15 }).catch(function () {});
      else if (key === "rotationMode") api("PATCH", "/api/dev/organizations/" + id, { rotationMode: ent.rotationMode || "lowest_census" }).catch(function () {});
      else if (key === "autoReassign") api("PATCH", "/api/dev/organizations/" + id + "/settings", { key: "autoReassignOnDecline", value: null }).catch(function () {});
      else if (key === "autoCleanHours") api("PATCH", "/api/dev/organizations/" + id + "/settings", { key: "autoCleanHours", value: null }).catch(function () {});
    }
    if (origResetOrgRule) return origResetOrgRule(code, key);
  };

  // ---- action overrides ----------------------------------------------------
  // Real authentication for both first login and the topbar role switcher, so
  // the SERVER session always matches the role shown in the UI (otherwise dev
  // endpoints 403 and CRUD operates on demo data with no real ids).
  // The canonical demo org for a role — used as a fallback if the org code on
  // the login form is wrong/stale (e.g. a cached old "MERCY").
  function canonicalOrg(role) { return role === "developer" ? PLATFORM_ORG : "ISPN"; }

  // Everything that runs once a session is established and allowed to work:
  // the live socket plus every per-role hydrate. Split out of doLogin so the
  // MFA enrolment screen can run it AFTER enrolment lifts the server's block
  // (until then every one of these calls would just 403).
  function bootSession(u) {
    connectWs();
    if (u.role === "developer") { hydrateOrgs(); hydrateDevUsers(); }
    hydrateMyPrefs();
    ensurePushSubscription(); // never prompts — see DT.actions.enablePush
    if (PRIVILEGED[u.role]) hydrateOpsReport();
    hydrateBroadcasts(); // catch up on broadcasts sent while this device was offline
    hydrateAwayMessage();
    return hydrate(u.role).then(function (r) { hydrateConversations(); return r; });
  }

  // Sign in with EXACTLY the credentials the user typed. No demo-account
  // substitution, no org rewriting, no fallback retry with other credentials:
  // the server decides, and the session's role comes from /api/user, never
  // from the role picker (which, in synthetic mode, only pre-fills the form —
  // see LoginScreen.jsx / DT.demoAccount).
  function doLogin(role, org, user, pass) {
    var orgCode = String(org || "").trim();
    var username = String(user || "").trim();
    var password = String(pass || "");
    if (!orgCode || !username || !password) {
      var ve = new Error("validation_error"); ve.status = 400;
      return Promise.reject(ve);
    }

    function finish(u) {
      // A successful sign-in IS the unlock (the server regenerated the
      // session): clear the lock flag before anything is fetched.
      try { if (window.__dtLock) window.__dtLock.clear(); } catch (e) {}
      sessionConfirmed = true;
      localDemoSession = false;
      lastAuth = { org: orgCode, username: u.username };
      newAuthEpoch();
      var switched = adoptIdentity(u.id);
      auditLoaded = false; // new login context → reload that org's audit on first hydrate
      prefsLoaded = false;
      dashHydrated = false; lastDashSnap = null; // pause layout-save until the new user's layout hydrates
      DT.set(function (s) {
        dropPreviousThreads(s, switched);
        s.session = { role: u.role, org: orgCode, user: u.username, name: u.displayName };
        s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
        s.ui.nav = "dashboard";
        s.ui.notifOpen = false;
        s.loginError = null;
        s.mfaChallenge = null;
        // Privileged role in an org that requires MFA, not enrolled yet: the
        // login succeeded but the server 403s everything except enrolment.
        s.mfaEnrollmentRequired = !!u.mfaEnrollmentRequired;
        s.passwordChangeRequired = !!u.mustChangePassword;
        return s;
      });
      mfaFlagged = !!u.mfaEnrollmentRequired;
      pwChangeFlagged = !!u.mustChangePassword;
      if (u.mfaEnrollmentRequired) return Promise.resolve(u); // held at the enrolment screen; mfaEnrollmentDone() boots the rest
      if (u.mustChangePassword) return Promise.resolve(u);    // held at the change-password screen; passwordChangeDone() boots the rest
      return bootSession(u);
    }
    // Second-factor completion re-enters the same finish() as a plain login.
    pendingMfaFinish = function (u) { return finish(u); };

    // A sign-out still finishing (push cleanup, then POST /api/logout) must land
    // before this sign-in, or it would end the new session.
    return Promise.resolve(logoutPending).then(function () {
      return rawApi("POST", "/api/login", { orgCode: orgCode, username: username, password: password });
    })
      .then(function (r) {
        if (r && r.twoFactorRequired) {
          // Enrolled account: the server holds the login until a second
          // factor arrives (POST /api/2fa/complete-login → finish()).
          DT.set(function (s) { s.mfaChallenge = { org: orgCode, role: role, username: username }; s.session = null; s.loginError = null; return s; });
          return null;
        }
        return get("/api/user").then(function (u) { return finish(u); });
      });
  }

  // Distinguish "backend unreachable" (fetch rejects with a TypeError) from
  // "backend rejected the credentials" (HTTP 4xx → Error from api()). For the
  // former we silently fall back to the demo UI; for the latter we keep the user
  // on the login screen and tell them WHY — almost always a missing demo account
  // (DB seeded before that role existed), fixed by re-running `npm run seed`.
  // The cross-tenant root account `dev` is deliberately NOT provisioned on a
  // hardened deployment (production and/or real-PHI) unless the operator sets a
  // strong PLATFORM_ADMIN_PASSWORD — it can read every tenant, so it must never
  // ship with the well-known demo password. Explain THAT instead of pointing at
  // `npm run seed`, which cannot be run on a hosted instance anyway.
  function devAccountHint() {
    return isLocalHost()
      ? "The developer account is missing. Stop the server, run \"npm run seed\", then start it again."
      : "The developer console is disabled on this deployment. Set PLATFORM_ADMIN_PASSWORD (12+ characters) on the host, redeploy, then sign in manually with org DOCTURN, user \"dev\" and that password.";
  }
  function isLocalHost() {
    try {
      return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    } catch (e) { return false; }
  }

  // POST /api/login (and /api/2fa/complete-login) answer 400 insecure_transport
  // when the session cookie is Secure but the server cannot see the request as
  // HTTPS — the browser would drop the cookie, so no sign-in can work over this
  // connection. That is a transport problem, never a wrong password: say so,
  // and say what to do. Over plain http the fix is the https:// address; over
  // https the TLS proxy is not telling the app (X-Forwarded-Proto/TRUST_PROXY).
  function insecureTransportMessage() {
    var plain = false;
    try { plain = window.location.protocol === "http:"; } catch (e) {}
    return plain
      ? "This server only accepts sign-ins over a secure (HTTPS) connection. Open the https:// address of this site and sign in there, or contact your administrator."
      : "The server could not confirm this connection is secure (HTTPS), so it refused to sign you in. Contact your administrator — the HTTPS proxy setup needs attention.";
  }
  DT.insecureTransportMessage = insecureTransportMessage;

  function isNetworkError(e) {
    // A real fetch transport failure (server down/unreachable). Match by message
    // because `instanceof TypeError` is unreliable across realms.
    return (e && e.name === "TypeError") ||
      /Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|ERR_NETWORK|load failed/i.test(String(e && e.message));
  }

  DT.actions.login = function (role, org, user, pass) {
    // Return the promise so callers that await login wait for hydrate to finish
    // (session + per-org prefs settled) before acting.
    return doLogin(role, org, user, pass).catch(function (e) {
      var synthetic = DT.getState().syntheticData !== false;
      if (isNetworkError(e)) {
        if (synthetic && serverSaidSynthetic) {
          // Synthetic demo only: server down → local demo data so the UI is
          // still explorable. Never on a real-PHI deployment, where a signed-in
          // screen with fabricated patients would be actively dangerous — and
          // the store's flag alone does not prove which deployment this is: it
          // defaults to ON and sign-out purges the snapshot that remembers it,
          // so an installed app relaunched offline would otherwise "sign in"
          // to fabricated data on a real-PHI instance (A.CON-MIN-9).
          origLogin(role, org, user);
          localDemoSession = true;
          DT.set(function (s) { s.__toast = { tone: "rejected", title: "Offline — demo mode", msg: "Backend unreachable; showing demo data." }; return s; });
          return;
        }
        DT.set(function (s) {
          s.loginError = "Can't reach the server. Check your connection and try again.";
          s.__toast = { tone: "rejected", title: "Sign-in failed", msg: "Server unreachable." };
          return s;
        });
        return;
      }
      // Server reachable but rejected the attempt. One generic message for bad
      // org/user/password — the server deliberately doesn't say which.
      var why = String((e && e.message) || "");
      var msg = why === "validation_error" ? "Enter your organization code, username and password."
        : why === "insecure_transport" ? insecureTransportMessage()
        : e && e.status === 429 ? "Too many sign-in attempts. Wait a few minutes and try again."
        : "Wrong organization code, username or password.";
      if (role === "developer" && synthetic && why !== "insecure_transport") msg += " " + devAccountHint();
      DT.set(function (s) {
        s.loginError = "Sign-in failed: " + msg;
        s.__toast = { tone: "rejected", title: "Sign-in failed", msg: msg };
        return s;
      });
      console.error("[DocTurn] login failed:", e);
    });
  };

  // The role switcher must re-authenticate as that role's demo account, not just
  // flip the local role (which would leave the server session unchanged).
  var origSetRole = DT.actions.setRole;
  DT.actions.setRole = function (role) {
    var st = DT.getState();
    // Switching roles means signing in as that role's DEMO account — a
    // synthetic-data convenience only. On a real-PHI deployment there are no
    // demo accounts and this control is not rendered; refuse defensively.
    if (st.syntheticData === false) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Not available", msg: "Role switching is a demo-only feature. Sign out and sign in as the other account." }; return s; });
      return;
    }
    if (st.impersonating) DT.set(function (s) { s.impersonating = null; return s; }); // leaving the impersonated portal
    var demo = DT.demoAccount(role);
    doLogin(role, demo.org, demo.user, demo.pass).catch(function (e) {
      if (isNetworkError(e)) {
        // Same rule as sign-in: a local role flip onto demo data only when the
        // server has confirmed, in this page load, that this is a synthetic
        // instance.
        if (serverSaidSynthetic && origSetRole) { origSetRole(role); localDemoSession = true; return; }
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not switch role", msg: "No connection — nothing was changed." }; return s; });
        return;
      }
      var msg = role === "developer" ? devAccountHint()
        : "That role's demo account isn't available on this deployment.";
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not switch role", msg: msg }; return s; });
      console.error("[DocTurn] setRole failed:", e);
    });
  };

  // Accept / decline: the row leaves Incoming at once, but "accepted" /
  // "declined" is only announced once the server agrees. A refusal puts the
  // row back and says why; a dead session goes to sign-in (api() → 401 →
  // expireSession) instead of a success toast (A.CON-SHO-67).
  function assignmentRefused(e, verb) {
    if (e && e.status === 401) return; // expireSession already took the user to sign-in
    var m = String((e && e.message) || "");
    var why = isNetworkError(e) ? "No connection — nothing was changed."
      : (e && (e.status === 403 || e.status === 404 || e.status === 409)) || /pending|already|expired/i.test(m) ? "It is no longer waiting for you (taken, expired or re-routed)."
      : "The server refused it.";
    DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't " + verb + " the assignment", msg: why }; return s; });
    rehydrate();
  }
  DT.actions.accept = function (id) {
    DT.set(function (s) {
      var p = (s.pending || []).find(function (x) { return x.id === id; });
      if (p) s.myAdmissions = [{ id: "ma" + id, at: Date.now(), patientId: p.patientId, initials: p.initials, room: p.room, complaint: p.complaint, consultants: [] }].concat(s.myAdmissions || []);
      s.pending = (s.pending || []).filter(function (x) { return x.id !== id; }); // drop from Incoming immediately
      return s;
    });
    return api("PATCH", "/api/assignments/" + id + "/accept").then(function () {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Assignment accepted", msg: "Added to your census." }; return s; });
      return rehydrate();
    }).catch(function (e) { assignmentRefused(e, "accept"); });
  };
  // Request a consult on a patient — available to hospitalists, directors and ER
  // (the backend allows all of them). Optimistically tags the patient everywhere
  // they appear, then re-hydrates from the server.
  DT.actions.requestConsult = function (patientId, specialty) {
    if (patientId == null || !specialty) return;
    var pid = bid(patientId);
    // Pull the named team off this org's consult-service roster (on-call + members)
    // so the consult records WHO was called by name, not just the specialty.
    var svc = (DT.getState().consultServices || []).find(function (x) { return x.name === specialty; });
    var numId = function (v) { return typeof v === "number" && v > 0 ? v : undefined; };
    var team = [];
    if (svc) {
      if (svc.onCall && svc.onCall.name) team.push({ name: svc.onCall.name, userId: numId(svc.onCall.userId) });
      (svc.members || []).forEach(function (m) { if (m && m.name) team.push({ name: m.name, userId: numId(m.userId) }); });
    }
    var body = team.length ? { specialty: specialty, consultants: team } : { specialty: specialty };
    api("POST", "/api/patients/" + pid + "/consults", body).then(rehydrate).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't request consult", msg: String((e && e.message) || "Try again.") }; return s; });
    });
    DT.set(function (s) {
      var add = function (list) {
        return (list || []).map(function (row) {
          if (row.patientId === patientId && (row.consultants || []).indexOf(specialty) < 0) {
            return Object.assign({}, row, { consultants: (row.consultants || []).concat([specialty]) });
          }
          return row;
        });
      };
      s.board = add(s.board); s.myAdmissions = add(s.myAdmissions); s.myPatients = add(s.myPatients); s.sent = add(s.sent);
      s.__toast = { tone: "sent", title: specialty + " consult requested", msg: "The consult service has been notified." };
      return s;
    });
  };
  // A consultant accepts/declines a consult request (status: accepted|declined).
  // Optimistically flips the matching consultDetails row, then re-hydrates.
  DT.actions.respondConsult = function (consultId, status) {
    if (consultId == null) return;
    api("PATCH", "/api/consults/" + consultId, { status: status }).then(rehydrate).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't update consult", msg: String((e && e.message) || "Try again.") }; return s; });
    });
    DT.set(function (s) {
      var flip = function (list) {
        return (list || []).map(function (row) {
          if (!row.consultDetails) return row;
          var cd = row.consultDetails.map(function (c) { return c.id === consultId ? Object.assign({}, c, { status: status }) : c; });
          return Object.assign({}, row, { consultDetails: cd });
        });
      };
      s.board = flip(s.board);
      s.__toast = { tone: status === "accepted" ? "accepted" : "rejected", title: status === "accepted" ? "Consult accepted" : "Consult declined", msg: "" };
      return s;
    });
  };
  // Self-service password change. Returns a promise so the UI can await + report.
  // Per-user dashboard customization (panel layout + stat-tile layout + custom
  // stats) is synced to the server so the same login shows the same layout on
  // every device. localStorage stays the instant/offline copy; the server is
  // the cross-device source that fills a fresh browser on login.
  //   - dashHydrated gates the saver so the initial server-hydrate never echoes
  //     straight back as a write.
  //   - lastDashSnap is a serialized snapshot; the saver skips when unchanged,
  //     so an unrelated store mutation (a message, the clock) never PATCHes.
  var dashHydrated = false;
  var lastDashSnap = null;
  function dashSnapshot(s) {
    return JSON.stringify({
      dashLayout: s.dashLayout || {},
      statLayout: s.statLayout || {},
      customStats: s.customStats || {},
    });
  }
  var dashSaveTimer = null;
  function scheduleDashSave() {
    if (!dashHydrated) return; // don't save until the server layout has hydrated
    var snap = dashSnapshot(DT.getState());
    if (snap === lastDashSnap) return; // nothing changed since last save/hydrate
    if (dashSaveTimer) return; // a save is already queued
    dashSaveTimer = setTimeout(function () {
      dashSaveTimer = null;
      var st = DT.getState();
      var cur = dashSnapshot(st);
      if (cur === lastDashSnap) return; // coalesced away
      lastDashSnap = cur;
      api("PATCH", "/api/settings/me", {
        key: "dashboardLayout",
        value: { dashLayout: st.dashLayout || {}, statLayout: st.statLayout || {}, customStats: st.customStats || {} },
      }).catch(function () { /* offline: localStorage remains the fallback */ });
    }, 400);
  }
  if (DT.subscribe) DT.subscribe(scheduleDashSave);

  // Personal availability prefs (DND + covering provider). Server-backed via
  // /api/settings (read) and /api/settings/me (write). Also hydrates the
  // cross-device dashboard layout.
  function hydrateMyPrefs() {
    get("/api/settings").then(function (r) {
      if (!r) return;
      DT.set(function (s) {
        if (r.me) s.myPrefs = { dnd: !!r.me.dnd, coveringUserId: r.me.coveringUserId != null ? r.me.coveringUserId : null };
        if (r.org && typeof r.org.messageRetentionDays === "number") s.orgRetentionDays = r.org.messageRetentionDays;
        // The STAT sweep's real schedule, for the unacknowledged-STAT
        // countdown (A.CON-MIN-18). Absent → no countdown is shown.
        s.statTimings = r.org && r.org.statRealertMs > 0 && r.org.statEscalateMs > 0
          ? { realertMs: r.org.statRealertMs, escalateMs: r.org.statEscalateMs } : null;
        var dl = r.me && r.me.dashboardLayout;
        if (dl && typeof dl === "object") {
          s.dashLayout = dl.dashLayout || {};
          s.statLayout = dl.statLayout || {};
          s.customStats = dl.customStats || {};
        }
        return s;
      });
      // Mark hydrated AFTER the set (the set's emit ran with dashHydrated still
      // false, so it scheduled no save) and snapshot the now-current layout so
      // the very first real user change is what triggers the first PATCH.
      dashHydrated = true;
      lastDashSnap = dashSnapshot(DT.getState());
    }).catch(function () {});
  }
  // ---- Web Push (A.CON-SHO-62, A.CON-NEE-1, A.CON-SHO-68) -------------------
  // Subscribes this browser/PWA so STAT + new-message wake-ups reach a closed
  // phone (content-free payloads; the SW shows a generic title).
  //   - Permission is requested ONLY from an explicit tap (Settings → Turn on,
  //     DT.actions.enablePush). WebKit ignores/denies a prompt outside a user
  //     gesture, and an unprompted dialog after sign-in is easy to dismiss into
  //     a permanent block. Sign-in / reload never prompt.
  //   - When permission was already granted, sign-in silently (re)registers
  //     this device's subscription with the account that is signed in now.
  //   - Sign-out removes it from the server and unsubscribes the device.
  function urlB64ToUint8Array(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function isIosDevice() {
    try {
      var ua = navigator.userAgent || "";
      return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }
  function isStandalone() {
    try { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; } catch (e) { return false; }
  }
  function pushApisPresent() {
    try { return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; } catch (e) { return false; }
  }
  // What the Settings row should say for THIS device:
  //   "granted" | "default" | "denied" — the browser's permission;
  //   "ios-home-screen" — iPhone/iPad Safari tab: Web Push exists only for an
  //                       app added to the Home Screen (iOS 16.4+);
  //   "ios-update"      — Home Screen app on an iOS older than 16.4;
  //   "unsupported"     — no Web Push in this browser.
  DT.pushStatus = function () {
    if (!pushApisPresent()) return !isIosDevice() ? "unsupported" : isStandalone() ? "ios-update" : "ios-home-screen";
    try { return Notification.permission || "default"; } catch (e) { return "unsupported"; }
  };
  // This page's service-worker registration. `waitForReady` also waits for a
  // registration still being installed (subscribing needs one); sign-out does
  // not — no registration means no subscription to remove.
  function swRegistration(ms, waitForReady) {
    var sw = navigator.serviceWorker;
    return withTimeout(sw.getRegistration ? sw.getRegistration() : sw.ready, ms)
      .then(function (reg) { return reg || (waitForReady ? withTimeout(sw.ready, ms) : null); });
  }
  // Create (or reuse) this device's subscription and register it with the
  // signed-in account. Only ever called with permission already granted.
  function subscribePush() {
    return Promise.all([swRegistration(10000, true), api("GET", "/api/push/vapid-key")]).then(function (r) {
      var reg = r[0], key = r[1] && r[1].key;
      if (!reg || !reg.pushManager || !key) throw new Error("push_unavailable");
      return reg.pushManager.getSubscription().then(function (existing) {
        return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      });
    }).then(function (sub) {
      if (!sub) throw new Error("push_unavailable");
      return api("POST", "/api/mobile/device-tokens", { token: JSON.stringify(sub), platform: "webpush" });
    });
  }
  // Automatic path (sign-in, reload): no prompt, ever.
  function ensurePushSubscription() {
    try {
      if (!pushApisPresent() || Notification.permission !== "granted") return;
      subscribePush().catch(function () { /* push is optional */ });
    } catch (e) { /* older browsers */ }
  }
  // Gesture path: call straight from the click handler — requestPermission must
  // be the first thing that happens (no await before it) for WebKit to accept
  // it. Resolves to the resulting DT.pushStatus() (or "error").
  DT.actions.enablePush = function () {
    if (!pushApisPresent()) return Promise.resolve(DT.pushStatus());
    if (Notification.permission === "denied") return Promise.resolve("denied");
    var asked;
    try {
      asked = new Promise(function (resolve) {
        // Older Safari takes a callback and returns undefined; newer engines
        // return a promise (and may also call the callback).
        var r = Notification.requestPermission(function (p) { resolve(p); });
        if (r && typeof r.then === "function") r.then(resolve, function () { resolve(Notification.permission); });
      });
    } catch (e) { return Promise.resolve("error"); }
    return asked.then(function (perm) {
      if ((perm || Notification.permission) !== "granted") return DT.pushStatus();
      return subscribePush().then(function () { return "granted"; }, function () { return "error"; });
    });
  };
  // Sign-out: remove this device's subscription from the server (while the
  // session still exists) and unsubscribe it, so the signed-out clinician's
  // wake-ups stop reaching this device (A.CON-SHO-68). Resolves either way.
  function unsubscribePushForLogout() {
    if (!pushApisPresent()) return Promise.resolve();
    return swRegistration(2000, false).then(function (reg) {
      return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) {
      if (!sub) return;
      var token = JSON.stringify(sub);
      return withTimeout(rawApi("DELETE", "/api/mobile/device-tokens/" + encodeURIComponent(token)), 3000)
        .catch(function () { /* offline: the unsubscribe below still kills the endpoint (push service answers 410, the server prunes it) */ })
        .then(function () { return sub.unsubscribe(); });
    }).catch(function () {});
  }
  // Director ops report (assignments latency, consult response, message volume).
  function hydrateOpsReport() {
    get("/api/reports/ops").then(function (r) {
      if (r) DT.set(function (s) { s.opsReport = r; return s; });
    }).catch(function () {});
  }
  DT.actions.setOrgRetention = function (days) {
    var prev = DT.getState().orgRetentionDays;
    DT.set(function (s) { s.orgRetentionDays = days; return s; });
    return api("PATCH", "/api/settings/org", { key: "messageRetentionDays", value: Number(days) || 0 })
      .then(function () { DT.set(function (s) { s.__toast = { tone: "accepted", title: "Retention updated", msg: Number(days) > 0 ? "Messages auto-delete after " + days + " days." : "Messages are kept indefinitely." }; return s; }); })
      .catch(function (e) {
        // Refused: show the window the server is still applying.
        DT.set(function (s) { s.orgRetentionDays = prev; s.__toast = { tone: "rejected", title: "Not saved", msg: e && e.status === 403 ? "Only a director can change this." : "Couldn't update retention." }; return s; });
      });
  };
  DT.actions.setMyPref = function (key, value) {
    DT.set(function (s) { var p = Object.assign({}, s.myPrefs); p[key] = value; s.myPrefs = p; return s; });
    return api("PATCH", "/api/settings/me", { key: key, value: value }).catch(function () {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Setting not saved", msg: "Couldn\u2019t reach the server." }; return s; });
    });
  };
  // Forced change complete: lift the hold and boot the session the same way a
  // plain login would (the user was parked on the change-password screen).
  DT.actions.passwordChangeDone = function () {
    pwChangeFlagged = false;
    return get("/api/user").then(function (u) {
      DT.set(function (s) { s.passwordChangeRequired = !!u.mustChangePassword; return s; });
      if (u.mustChangePassword) return u; // server still says no — stay parked
      return bootSession(u);
    });
  };
  DT.actions.changePassword = function (currentPassword, newPassword) {
    return api("PATCH", "/api/account/password", { currentPassword: currentPassword, newPassword: newPassword })
      .then(function () {
        DT.set(function (s) { s.__toast = { tone: "accepted", title: "Password updated", msg: "Use your new password next time you sign in." }; return s; });
        return { ok: true };
      })
      .catch(function (e) {
        var m = String((e && e.message) || "");
        var msg = /weak/.test(m) ? "Use at least 8 characters." : /wrong/.test(m) ? "Current password is incorrect." : "Couldn't update password.";
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Password not changed", msg: msg }; return s; });
        return { ok: false, error: msg };
      });
  };
  DT.actions.decline = function (id) {
    DT.set(function (s) {
      s.pending = (s.pending || []).filter(function (x) { return x.id !== id; }); // drop from Incoming immediately
      return s;
    });
    return api("PATCH", "/api/assignments/" + id + "/reject").then(function () {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Declined — re-routing", msg: "Sent to the next provider." }; return s; });
      return rehydrate();
    }).catch(function (e) { assignmentRefused(e, "decline"); });
  };

  // ER re-routes a patient they sent to a different hospitalist. Hits the real
  // backend so the new provider actually receives it (and the ER board updates).
  DT.actions.reassignSent = function (sentId, providerName) {
    var st = DT.getState();
    var item = (st.sent || []).find(function (x) { return x.id === sentId; });
    var prov = (st.providers || []).find(function (p) { return p.name === providerName; });
    if (!item || item.backendId == null || !prov) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't re-route", msg: "This patient has no active assignment to move." }; return s; });
      return;
    }
    api("PATCH", "/api/assignments/" + item.backendId + "/reassign", { hospitalistId: bid(prov.id) })
      .then(rehydrate)
      .then(function () { DT.set(function (s) { s.__toast = { tone: "sent", title: "Re-routed to " + providerName, msg: "Sent to their queue." }; return s; }); })
      .catch(function (e) {
        var m = String((e && e.message) || "");
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't re-route", msg: /pending/.test(m) ? "That patient is no longer routing." : (m || "Try again.") }; return s; });
      });
  };

  // Director / ER director re-routes a board patient's pending assignment.
  DT.actions.reassignBoard = function (rowId, providerName) {
    var st = DT.getState();
    var row = (st.board || []).find(function (b) { return b.id === rowId; });
    var prov = (st.providers || []).find(function (p) { return p.name === providerName; });
    if (!row || row.assignmentId == null || !prov) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't reassign", msg: "This patient has no active assignment to reassign." }; return s; });
      return;
    }
    api("PATCH", "/api/assignments/" + row.assignmentId + "/reassign", { hospitalistId: bid(prov.id) })
      .then(rehydrate)
      .then(function () { DT.set(function (s) { s.__toast = { tone: "sent", title: "Reassigned to " + providerName, msg: "They've been notified." }; return s; }); })
      .catch(function (e) {
        var m = String((e && e.message) || "");
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't reassign", msg: /pending/.test(m) ? "That patient is no longer routing." : (m || "Try again.") }; return s; });
      });
  };

  // Persist the director's Settings controls to the server: auto-reassign and
  // the STAT SMS fallback are org settings; the assignment timeout is the
  // org's config (each new assignment's expiry is computed from
  // organizations.assignment_timeout_min, services/assignments.ts).
  // Shift-type names stay a local display aid.
  // The change shows at once, but a refusal (403 for an ER director, a
  // failed save, an out-of-range timeout) puts back the value the SERVER
  // holds and says why — the screen never shows a setting the server is not
  // applying.
  var origSetSetting = DT.actions.setSetting;
  var timeoutTimer = null;
  var lastServerTimeout = null; // the timeout the server last confirmed (hydrate / PATCH)
  var ORG_SETTING_KEYS = { autoReassign: "autoReassignOnDecline", statSmsFallback: "statSmsFallback" };
  DT.actions.setSetting = function (key, value) {
    if (ORG_SETTING_KEYS[key]) {
      var prev = (DT.getState().settings || {})[key];
      api("PATCH", "/api/settings/org", { key: ORG_SETTING_KEYS[key], value: !!value }).catch(function (e) {
        if (origSetSetting) origSetSetting(key, prev);
        DT.set(function (s) {
          s.__toast = { tone: "rejected", title: "Not saved", msg: e && e.status === 403 ? "Only a director can change this." : "Try again." };
          return s;
        });
      });
    }
    if (key === "timeout") {
      // Debounced: typing "15" must not save "1" first.
      if (timeoutTimer) clearTimeout(timeoutTimer);
      var minutes = Number(value);
      var restore = function () { if (lastServerTimeout != null && origSetSetting) origSetSetting("timeout", lastServerTimeout); };
      timeoutTimer = setTimeout(function () {
        timeoutTimer = null;
        if (!(minutes >= 1 && minutes <= 120)) {
          restore();
          DT.set(function (s) { s.__toast = { tone: "rejected", title: "Timeout not saved", msg: "Enter 1–120 minutes." }; return s; });
          return;
        }
        api("PATCH", "/api/org/config", { assignmentTimeoutMin: Math.round(minutes) }).then(function (r) {
          lastServerTimeout = r && typeof r.assignmentTimeoutMin === "number" ? r.assignmentTimeoutMin : Math.round(minutes);
          if (origSetSetting) origSetSetting("timeout", lastServerTimeout);
          DT.set(function (s) { s.__toast = { tone: "accepted", title: "Assignment timeout saved", msg: lastServerTimeout + " minutes" }; return s; });
        }).catch(function (e) {
          restore();
          DT.set(function (s) { s.__toast = { tone: "rejected", title: "Timeout not saved", msg: (e && e.status === 403) || String((e && e.message) || "") === "forbidden" ? "Only a director can change it." : "Try again." }; return s; });
        });
      }, 700);
    }
    if (origSetSetting) return origSetSetting(key, value);
  };

  // Persist per-organization preferences (consult-service catalog + theme) to the
  // tenant's org settings, so each organization keeps its own and edits made
  // while "managing" an org apply only there.
  function persistOrgPrefs(patch) { api("PATCH", "/api/org/preferences", patch).catch(function () {}); }
  ["addConsultService", "renameConsultService", "setConsultOnCall", "addConsultMember", "removeConsultMember", "removeConsultService"].forEach(function (name) {
    var orig = DT.actions[name];
    if (!orig) return;
    DT.actions[name] = function () {
      var r = orig.apply(null, arguments);
      persistOrgPrefs({ consultServices: DT.getState().consultServices || [] });
      return r;
    };
  });
  var origSetTheme = DT.actions.setTheme;
  if (origSetTheme) {
    DT.actions.setTheme = function (patch) {
      var r = origSetTheme(patch);
      persistOrgPrefs({ theme: DT.getState().theme });
      return r;
    };
  }

  // ---- self-registration + director/ER-director approval queue -------------
  // Public: anyone with an org code can request an account (no session needed).
  DT.actions.register = function (data) {
    return rawApi("POST", "/api/register", {
      orgCode: data.orgCode, username: data.username, password: data.password,
      displayName: data.displayName, requestedRole: data.role || "hospitalist",
    });
  };
  function hydrateRegistrations() {
    return get("/api/registrations").then(function (rows) {
      DT.set(function (s) { s.registrations = rows || []; return s; });
    }).catch(function () {});
  }
  DT.actions.refreshRegistrations = hydrateRegistrations;
  DT.actions.approveRegistration = function (id) {
    return api("POST", "/api/registrations/" + id + "/approve").then(function () {
      hydrateRegistrations(); rehydrate();
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Registration approved", msg: "The account is now active." }; return s; });
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't approve", msg: String((e && e.message) || "Try again.") }; return s; });
    });
  };
  DT.actions.denyRegistration = function (id) {
    return api("POST", "/api/registrations/" + id + "/deny").then(function () {
      hydrateRegistrations();
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Registration denied", msg: "The request was removed." }; return s; });
    }).catch(function () {});
  };

  // ---- continuous compliance monitor --------------------------------------
  // Every automated control is recomputed server-side on each call, so the
  // screen always reflects the live system. No client-side caching, and no
  // fallback report: if the call fails the screen says so rather than showing
  // a stale or invented posture.
  DT.actions.loadComplianceStatus = function () {
    return get("/api/compliance/status");
  };
  DT.actions.saveAttestation = function (patch) {
    return api("PATCH", "/api/compliance/attestation", patch).then(function (row) {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Attestation saved", msg: patch.controlId + " → " + patch.status.replace("_", " ") + "." }; return s; });
      return row;
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't save attestation", msg: String((e && e.message) || "Try again.") }; return s; });
      throw e;
    });
  };
  // Policy starter pack: metadata for every manual control that ships with a
  // draft, and the rendered document itself (placeholders filled server-side
  // from the caller's real organization — the client never templates PHI or
  // org identity itself).
  DT.actions.loadPolicyTemplates = function () {
    return get("/api/compliance/policies").then(function (r) {
      return (r && r.policies) || [];
    }).catch(function () { return []; });
  };
  DT.actions.loadPolicy = function (controlId) {
    return get("/api/compliance/policies/" + encodeURIComponent(controlId)).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't open the draft policy", msg: String((e && e.message) || "Try again.") }; return s; });
      throw e;
    });
  };
  DT.actions.exportEvidence = function () {
    return get("/api/compliance/evidence").then(function (pack) {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Evidence pack ready", msg: "Downloading the auditor JSON export." }; return s; });
      return pack;
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't export evidence", msg: String((e && e.message) || "Try again.") }; return s; });
      throw e;
    });
  };

  // Clear old patients/logs (or all). hours=24 by default; 0 = everything.
  // Backend deletes patients + their assignments/consults; local admission log
  // is pruned to match. Also runs automatically every 24h server-side.
  DT.actions.purgeData = function (hours) {
    var h = (hours == null) ? 24 : Number(hours);
    return api("POST", "/api/maintenance/purge", { olderThanHours: h }).then(function (r) {
      DT.set(function (s) {
        if (h <= 0) { s.admissions = []; s.sent = []; }
        else { var cut = Date.now() - h * 3600000; s.admissions = (s.admissions || []).filter(function (a) { return (a.at || 0) >= cut; }); }
        var n = r && r.removed != null ? r.removed : 0;
        s.__toast = { tone: "accepted", title: "Cleared", msg: n + " patient record" + (n === 1 ? "" : "s") + " removed." };
        return s;
      });
      rehydrate();
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't clear", msg: String((e && e.message) || "Try again.") }; return s; });
    });
  };

  // Director opts in to take patients (gets a rotation profile), then hydrates
  // the hospitalist work surface.
  DT.actions.becomeHospitalist = function () {
    return api("POST", "/api/director/become-hospitalist").then(function () {
      DT.set(function (s) { s.isProvider = true; s.__toast = { tone: "accepted", title: "You're taking patients", msg: "You're on shift — admissions can route to you now." }; return s; });
      rehydrate();
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't start", msg: String((e && e.message) || "Try again.") }; return s; });
    });
  };

  // Comms KPIs: fetch the org-scoped, server-computed numbers and push them into
  // state so the dashboard stat tiles show real figures. Leave commsMetrics null
  // on any failure (the tiles fall back to "—"/0).
  DT.actions.loadCommsMetrics = function () {
    // Director-level analytics: the server answers 403 for every other role.
    // Skip the round trip for them and leave commsMetrics null — the tiles
    // show "—" — so the hospitalist dashboard is unaffected by the gate.
    var sess = DT.getState().session || {};
    if (!PRIVILEGED[sess.role]) {
      DT.set(function (s) { if (s.commsMetrics != null) s.commsMetrics = null; return s; });
      return Promise.resolve(null);
    }
    return get("/api/metrics/comms").then(function (m) {
      DT.set(function (s) { s.commsMetrics = m || null; return s; });
    }).catch(function () {
      // 403 (role not allowed) or any other failure: tiles fall back to "—".
      DT.set(function (s) { s.commsMetrics = null; return s; });
    });
  };

  // ---- two-factor authentication -----------------------------------------
  // Enrolment (MfaEnrollScreen) and the sign-in challenge (MfaChallengeScreen)
  // talk to the server's existing TOTP routes. rawApi throughout: none of
  // these may self-heal into a demo re-login.
  var pendingMfaFinish = null; // set by doLogin so complete-login re-enters its finish()
  // First enrolment needs nothing; RE-enrolment of an active authenticator is a
  // step-up: current password + a valid current code, verified by the server.
  DT.actions.mfaBeginEnrollment = function (stepUp) {
    var body = stepUp && stepUp.currentPassword ? { currentPassword: stepUp.currentPassword, code: String(stepUp.code || "") } : {};
    return rawApi("POST", "/api/mfa/enroll", body);
  };
  DT.actions.mfaVerifyEnrollment = function (code) {
    return rawApi("POST", "/api/mfa/verify", { code: String(code || "") });
  };
  DT.actions.mfaDisable = function (currentPassword, code) {
    return rawApi("POST", "/api/mfa/disable", { currentPassword: currentPassword, code: String(code || "") });
  };
  DT.actions.mfaRegenerateBackupCodes = function (currentPassword, code) {
    return rawApi("POST", "/api/mfa/backup-codes/regenerate", { currentPassword: currentPassword, code: String(code || "") });
  };
  // Administrator: clear a locked-out clinician's second factor (audited).
  DT.actions.resetUserMfa = function (id, name) {
    return api("POST", "/api/accounts/" + id + "/reset-mfa").then(function () {
      refreshPeople();
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Two-factor reset", msg: (name || "The user") + " can sign in with their password and enrol again." }; return s; });
    }).catch(function (e) { accountError(e, "reset two-factor"); });
  };
  // After the user has saved their backup codes: confirm with the server that
  // the block is gone (it re-checks the DB), then boot the session normally.
  DT.actions.mfaEnrollmentDone = function () {
    return rawApi("GET", "/api/user").then(function (u) {
      if (!u || u.mfaEnrollmentRequired) throw new Error("mfa_enrollment_required");
      mfaFlagged = false;
      DT.set(function (s) {
        s.mfaEnrollmentRequired = false;
        s.__toast = { tone: "accepted", title: "Two-factor authentication on", msg: "You'll be asked for a code at each sign-in." };
        return s;
      });
      return bootSession(u);
    });
  };
  DT.actions.mfaCompleteLogin = function (code) {
    var ch = DT.getState().mfaChallenge || {};
    return rawApi("POST", "/api/2fa/complete-login", { code: String(code || "") }).then(function (u) {
      if (pendingMfaFinish) return pendingMfaFinish(u);
      // No doLogin closure (e.g. page reloaded mid-challenge): minimal restore.
      DT.set(function (s) { s.mfaChallenge = null; return s; });
      window.location.reload();
      return u;
    });
  };
  DT.actions.mfaRequestSms = function () {
    return rawApi("POST", "/api/2fa/request-sms", {});
  };
  DT.actions.mfaCancelLogin = function () {
    pendingMfaFinish = null;
    DT.set(function (s) { s.mfaChallenge = null; return s; });
  };

  // Logout: tear down the live socket, clear this device's state at once, then
  // end the server session — after this device's Web Push subscription has been
  // removed under that session (A.CON-SHO-68). The server sign-out is never
  // lost: it goes out as soon as the push cleanup settles, after 4 s at the
  // latest, or (keepalive) if the page is closed first. A new sign-in waits for
  // it, so a late logout can never end the NEXT session.
  var origLogout = DT.actions.logout;
  var logoutPending = null;
  function endServerSession() {
    var sent = false, finish = null;
    var done = new Promise(function (resolve) { finish = resolve; });
    function onHide() { send(true); }
    function send(keepalive) {
      if (sent) return;
      sent = true;
      try { window.removeEventListener("pagehide", onHide); } catch (e) {}
      var headers = { "Content-Type": "application/json" };
      if (DEMO_TOKEN) headers["Authorization"] = "Bearer " + DEMO_TOKEN;
      var req;
      try { req = fetch("/api/logout", { method: "POST", credentials: "include", keepalive: !!keepalive, headers: headers, body: "{}" }); }
      catch (e) { req = Promise.resolve(); }
      Promise.resolve(req).catch(function () {}).then(function () { finish(); });
    }
    try { window.addEventListener("pagehide", onHide); } catch (e) {}
    var timer = setTimeout(function () { send(true); }, 4000);
    unsubscribePushForLogout().then(function () { clearTimeout(timer); send(false); });
    return done;
  }
  DT.actions.logout = function () {
    sessionConfirmed = false;
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    try { if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } } catch (e) {}
    newAuthEpoch();
    meId = null; lastAuth = null; localDemoSession = false;
    dashHydrated = false; lastDashSnap = null; // stop cross-device layout saves for the signed-out user
    mfaFlagged = false; pwChangeFlagged = false; pendingMfaFinish = null;
    // UI flags BEFORE the store's logout: it purges the persisted snapshot,
    // and any set() after it would write the allowlist back (A.CON-SHO-63).
    DT.set(function (s) { s.mfaEnrollmentRequired = false; s.mfaChallenge = null; s.passwordChangeRequired = false; return s; });
    if (origLogout) origLogout();
    // A sign-out never leaves the lock's re-auth identity behind either.
    try { if (window.__dtLock) window.__dtLock.clear(); } catch (e) {}
    var p = endServerSession();
    logoutPending = p;
    p.then(function () { if (logoutPending === p) logoutPending = null; });
    return p;
  };

  // ---- messaging overrides (backend-backed, cross-device) ------------------
  var origStartConversation = DT.actions.startConversation;
  // Called by the thread view while a conversation is ON SCREEN (visible pane,
  // foreground tab) — including when new messages land in it — so the sender's
  // receipt means "seen". Each message id is posted once per session.
  var readPosted = {};
  function recountUnread(id) {
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        if (c.id !== id) return c;
        var n = unreadFor(c, c.messages);
        return n === c.unread ? c : Object.assign({}, c, { unread: n });
      });
      return s;
    });
  }
  DT.actions.openConversation = function (id) {
    var st0 = DT.getState();
    var convo = (st0.conversations || []).find(function (c) { return c.id === id; });
    // Only what my delivery rows say is unread, each id once per session.
    var ids = convo ? (convo.messages || []).filter(function (m) { return !m.me && m.id != null && m.unreadByMe && !readPosted[m.id]; }).map(function (m) { return m.id; }) : [];
    ids.forEach(function (mid) { readPosted[mid] = true; });
    if (st0.__activeConvo !== id || (convo && convo.unread) || ids.length) {
      DT.set(function (s) {
        s.conversations = (s.conversations || []).map(function (c) { return c.id === id ? Object.assign({}, c, { unread: unreadFor(c, c.messages) }) : c; });
        s.__activeConvo = id;
        return s;
      });
    }
    // On screen for the first time: read its newest page now (A.CON-SHO-65).
    // Its unread messages are marked read on the next call (the thread view
    // calls again when they appear).
    if (convo && convo.loaded === false) fetchLatestPage(id);
    if (ids.length) {
      api("POST", "/api/messaging/messages/mark-read", { messageIds: ids }).catch(function () {
        ids.forEach(function (mid) { delete readPosted[mid]; });
        recountUnread(id);
      });
    }
  };
  // Upload a File as a base64 attachment; resolves to {id, fileName, mimeType,
  // byteSize}. The bytes are stored server-side unlinked until sendMessage
  // references the id. (Synthetic-data pilot: no encrypted object store yet.)
  DT.actions.uploadAttachment = function (file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("no file"));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("read failed")); };
      reader.onload = function () {
        var result = String(reader.result || "");
        var comma = result.indexOf(",");
        var b64 = comma >= 0 ? result.slice(comma + 1) : result; // strip data: prefix
        var body = {
          fileName: file.name || "attachment",
          mimeType: file.type || "application/octet-stream",
          dataBase64: b64,
        };
        // Voice messages carry a client-measured playback length; the server
        // caps it independently. NOTE: audio bytes stay in memory only — never
        // written to localStorage (PHI can be spoken into a clip).
        if (opts.durationMs && opts.durationMs > 0) body.durationMs = Math.round(opts.durationMs);
        api("POST", "/api/messaging/attachments", body).then(resolve, function (e) {
          var err = e instanceof Error ? e : new Error(String(e));
          err.reason = uploadFailure(err, file, opts);
          if (err.reason.code === "module_disabled") refreshModulesAfterRefusal();
          reject(err);
        });
      };
      reader.readAsDataURL(file);
    });
  };
  // Why an upload failed, in words a clinician can act on ({code, text}). The
  // composer shows `text`. A voice note is an audio attachment: the server
  // refuses it (404 module_disabled) when messaging.attachments OR
  // messaging.voice is off — either way voice messages are unavailable.
  function uploadFailure(e, file, opts) {
    var code = String((e && e.message) || "");
    var voice = !!(opts && opts.durationMs) || /^audio\//i.test(String((file && file.type) || ""));
    var name = voice ? "Voice message" : String((file && file.name) || "File");
    var offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline || isNetworkError(e)) return { code: "offline", text: name + " — no connection, not uploaded." };
    if (moduleRefused(e)) return { code: "module_disabled", text: name + " — " + (voice ? "voice messages are" : "file attachments are") + " switched off for your organization." };
    if (/too_large/.test(code) || (e && e.status === 413)) return { code: "too_large", text: name + " — too large to attach (" + (voice ? "5" : "8") + " MB max)." };
    if (/too_long/.test(code)) return { code: "too_long", text: name + " — longer than the 3-minute limit." };
    if (/bad_type/.test(code)) return { code: "bad_type", text: name + " — this file type can't be attached." };
    if (/attachment_store_unavailable/.test(code) || (e && e.status === 503)) return { code: "store_unavailable", text: name + " — the attachment store is unavailable; try again shortly." };
    if (e && e.status === 401) return { code: "session", text: name + " — your session expired." };
    return { code: "server", text: name + " — not uploaded; try again." };
  }
  // The server's moduleGate refuses a switched-off feature with 404 (400 for a
  // refused priority) {error:"module_disabled"}.
  function moduleRefused(e) { return /module_disabled/.test(String((e && e.message) || "")); }
  // A refusal means this client's module map is stale (the switch flipped after
  // it was fetched; the regular refetch is once a minute). Re-read it now so the
  // refused control disappears. Refusals arriving together (several files picked
  // at once) share ONE re-read, issued a moment after the first; a refusal
  // after that re-read was sent gets its own (another switch may have flipped).
  var moduleRefreshTimer = null;
  function refreshModulesAfterRefusal() {
    if (moduleRefreshTimer) return;
    moduleRefreshTimer = setTimeout(function () { moduleRefreshTimer = null; hydrateModules(); }, 150);
  }
  // Send through the outbox: the bubble reads "Sending…" until the server
  // stores it, and a refusal / lost connection leaves a "Not sent" bubble with
  // Retry and Edit instead of a message that only LOOKS sent. `attachments` may
  // be ids or the uploaded {id, fileName, …} objects (kept for Edit). Resolves
  // to {ok, reason?}.
  DT.actions.sendMessage = function (id, text, priority, attachments) {
    var t = (text || "").trim();
    var atts = (Array.isArray(attachments) ? attachments : []).filter(function (a) { return a != null; })
      .map(function (a) { return typeof a === "object" ? a : { id: a }; })
      .filter(function (a) { return a.id != null; });
    if (!t && !atts.length) return Promise.resolve({ ok: false });
    var pri = priority === "stat" || priority === "urgent" ? priority : "routine";
    var o = { localId: "local-" + (++outboxSeq) + "-" + Date.now(), owner: meId, convoId: id, text: t, priority: pri, attachments: atts, at: Date.now(), status: "sending", reason: null };
    outbox.push(o);
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) { return c.id === id && c.unread ? Object.assign({}, c, { unread: 0 }) : c; });
      return s;
    });
    return postOutbox(o);
  };
  // Recall (unsend) my own message while nobody has read it yet. The server
  // enforces the unread-only rule (409 already_read) and tells every
  // participant (MESSAGE_RECALLED); this removes it here immediately.
  DT.actions.recallMessage = function (convoId, messageId) {
    if (messageId == null) return Promise.resolve(false);
    return api("DELETE", "/api/messaging/messages/" + messageId).then(function () {
      DT.set(function (s) {
        s.conversations = (s.conversations || []).map(function (c) {
          return c.id === convoId ? Object.assign({}, c, { messages: (c.messages || []).filter(function (m) { return m.id !== messageId; }) }) : c;
        });
        s.__toast = { tone: "accepted", title: "Message recalled", msg: "Removed for everyone in this conversation." };
        return s;
      });
      recalled[messageId] = true;
      return true;
    }).catch(function (e) {
      var why = String((e && e.message) || "");
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't recall", msg: /already_read/.test(why) ? "It has already been read, so it can't be recalled." : /module_disabled/.test(why) ? "Message recall is switched off for your organization." : /forbidden/.test(why) ? "You can only recall your own messages." : "Try again." }; return s; });
      refreshThread(convoId); // our copy is stale (e.g. it was read meanwhile): re-read this thread only
      return false;
    });
  };
  // Attachment bytes for the in-app viewer / download (A.NEE-NEE-1/2). Fetched
  // by THIS document with its own credentials and returned as a Blob, so
  // viewing or saving a file never opens a new browsing context (an installed
  // iOS app's Safari view does not share the app's session cookie and showed
  // raw {"error":"unauthorized"}). Only the app's own attachment routes are
  // fetchable; `cache: "no-store"` keeps PHI bytes out of the HTTP cache. A 401
  // means the session is gone: the app returns to sign-in like any other call.
  DT.actions.fetchAttachment = function (url, opts) {
    if (!/^\/api\/messaging\/(attachments\/\d+|messages\/\d+\/attachments\/\d+)$/.test(String(url || ""))) {
      return Promise.reject(Object.assign(new Error("bad_url"), { status: 0 }));
    }
    var headers = {};
    if (DEMO_TOKEN) headers["Authorization"] = "Bearer " + DEMO_TOKEN;
    if (opts && opts.range) headers["Range"] = opts.range;
    var epoch = authEpoch;
    return fetch(url, { credentials: "include", headers: headers, cache: "no-store" }).then(function (r) {
      if (!r.ok) {
        var err = new Error(r.status === 401 ? "unauthorized" : r.status === 403 ? "forbidden" : r.status === 404 ? "not_found" : "http_" + r.status);
        err.status = r.status;
        if (r.status === 401 && epoch === authEpoch && !DEMO_TOKEN && DT.getState().session) expireSession();
        throw err;
      }
      return r.blob().then(function (blob) { return { blob: blob, type: (r.headers.get("Content-Type") || blob.type || "").split(";")[0] }; });
    });
  };
  // Acknowledge a STAT/urgent message (stronger than read). Optimistic, then syncs.
  DT.actions.acknowledgeMessage = function (convoId, messageId) {
    if (messageId == null) return;
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        if (c.id !== convoId) return c;
        return Object.assign({}, c, { messages: (c.messages || []).map(function (m) { return m.id === messageId ? Object.assign({}, m, { ackedByMe: true }) : m; }) });
      });
      return s;
    });
    // The MESSAGE_ACK frame patches the delivery rows; without a live socket,
    // re-read just this thread.
    api("POST", "/api/messaging/messages/ack", { messageIds: [messageId] })
      .then(function () { if (!wsLive()) refreshThread(convoId); })
      .catch(function () { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't acknowledge", msg: "Try again." }; return s; }); });
  };
  // Real typing indicator (outbound). Sends typing_start once, then refreshes a
  // 2.5s idle timer that emits typing_stop — same protocol as the /m mobile kit,
  // relayed by the server to the other participants only.
  var typingSendState = {};
  DT.actions.setTyping = function (convoId, on) {
    if (convoId == null || !ws || ws.readyState !== 1) return;
    var convo = (DT.getState().conversations || []).find(function (c) { return c.id === convoId; });
    if (!convo || !(convo.participantIds || []).length || convo.broadcast) return;
    var send = function (start) {
      try { ws.send(JSON.stringify({ type: start ? "typing_start" : "typing_stop", conversationId: Number(convoId), participantIds: convo.participantIds })); } catch (e) {}
    };
    if (!!typingSendState[convoId] !== !!on) { typingSendState[convoId] = !!on; send(!!on); }
    clearTimeout(typingSendState["t" + convoId]);
    if (on) typingSendState["t" + convoId] = setTimeout(function () { typingSendState[convoId] = false; send(false); }, 2500);
  };
  // Open (or create) the patient-linked care-team thread and jump to it.
  DT.actions.openPatientThread = function (patientId) {
    if (patientId == null) return;
    return api("POST", "/api/messaging/patient-thread", { patientId: Number(patientId) })
      .then(function (convo) {
        return ensureConversation(convo.id).then(function () {
          DT.set(function (s) { s.__activeConvo = convo.id; s.__openThread = convo.id; s.ui.nav = "messages"; return s; });
        });
      })
      .catch(function (e) {
        var why = String((e && e.message) || "");
        var off = moduleRefused(e);
        // A stale client (switch flipped after the board loaded): re-read the
        // module map so the "Message team" control disappears without a reload.
        if (off) refreshModulesAfterRefusal();
        var msg = off ? "Patient-linked threads are switched off for your organization."
          : (typeof navigator !== "undefined" && navigator.onLine === false) || isNetworkError(e) ? "No connection — try again when you're back online."
          : /forbidden/.test(why) ? "Only this patient's care team (or a director) can open the thread."
          : /not_found/.test(why) ? "That patient is no longer on the board."
          : "Try again.";
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't open patient thread", msg: msg }; return s; });
      });
  };
  DT.actions.startConversation = function (participant) {
    var other = (DT.getState().directory || []).find(function (d) { return d.name === participant.name; });
    if (!other || meId == null) { if (origStartConversation) origStartConversation(participant); return; } // not a registered user → local only
    return get("/api/messaging/conversations").then(function (convos) {
      var existing = (convos || []).find(function (c) { return c.type === "direct" && (c.participantIds || []).indexOf(other.id) >= 0 && (c.participantIds || []).indexOf(meId) >= 0; });
      if (existing) {
        return ensureConversation(existing.id).then(function () { DT.set(function (s) { s.__activeConvo = existing.id; s.__openThread = existing.id; return s; }); });
      }
      return api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [other.id] }).then(function (convo) {
        return ensureConversation(convo.id).then(function () { DT.set(function (s) { s.__activeConvo = convo.id; s.__openThread = convo.id; return s; }); });
      });
    }).catch(function () { if (origStartConversation) origStartConversation(participant); });
  };

  // On-call / role addressing: fetch the server-resolved list of addressable
  // roles (each already resolved to a real messageable userId in our org).
  DT.actions.listOnCallTargets = function () {
    return get("/api/messaging/on-call-targets").then(function (targets) {
      var list = targets || [];
      DT.set(function (s) { s.onCallTargets = list; return s; });
      return list;
    }).catch(function () { DT.set(function (s) { s.onCallTargets = []; return s; }); return []; });
  };
  // Availability of a 1:1 peer (DND + covering + on-shift) for the thread's
  // auto-response banner. Cached per userId in s.peerAvail.
  DT.actions.loadPeerAvailability = function (userId) {
    if (userId == null) return Promise.resolve(null);
    return get("/api/messaging/availability/" + userId).then(function (info) {
      DT.set(function (s) { var m = Object.assign({}, s.peerAvail || {}); m[userId] = info; s.peerAvail = m; return s; });
      return info;
    }).catch(function () { return null; });
  };
  // Start (or reopen, deduped by the resolved userId) a direct conversation with
  // whoever holds the selected role, naming the thread after the role so it's
  // clear who was addressed. Reuses the standard conversation endpoint.
  DT.actions.startRoleConversation = function (target) {
    if (!target || target.userId == null || meId == null) return Promise.resolve();
    return get("/api/messaging/conversations").then(function (convos) {
      var existing = (convos || []).find(function (c) { return c.type === "direct" && (c.participantIds || []).indexOf(target.userId) >= 0 && (c.participantIds || []).indexOf(meId) >= 0; });
      if (existing) {
        return ensureConversation(existing.id).then(function () { DT.set(function (s) { s.__activeConvo = existing.id; s.__openThread = existing.id; return s; }); });
      }
      return api("POST", "/api/messaging/conversations", { type: "direct", name: target.label, participantIds: [target.userId] }).then(function (convo) {
        return ensureConversation(convo.id).then(function () { DT.set(function (s) { s.__activeConvo = convo.id; s.__openThread = convo.id; return s; }); });
      });
    }).catch(function () {});
  };

  // ---- message forwarding (server-backed, with provenance) -----------------
  // target: { conversationId } | { participantIds: [..] } | { roleTarget: "<id>" }
  // opts: { keepPriority, note }. Resolves to the forwarded message; the
  // target thread becomes the active conversation.
  DT.actions.forwardMessage = function (messageId, target, opts) {
    if (messageId == null || !target) return Promise.resolve(null);
    var body = Object.assign({}, target, { keepPriority: !!(opts && opts.keepPriority) });
    if (opts && opts.note) body.note = String(opts.note);
    return api("POST", "/api/messaging/messages/" + messageId + "/forward", body)
      .then(function (m) {
        // The copy reaches this device in its MESSAGE_RECEIVED frame; a new
        // target thread is fetched, and without a live socket that one thread.
        return (m && m.conversationId != null ? ensureConversation(m.conversationId) : Promise.resolve()).then(function () {
          if (m && m.conversationId != null && !wsLive()) refreshThread(m.conversationId);
          DT.set(function (s) { if (m && m.conversationId != null) s.__activeConvo = m.conversationId; s.__toast = { tone: "sent", title: "Message forwarded", msg: "Sent with its original sender and time attached." }; return s; });
          return m;
        });
      })
      .catch(function (e) {
        var why = String((e && e.message) || "");
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't forward", msg: /module_disabled/.test(why) ? "Message forwarding is switched off for your organization." : /same_conversation/.test(why) ? "That message is already in this thread." : /role_unresolved/.test(why) ? "Nobody currently holds that role." : "Try again." }; return s; });
        return null;
      });
  };

  // ---- message templates (org-wide + personal canned messages) -------------
  DT.actions.listTemplates = function () {
    return get("/api/messaging/templates").then(function (rows) {
      var list = rows || [];
      DT.set(function (s) { s.templates = list; return s; });
      return list;
    }).catch(function () { DT.set(function (s) { s.templates = s.templates || []; return s; }); return []; });
  };
  function templateErrorToast(e, title) {
    var why = String((e && e.message) || "");
    DT.set(function (s) { s.__toast = { tone: "rejected", title: title, msg: /forbidden/.test(why) ? "Only directors can manage organization templates." : /module_disabled/.test(why) ? "Templates are switched off for your organization." : "Try again." }; return s; });
  }
  DT.actions.createTemplate = function (data) {
    return api("POST", "/api/messaging/templates", { title: data.title, body: data.body, priority: data.priority || "routine", scope: data.scope === "org" ? "org" : "mine" })
      .then(function (t) { DT.set(function (s) { s.__toast = { tone: "accepted", title: "Template saved", msg: t.title }; return s; }); return DT.actions.listTemplates().then(function () { return t; }); })
      .catch(function (e) { templateErrorToast(e, "Couldn't save template"); return null; });
  };
  DT.actions.updateTemplate = function (id, patch) {
    return api("PATCH", "/api/messaging/templates/" + id, patch)
      .then(function (t) { return DT.actions.listTemplates().then(function () { return t; }); })
      .catch(function (e) { templateErrorToast(e, "Couldn't update template"); return null; });
  };
  DT.actions.deleteTemplate = function (id) {
    return api("DELETE", "/api/messaging/templates/" + id)
      .then(function () { return DT.actions.listTemplates(); })
      .catch(function (e) { templateErrorToast(e, "Couldn't delete template"); return null; });
  };

  // ---- away message (shown to senders while I'm DND / off shift) -----------
  // Read back through the availability endpoint (it's what senders see).
  function hydrateAwayMessage() {
    if (meId == null) return Promise.resolve();
    return get("/api/messaging/availability/" + meId).then(function (info) {
      DT.set(function (s) { var p = Object.assign({}, s.myPrefs); p.awayMessage = (info && info.awayMessage) || ""; s.myPrefs = p; return s; });
    }).catch(function () {});
  }
  DT.actions.setAwayMessage = function (text) {
    var t = String(text || "").trim().slice(0, 280);
    return DT.actions.setMyPref("awayMessage", t);
  };

  // ---- broadcasts: catch-up list + per-recipient acknowledgement -----------
  // Kit severity: info | warning | critical; server: info | urgent | critical.
  var SEV_TO_KIT = { info: "info", urgent: "warning", critical: "critical" };
  function mapBroadcast(b) {
    return {
      id: b.id,
      title: b.message,
      sev: SEV_TO_KIT[b.severity] || "warning",
      at: new Date(b.createdAt || Date.now()).getTime(),
      senderId: b.senderId,
      senderName: b.senderName || "",
      mine: b.senderId === meId,
      ackReq: b.ackRequired != null ? !!b.ackRequired : b.severity !== "info",
      ackedByMe: !!b.acked,
      ackedAt: b.ackedAt ? new Date(b.ackedAt).getTime() : null,
      acked: typeof b.ackCount === "number" ? b.ackCount : 0,
      total: typeof b.total === "number" ? b.total : 0,
      ackedBy: b.ackedBy || [],
    };
  }
  function hydrateBroadcasts() {
    return get("/api/broadcasts").then(function (rows) {
      DT.set(function (s) { s.broadcasts = (rows || []).map(mapBroadcast); s.broadcastsLive = true; return s; });
    }).catch(function () { /* module off or offline: keep what's there */ });
  }
  DT.actions.refreshBroadcasts = hydrateBroadcasts;
  DT.actions.ackBroadcast = function (id) {
    if (id == null) return Promise.resolve();
    // Optimistic: flip my own state now; the WS BROADCAST_ACKED event brings
    // the authoritative tally.
    DT.set(function (s) {
      s.broadcasts = (s.broadcasts || []).map(function (b) { return b.id === id ? Object.assign({}, b, { ackedByMe: true, ackedAt: Date.now() }) : b; });
      return s;
    });
    return api("POST", "/api/broadcasts/" + id + "/ack").then(function () {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Broadcast acknowledged", msg: "The sender can see you received it." }; return s; });
    }).catch(function () {
      DT.set(function (s) {
        s.broadcasts = (s.broadcasts || []).map(function (b) { return b.id === id ? Object.assign({}, b, { ackedByMe: false, ackedAt: null }) : b; });
        s.__toast = { tone: "rejected", title: "Couldn't acknowledge", msg: "Try again." };
        return s;
      });
    });
  };

  // Live banner: every unacknowledged urgent/critical broadcast addressed to me
  // stays pinned at the top of the app (any screen, any role) with an
  // Acknowledge button until it's acked — a toast alone disappears in seconds.
  // Plain DOM so it works regardless of which screen is mounted.
  var bannerEl = null;
  var bannerKey = "";
  function renderBroadcastBanner() {
    try {
      var st = DT.getState();
      var mod = !DT.moduleOn || DT.moduleOn("broadcasts");
      var due = st.session && mod ? (st.broadcasts || []).filter(function (b) { return b.ackReq && !b.ackedByMe && !b.mine && b.senderId != null; }) : [];
      var key = due.map(function (b) { return b.id; }).join(",");
      if (key === bannerKey) return;
      bannerKey = key;
      if (!bannerEl) {
        bannerEl = document.createElement("div");
        bannerEl.id = "dt-broadcast-banner";
        bannerEl.setAttribute("role", "alert");
        // Below the notch / status bar of an installed iPhone app (viewport-fit=cover).
        bannerEl.style.cssText = "position:fixed;top:calc(10px + env(safe-area-inset-top, 0px));left:50%;transform:translateX(-50%);z-index:45;width:min(640px,calc(100vw - 24px));display:flex;flex-direction:column;gap:8px;font-family:inherit;";
        document.body.appendChild(bannerEl);
      }
      bannerEl.innerHTML = "";
      due.slice(0, 3).forEach(function (b) {
        var critical = b.sev === "critical";
        var row = document.createElement("div");
        row.className = "dt-broadcast-banner-item";
        row.style.cssText = "display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);border:1px solid " + (critical ? "#B91C1C" : "#B45309") + ";background:" + (critical ? "#FEE2E2" : "#FEF3C7") + ";color:" + (critical ? "#7F1D1D" : "#78350F") + ";";
        var txt = document.createElement("div");
        txt.style.cssText = "flex:1;min-width:0;";
        var t1 = document.createElement("div");
        t1.style.cssText = "font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;";
        t1.textContent = (critical ? "Critical" : "Urgent") + " broadcast" + (b.senderName ? " · " + b.senderName : "");
        var t2 = document.createElement("div");
        t2.style.cssText = "font-size:13.5px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        t2.textContent = b.title;
        txt.appendChild(t1); txt.appendChild(t2);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Acknowledge";
        btn.setAttribute("data-broadcast-ack", String(b.id));
        // A real 44px target on every device, not only coarse-pointer ones.
        btn.style.cssText = "flex:none;min-height:44px;padding:0 16px;border-radius:999px;border:none;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;color:#fff;background:" + (critical ? "#B91C1C" : "#B45309") + ";";
        btn.onclick = function () { DT.actions.ackBroadcast(b.id); };
        row.appendChild(txt); row.appendChild(btn);
        bannerEl.appendChild(row);
      });
      if (due.length > 3) {
        var more = document.createElement("div");
        more.style.cssText = "text-align:center;font-size:12px;color:#78350F;";
        more.textContent = (due.length - 3) + " more awaiting acknowledgement";
        bannerEl.appendChild(more);
      }
      bannerEl.style.display = due.length ? "flex" : "none";
    } catch (e) { /* never let the banner break the app */ }
  }
  if (DT.subscribe) DT.subscribe(renderBroadcastBanner);

  // ---- unread indicators outside the Messages screen (A.CON-MIN-17) --------
  // The window title and, where supported (Chromium; iOS 16.4+ Home Screen
  // apps), the app-icon badge carry the unread count. Counts only — never a
  // name or text. Nothing until this session's conversations come from the
  // server (the store's offline demo seed must not raise a badge), and both are
  // cleared on sign-out. The Messages nav item reads DT.unreadMessages() too.
  var lastIndicator = null;
  function liveUnread() {
    var st = DT.getState();
    if (!st.session || convosLiveEpoch !== authEpoch) return 0;
    return DT.unreadMessages ? DT.unreadMessages() : 0;
  }
  function syncUnreadIndicators(force) {
    try {
      var st = DT.getState();
      var n = liveUnread();
      var app = (st.theme && st.theme.appName) || "DocTurn";
      var key = n + "|" + app;
      if (key === lastIndicator && !force) return;
      lastIndicator = key;
      if (typeof document !== "undefined") document.title = n > 0 ? "(" + (n > 99 ? "99+" : n) + ") " + app : app;
      if (typeof navigator !== "undefined") {
        var r = null;
        if (n > 0 && navigator.setAppBadge) r = navigator.setAppBadge(n);
        else if (n === 0 && navigator.clearAppBadge) r = navigator.clearAppBadge();
        if (r && r.catch) r.catch(function () {});
      }
    } catch (e) { /* indicators are best-effort */ }
  }
  if (DT.subscribe) DT.subscribe(function () { syncUnreadIndicators(false); });
  syncUnreadIndicators(true);
  // The service worker may have raised a flag badge for a push while the app was
  // in the background; put the real count back when the app is in front again.
  try { document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") syncUnreadIndicators(true); }); } catch (e) {}

  // A tapped notification (webapp/sw.js) asks the open app to show Messages;
  // a freshly opened app arrives with ?open=messages.
  function openFromNotification(nav) {
    if (nav !== "messages") return;
    if (DT.getState().session) DT.actions.setNav("messages");
    else pendingOpenNav = "messages";
  }
  var pendingOpenNav = null;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener("message", function (e) {
        var d = e && e.data;
        if (d && d.type === "docturn:open") openFromNotification(d.nav);
      });
    }
    var qs = new URLSearchParams(window.location.search);
    if (qs.get("open") === "messages") {
      pendingOpenNav = "messages";
      qs.delete("open");
      var rest = qs.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
    }
  } catch (e) {}
  if (DT.subscribe) DT.subscribe(function () {
    if (pendingOpenNav && DT.getState().session && convosLiveEpoch === authEpoch) {
      var nav = pendingOpenNav; pendingOpenNav = null;
      DT.actions.setNav(nav);
    }
  });

  // Specialty-aware preview for the ER intake Quick hint: the server applies
  // the patient's specialty preference exactly as the real pick will.
  DT.previewRotation = function (specialty) {
    var q = specialty ? "?specialty=" + encodeURIComponent(String(specialty).slice(0, 100)) : "";
    return api("GET", "/api/rotation/next" + q).then(function (r) {
      var m = mapRotation(r);
      var p = m.nextId ? (DT.getState().providers || []).find(function (x) { return x.id === m.nextId; }) : null;
      // A provider the roster hasn't hydrated yet still gets a truthful label.
      if (m.next && !p) p = { id: m.nextId, name: m.next.displayName || "Provider", census: m.next.census, cap: m.next.cap, specialty: m.next.specialty };
      return { source: "server", next: p || null, capRelief: m.capRelief, specialty: specialty || "" };
    }, function (e) {
      if (localDemoSession && isNetworkError(e)) return { source: "local", next: DT.nextUp(), capRelief: DT.rotationStatus().capRelief, specialty: specialty || "" };
      return { source: rotationFailure(e).source, next: null, capRelief: false, specialty: specialty || "" };
    });
  };

  // routeMode is the ER intake tab: "quick" → round_robin (the SERVER picks;
  // no hospitalistId is sent), "manual" → that provider. It is never inferred
  // from whether the chosen provider happens to match a local guess, and the
  // confirmation names whoever the server actually assigned (A.CON-SHO-29).
  // A programmatic call without a tab that names a provider means "send to
  // this provider" (manual); with no provider it is round-robin.
  DT.actions.sendAssignment = function (provider, fields, consults, routeMode) {
    var mode = routeMode === "quick" ? "round_robin"
      : routeMode === "manual" ? "manual"
      : (provider ? "manual" : "round_robin");
    if (mode === "manual" && !provider) return;
    var sentId = "s" + Date.now();
    var admId = "ad-" + sentId;
    var routingLabel = mode === "manual" ? provider.name : "Round-robin (routing…)";
    function nameForHospitalist(hid) {
      var p = (DT.getState().providers || []).find(function (x) { return x.id === "h" + hid; });
      return p ? p.name : null;
    }
    function settle(name, toast) {
      DT.set(function (s) {
        s.sent = (s.sent || []).map(function (x) { return x.id === sentId ? Object.assign({}, x, { provider: name }) : x; });
        s.admissions = (s.admissions || []).map(function (x) { return x.id === admId ? Object.assign({}, x, { provider: name }) : x; });
        s.__toast = toast;
        return s;
      });
    }
    var body = { mode: mode };
    if (mode === "manual") body.hospitalistId = bid(provider.id);
    api("POST", "/api/patients", {
      initials: fields.initials, roomNumber: fields.room, issueSummary: fields.complaint, specialty: fields.specialty,
      acuity: fields.acuity || undefined,
    }).then(function (p) {
      body.patientId = p.id;
      return api("POST", "/api/assignments", body);
    }).then(function (a) {
      var who = (a && nameForHospitalist(a.hospitalistId)) || (mode === "manual" ? provider.name : "the next eligible hospitalist");
      settle(who, { tone: "sent", title: "Assignment sent to " + who, msg: "Notified by push, SMS fallback." });
      return rehydrate();
    }).catch(function (e) {
      // Network failure in the LOCAL offline demo → keep the optimistic row. In
      // a real session a network failure means the admission never reached the
      // server and nobody was notified, and a server REJECTION (e.g. this tab is
      // signed in as a different role because two tabs in one browser share a
      // cookie) must not look like success either: undo the optimistic row and
      // say what happened.
      var offline = isNetworkError(e);
      if (offline && localDemoSession) {
        var local = mode === "manual" ? provider : DT.nextUp();
        var nm = local ? local.name : "the next eligible hospitalist";
        settle(nm, { tone: "sent", title: "Assignment sent to " + nm, msg: "Offline demo — nothing reached a server." });
        return;
      }
      var why = String((e && e.message) || "");
      DT.set(function (s) {
        s.sent = (s.sent || []).filter(function (x) { return x.id !== sentId; });
        s.admissions = (s.admissions || []).filter(function (x) { return x.id !== admId; });
        s.__toast = { tone: "rejected", title: "Couldn't send assignment",
          msg: offline ? "No connection — the admission was NOT sent and nobody was notified. Send it again when you're back online."
          : /forbidden|role|unauthor/i.test(why)
            ? "This tab isn't signed in as an ER physician. Two tabs in one browser share a login — use a separate browser or device per user."
            : (/no.?provider/i.test(why) ? "No eligible hospitalist is on shift to receive this." : "The server rejected this admission — please retry.") };
        return s;
      });
    });
    // Optimistic row while the server decides. A round-robin row does not name
    // anyone yet — the server's pick replaces "routing…" when it answers.
    DT.set(function (s) {
      s.sent = [{ id: sentId, initials: fields.initials, provider: routingLabel, complaint: fields.complaint, consultants: consults || [], acuity: fields.acuity || 3, time: "Today · " + fmt.clockLabel(), day: "Today", status: "sent" }].concat(s.sent);
      // append to the admissions log (every admission given to a team)
      s.admissions = [{ id: admId, at: Date.now(), initials: fields.initials, room: fields.room || "—", provider: routingLabel, specialty: fields.specialty || "General Medicine", acuity: fields.acuity || 3, via: mode === "round_robin" ? "Round-robin" : "Manual", status: "sent" }].concat(s.admissions || []);
      s.__toast = { tone: "sent", title: mode === "manual" ? "Sending assignment to " + provider.name + "…" : "Sending assignment…",
        msg: mode === "manual" ? "Waiting for the server to confirm." : "Round-robin is choosing the next eligible hospitalist." };
      return s;
    });
  };

  // director provider management
  DT.actions.toggleWorking = function (id) {
    var p = DT.getState().providers.find(function (x) { return x.id === id; });
    if (p) api("PATCH", "/api/hospitalists/" + bid(id) + "/working-status", { working: !p.working }).then(rehydrate).catch(function () {});
  };
  DT.actions.adjustCap = function (id, d) {
    var p = DT.getState().providers.find(function (x) { return x.id === id; });
    if (p) api("PATCH", "/api/physicians/" + bid(id) + "/capacity", { patientCap: Math.max(1, p.cap + d) }).then(rehydrate).catch(function () {});
  };
  DT.actions.adjustCensus = function (id, d) {
    var p = DT.getState().providers.find(function (x) { return x.id === id; });
    if (p) api("PATCH", "/api/hospitalists/" + bid(id) + "/census", { currentPatientCount: Math.max(0, p.census + d), reason: "manual adjustment" }).then(rehydrate).catch(function () {});
  };
  DT.actions.bulkWorking = function (on) {
    api("PATCH", "/api/hospitalists/0/working-status", { all: on }).then(rehydrate).catch(function () {});
  };
  DT.actions.resetRotation = function () {
    // The toast reports what the server did — never a reset that was refused.
    return api("POST", "/api/round-robin/reset").then(function () {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Rotation index reset", msg: "Round-robin restarts from the top." }; return s; });
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Rotation not reset", msg: e && e.status === 403 ? "Only a director can reset it." : "Try again." }; return s; });
    });
  };
  // Emergency broadcast: persist + fan out via the real backend (WS
  // BROADCAST_CREATED reaches every signed-in member of the org). The kit's
  // local action still runs for the sender's own list/toast. Severity mapping:
  // the kit offers info/warning/critical/emergency; the server accepts
  // info/urgent/critical.
  var origSendBroadcast = DT.actions.sendBroadcast;
  DT.actions.sendBroadcast = function (data) {
    var SEV_MAP = { info: "info", warning: "urgent", critical: "critical", emergency: "critical" };
    var msg = (data.title || "").trim() + (data.message && data.message.trim() ? " — " + data.message.trim() : "");
    if (!msg) { if (origSendBroadcast) return origSendBroadcast(data); return; }
    // Ack semantics are server-defined: urgent/critical require an ack, info
    // doesn't. If the composer asked for an ack on an info broadcast, promote
    // it to urgent so recipients actually get the Acknowledge button.
    var sev = SEV_MAP[data.severity] || "urgent";
    if (data.ackReq && sev === "info") sev = "urgent";
    return api("POST", "/api/broadcasts", { message: msg, severity: sev }).then(function (b) {
      DT.set(function (s) {
        if (b && !(s.broadcasts || []).some(function (x) { return x.id === b.id; })) s.broadcasts = [mapBroadcast(Object.assign({ senderName: (s.me && s.me.name) || "" }, b))].concat(s.broadcasts || []);
        s.__toast = { tone: "sent", title: "Broadcast sent", msg: "Delivered to everyone in your organization" + (sev !== "info" ? " · acknowledgement required" : "") + "." };
        return s;
      });
      return hydrateBroadcasts();
    }).catch(function (e) {
      // Backend unreachable → the kit's local behaviour, but ONLY in the local
      // offline demo; in a real session nobody was alerted and the sender must
      // know. A server REJECTION must not look like success either.
      var offline = isNetworkError(e);
      if (offline && localDemoSession && origSendBroadcast) return origSendBroadcast(data);
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Broadcast not delivered", msg: offline ? "No connection — nobody was alerted. Send it again when you're back online." : String((e && e.message) || "The server rejected it.") }; return s; });
    });
  };
  DT.actions.addProvider = function (data) {
    var name = (data.name || "").trim();
    if (!name) return;
    // Never allow provisioning a developer/super-admin from the director UI;
    // the server enforces this too, but keep the client from ever asking.
    var role = data.role && data.role !== "developer" ? data.role : "hospitalist";
    var uname = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 20) || ("dr" + Date.now());
    // No password is chosen here: the server mints a one-time credential and
    // returns it exactly once, which we show the director to hand over.
    var body = { username: uname, displayName: name, role: role };
    // Specialty/cap/shift only apply to hospitalists (who join the rotation).
    if (role === "hospitalist") {
      body.specialty = data.specialty || "Hospital Medicine";
      body.patientCap = parseInt(data.cap, 10) || 12;
      body.shiftType = data.shift || "day";
    }
    var roleLabel = { hospitalist: "Provider", er_doctor: "ER doctor", er_director: "ER director", director: "Director" }[role] || "Provider";
    return api("POST", "/api/director/hospitalists", body).then(function (res) {
      rehydrate(); hydrateDevUsers();
      revealCredential({ title: roleLabel + " added", name: name, username: (res && res.user && res.user.username) || uname, temporaryPassword: res && res.temporaryPassword });
    }).catch(function (e) {
      var msg = String(e && e.message) === "username_taken" ? "That username already exists in this organization." : "The server rejected the request.";
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not add " + roleLabel.toLowerCase(), msg: msg }; return s; });
    });
  };
  // Show a freshly minted one-time password to the administrator — in a modal
  // they must dismiss (never a toast that vanishes), and only in memory.
  function revealCredential(c) {
    DT.set(function (s) { s.__credentialReveal = c; return s; });
  }
  DT.actions.dismissCredentialReveal = function () {
    DT.set(function (s) { s.__credentialReveal = null; return s; });
  };
  DT.actions.removeProvider = function (id) {
    api("DELETE", "/api/physicians/" + bid(id)).then(rehydrate).catch(function () {});
    DT.set(function (s) { s.providers = s.providers.filter(function (x) { return x.id !== id; }); return s; });
  };

  // Import providers parsed from an external schedule (Amion) as real users.
  // Role-aware: a developer provisions into the named org via /api/dev/users;
  // a director provisions into their own org via /api/director/hospitalists.
  // Each provider is created sequentially; existing ones (409) are skipped.
  function unameFor(name) {
    return (name || "user").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24) || ("u" + Date.now());
  }
  DT.actions.importProviders = function (orgCode, providers) {
    var role = (DT.getState().session || {}).role;
    var list = providers || [];
    function createInOrg(orgId, p) {
      return api("POST", "/api/dev/users", {
        organizationId: orgId, role: "hospitalist", displayName: p.name,
        username: unameFor(p.name), specialty: p.group || undefined,
        patientCap: 12, shiftType: p.shift || "day",
        // Imported from the schedule → on-shift, so they appear in the on-call
        // roster (consult services) immediately, not as inactive providers.
        working: true,
      });
    }
    function createOwn(p) {
      // Server mints the one-time password; imported accounts are unusable
      // until the director issues it (Reset password in People).
      return api("POST", "/api/director/hospitalists", {
        username: unameFor(p.name), displayName: p.name,
        specialty: p.group || "Hospital Medicine", patientCap: 12,
        shiftType: p.shift || "day", role: "hospitalist", working: true,
      });
    }
    function runSeq(make) {
      var added = 0, skipped = 0;
      return list.reduce(function (pr, p) {
        return pr.then(function () {
          return make(p).then(function () { added++; }, function () { skipped++; });
        });
      }, Promise.resolve()).then(function () { return { added: added, skipped: skipped }; });
    }
    var chain = role === "developer"
      ? get("/api/dev/organizations").then(function (orgs) {
          var o = (orgs || []).find(function (x) { return String(x.code).toUpperCase() === String(orgCode).toUpperCase(); });
          if (!o) throw new Error("Organization not found.");
          return runSeq(function (p) { return createInOrg(o.id, p); });
        })
      : runSeq(createOwn);
    return chain.then(function (res) {
      hydrateDevUsers(); hydrateOrgs(); rehydrate();
      DT.set(function (s) {
        s.__toast = res.added
          ? { tone: "accepted", title: "Imported " + res.added + " provider(s)", msg: (res.skipped ? res.skipped + " already existed · " : "") + "added to " + orgCode + "." }
          : { tone: "rejected", title: "Nothing imported", msg: "All selected providers already exist." };
        return s;
      });
      return res;
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Import failed", msg: String((e && e.message) || "Try again.") }; return s; });
      throw e;
    });
  };

  // ---- Amion schedule feed (server-side, env-configured) --------------------
  // Status is readable by any authed role (the server scopes it to the Amion
  // org); sync-now is director/developer only. The feed URL/token never
  // reaches the client — these return only the parsed grid + sync metadata.
  DT.actions.amionStatus = function () { return get("/api/amion/status"); };
  DT.actions.amionSyncNow = function () { return api("POST", "/api/amion/sync-now", {}); };

  // Developer: hydrate real cross-tenant users into the kit's devUsers shape.
  // People an administrator may manage: developers read the cross-tenant list,
  // directors / ER directors read their own org via /api/accounts (same shape).
  function hydrateDevUsers() {
    var role = (DT.getState().session || {}).role;
    var path = role === "developer" ? "/api/dev/users" : "/api/accounts";
    return get(path).then(function (users) {
      DT.set(function (s) {
        s.devUsers = (users || []).map(function (u) {
          return { id: u.id, name: u.name, username: u.username || "", role: u.role, org: u.org, specialty: u.specialty || "", credential: u.credential || "",
            disabled: !!u.disabled, mustChangePassword: !!u.mustChangePassword, scope: u.role === "developer" ? "root" : "local" };
        });
        return s;
      });
    }).catch(function () {});
  }
  var SHIFT_MAP = { rounding: "day", swing: "swing", nocturnist: "night", day: "day", night: "night" };

  // developer — cross-tenant user provisioning
  DT.actions.addUser = function (form) {
    var org = (DT.getState().orgs || []).find(function (o) { return o.code === form.org; });
    if (!org) { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Pick an organization", msg: "Choose a tenant first." }; return s; }); return; }
    var uname = (form.email || form.name || "user").toLowerCase().split("@")[0].replace(/[^a-z0-9.]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24) || ("u" + Date.now());
    api("POST", "/api/dev/users", {
      organizationId: org.id,
      role: form.role,
      displayName: form.name,
      username: uname,
      specialty: form.specialty || undefined,
      credential: form.credential || undefined,
      patientCap: form.cap ? parseInt(form.cap, 10) : undefined,
      shiftType: SHIFT_MAP[form.shift] || "day",
    }).then(function (u) {
      hydrateDevUsers(); hydrateOrgs();
      revealCredential({ title: "User created in " + form.org, name: form.name, username: (u && u.username) || uname, temporaryPassword: u && u.temporaryPassword });
    }).catch(function (e) {
      var msg = String(e && e.message) === "username_taken" ? "That username already exists in " + form.org + "." : "Check the form and try again.";
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not create user", msg: msg }; return s; });
    });
  };
  // ---- account lifecycle (director / ER director / developer) --------------
  function refreshPeople() { hydrateDevUsers(); if ((DT.getState().session || {}).role === "developer") hydrateOrgs(); rehydrate(); }
  function accountError(e, what) {
    var m = String((e && e.message) || "");
    var msg = m === "cannot_act_on_self" ? "You can't " + what + " your own account."
      : m === "not_found" ? "That account isn't one you manage."
      : m === "forbidden" ? "Your role can't " + what + " accounts."
      : "The server rejected the request.";
    DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not " + what, msg: msg }; return s; });
  }
  DT.actions.deactivateUser = function (id) {
    return api("POST", "/api/accounts/" + id + "/deactivate").then(function () {
      refreshPeople();
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Access removed", msg: "The account can no longer sign in; any open sessions end on their next request." }; return s; });
    }).catch(function (e) { accountError(e, "deactivate"); });
  };
  DT.actions.reactivateUser = function (id) {
    return api("POST", "/api/accounts/" + id + "/reactivate").then(function () {
      refreshPeople();
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Access restored", msg: "The account can sign in again." }; return s; });
    }).catch(function (e) { accountError(e, "reactivate"); });
  };
  DT.actions.resetUserPassword = function (id, name) {
    return api("POST", "/api/accounts/" + id + "/reset-password").then(function (r) {
      refreshPeople();
      revealCredential({ title: "Password reset", name: name || (r && r.username), username: r && r.username, temporaryPassword: r && r.temporaryPassword });
    }).catch(function (e) { accountError(e, "reset the password"); });
  };
  DT.actions.removeUser = function (id) {
    api("DELETE", "/api/dev/users/" + id).then(function () {
      hydrateDevUsers(); hydrateOrgs();
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "User removed", msg: "Account deleted." }; return s; });
    }).catch(function (e) {
      var msg = String(e.message) === "user_has_activity"
        ? "This user has activity (assignments/messages) — can't delete."
        : "Delete failed.";
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not delete", msg: msg }; return s; });
    });
  };
  // Gate state carried by a session-swap answer (impersonate / manage-org /
  // stop, and GET /api/user): `mustChangePassword` and `mfaEnrollmentRequired`
  // of the identity the session now holds. The de-dupe flags move with the UI
  // flags so a later 403 can raise them again, and leaving a held portal
  // clears them (A.CON-SHO-38).
  function swapGates(u) {
    var g = { mfa: !!(u && u.mfaEnrollmentRequired), pw: !!(u && u.mustChangePassword) };
    mfaFlagged = g.mfa; pwChangeFlagged = g.pw;
    return g;
  }
  // A held identity answers 403 on everything but its exemptions: stop the
  // previous identity's socket instead of reconnecting one that is refused.
  function dropWs() {
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    try { if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } } catch (e) {}
  }

  // developer ROOT access — open any user's portal (audited session swap) to
  // see exactly what they see and fix things in place.
  DT.actions.impersonate = function (user) {
    if (!user || user.id == null) return;
    if (user.role === "developer") { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Can't impersonate", msg: "Pick a non-developer account." }; return s; }); return; }
    return api("POST", "/api/dev/impersonate", { userId: Number(user.id) })
      .then(function () { return get("/api/user"); })
      .then(function (u) {
        newAuthEpoch();
        var switched = adoptIdentity(u.id);
        auditLoaded = false;
        prefsLoaded = false;
        var g = swapGates(u);
        DT.set(function (s) {
          dropPreviousThreads(s, switched);
          s.session = { role: u.role, org: user.org || s.selectedOrg, user: u.username, name: u.displayName };
          s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
          s.impersonating = { name: u.displayName, role: u.role, org: user.org || s.selectedOrg };
          s.mfaEnrollmentRequired = g.mfa; s.passwordChangeRequired = g.pw;
          s.ui.nav = "dashboard"; s.ui.notifOpen = false;
          return s;
        });
        // The account is held by its own gate: the shell shows why, with the
        // way back (index.html ImpersonationGateHold); nothing else would answer.
        if (g.mfa || g.pw) { dropWs(); return u; }
        connectWs();
        return hydrate(u.role).then(function (r) { hydrateConversations(); return r; });
      })
      .catch(function () { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't open portal", msg: "Impersonation failed." }; return s; }); });
  };
  // Leave the impersonated / managed-org portal. The SERVER swaps the session
  // back to the developer it recorded at entry (POST /api/dev/impersonate/stop)
  // — no password, no demo account, works on real-PHI deployments.
  DT.actions.stopImpersonating = function () {
    return api("POST", "/api/dev/impersonate/stop", {}).then(function (u) {
      newAuthEpoch();
      var switched = adoptIdentity(u.id);
      auditLoaded = false; prefsLoaded = false;
      dashHydrated = false; lastDashSnap = null;
      // The borrowed account's gate flags go with it; the developer's own (if
      // any — e.g. the platform org began requiring MFA) come from the answer.
      var g = swapGates(u);
      DT.set(function (s) {
        dropPreviousThreads(s, switched);
        s.impersonating = null;
        s.session = { role: u.role, org: PLATFORM_ORG, user: u.username, name: u.displayName };
        s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
        s.mfaEnrollmentRequired = g.mfa; s.passwordChangeRequired = g.pw;
        s.ui.nav = "dashboard"; s.ui.notifOpen = false;
        return s;
      });
      if (g.mfa || g.pw) { dropWs(); return u; } // held at the developer's own enrolment / change screen
      return bootSession(u);
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't leave portal", msg: "Sign out and sign back in as the developer." }; return s; });
      console.error("[DocTurn] stopImpersonating failed:", e);
    });
  };

  // developer enters an ORGANIZATION's context (as its senior admin) to manage
  // that tenant's full portal — compliance, directory, approvals, board,
  // settings — every surface individualized to that org. Audited session swap.
  DT.actions.manageOrg = function (org) {
    var code = (org && org.code) || org;
    var id = (org && org.id != null) ? org.id : orgIdForCode(code);
    if (id == null) { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't open org", msg: "Unknown organization." }; return s; }); return; }
    return api("POST", "/api/dev/manage-org", { orgId: Number(id) })
      .then(function (u) {
        newAuthEpoch();
        var switched = adoptIdentity(u.id);
        auditLoaded = false;
        prefsLoaded = false;
        var g = swapGates(u);
        DT.set(function (s) {
          dropPreviousThreads(s, switched);
          s.session = { role: u.role, org: u.orgCode || code, user: u.username, name: u.displayName };
          s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
          s.selectedOrg = u.orgCode || code;
          s.impersonating = { name: u.orgName || code, role: u.role, org: u.orgCode || code, managing: true };
          s.mfaEnrollmentRequired = g.mfa; s.passwordChangeRequired = g.pw;
          s.ui.nav = "dashboard"; s.ui.notifOpen = false;
          return s;
        });
        // The tenant's admin is still held by its own gate (a brand-new
        // tenant's first director has a one-time password): show the hold.
        if (g.mfa || g.pw) { dropWs(); return u; }
        connectWs();
        return hydrate(u.role).then(function (r) { hydrateConversations(); return r; });
      })
      .catch(function (e) {
        var m = String((e && e.message) || "");
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't open org", msg: /no_admin/.test(m) ? "This org has no users yet — add one first." : "Try again." }; return s; });
      });
  };

  DT.actions.runDiagnostics = function () {
    api("GET", "/api/dev/ai-diagnostics").then(function (d) {
      DT.set(function (s) {
        s.diagnostics = {
          text: "Extractor " + (d.extractor || "?") + " · live AI " + (d.liveAi ? "enabled" : "stub (no key)") +
            (d.sample ? " · sample → " + d.sample.initials + ", " + d.sample.specialty : ""),
        };
        s.__toast = { tone: "accepted", title: "Diagnostics complete", msg: "AI extractor checked." };
        return s;
      });
    }).catch(function () {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Diagnostics failed", msg: "Could not reach the extractor." }; return s; });
    });
  };

  // developer — organization CRUD
  DT.actions.addTenant = function (form) {
    api("POST", "/api/dev/organizations", {
      name: form.name, code: form.code || undefined,
      city: form.city, state: form.state, timezone: form.timezone,
    }).then(function () {
      hydrateOrgs();
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Organization created", msg: form.name + " provisioned." }; return s; });
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not create", msg: String(e.message) === "code_taken" ? "That code is already in use." : "Create failed." }; return s; });
    });
  };
  // Persist org settings edits (name/code/timezone/city/state) from OrgSettings.
  var origUpdateOrg = DT.actions.updateOrg;
  DT.actions.updateOrg = function (code, patch) {
    if (origUpdateOrg) origUpdateOrg(code, patch); // snappy local update
    var orgs = DT.getState().orgs || [];
    var o = orgs.find(function (x) { return x.code === code; });
    var resolve = o && o.id
      ? Promise.resolve(o.id)
      : get("/api/dev/organizations").then(function (l) {
          var m = (l || []).find(function (x) { return x.code === code; });
          return m ? m.id : null;
        });
    resolve.then(function (id) {
      if (id) return api("PATCH", "/api/dev/organizations/" + id, patch).then(hydrateOrgs);
    }).catch(function (e) { console.error("[DocTurn] updateOrg failed", e); });
  };

  DT.actions.deleteTenant = function (o) {
    if (!o) return Promise.reject(new Error("No organization selected."));
    // Always resolve against the authoritative backend list by CODE (get()
    // self-heals a missing session). Never trust a local id — in demo mode the
    // ids are fabricated and could collide with real ones.
    return get("/api/dev/organizations").then(function (list) {
      var m = (list || []).find(function (x) { return String(x.code).toUpperCase() === String(o.code).toUpperCase(); });
      if (!m) {
        // The selected row was demo data (it doesn't exist on the server). We're
        // now signed in for real — swap the UI to the real org list and explain.
        hydrateOrgs();
        throw new Error("That was demo data — your real organizations are now loaded. Pick one to delete.");
      }
      // force=true cascades the org's users + all tenant data (Danger Zone has
      // already required typing the org name to confirm).
      return api("DELETE", "/api/dev/organizations/" + m.id + "?force=true");
    }).then(function () {
      // Optimistic local removal + authoritative re-hydrate.
      DT.set(function (s) {
        s.orgs = (s.orgs || []).filter(function (x) { return x.code !== o.code; });
        s.__toast = { tone: "rejected", title: "Organization deleted", msg: o.name + " removed." };
        return s;
      });
      hydrateOrgs();
      return true;
    }).catch(function (e) {
      var m = String(e && e.message);
      var msg = m === "cannot_delete_own_org" ? "You can't delete the organization your own account belongs to."
        : m === "org_not_empty" ? "This organization still has users — remove them first."
        : m === "forbidden" ? "You must be signed in as a Developer."
        : (m || "Delete failed.");
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not delete", msg: msg }; return s; });
      console.error("[DocTurn] deleteTenant failed:", e);
      throw new Error(msg);
    });
  };

  // Demo console bootstrap: a token-bearing pane skips the login screen and
  // enters directly as that token's user (same path as a successful login).
  if (DEMO_TOKEN) {
    get("/api/user").then(function (u) {
      if (u && u.locked) { engageLock({ org: u.orgCode, user: u.username, name: u.displayName, role: u.role }); return; }
      sessionConfirmed = true;
      lastAuth = { role: u.role, org: u.role === "developer" ? PLATFORM_ORG : "ISPN" };
      var switched = adoptIdentity(u.id);
      DT.set(function (s) {
        dropPreviousThreads(s, switched);
        s.session = { role: u.role, org: lastAuth.org, user: u.username, name: u.displayName };
        s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
        s.ui.nav = "dashboard"; s.ui.notifOpen = false; s.loginError = null;
        s.mfaEnrollmentRequired = !!u.mfaEnrollmentRequired;
        return s;
      });
      mfaFlagged = !!u.mfaEnrollmentRequired;
      if (u.mfaEnrollmentRequired) return; // held at the enrolment screen
      connectWs();
      if (u.role === "developer") hydrateOrgs();
      if (u.role === "developer" || u.role === "director" || u.role === "er_director") hydrateDevUsers(); // people they may manage
      hydrateBroadcasts();
      hydrate(u.role).then(function () { hydrateConversations(); });
    }).catch(function (e) { console.error("[DocTurn] demo token bootstrap failed", e); });
  }

  // Session restore on load. The store no longer persists any clinical slice
  // (PHI never touches localStorage), so a page refresh must re-establish who
  // the user is from the server's session cookie and re-fetch everything.
  // Deliberately rawApi, NOT the self-healing api(): an expired/absent session
  // must land on the login screen, never silently sign in a demo account.
  // Asks GET /api/session, which answers 200 { authenticated:false } when
  // signed out: that is the normal state of an app being opened, so a cold
  // start logs nothing (GET /api/user's 401 shows up in every browser console
  // as "Failed to load resource"). Same session semantics and user body.
  function restoreSession() {
    var savedSess = (DT.getState() && DT.getState().session) || null;
    return rawApi("GET", "/api/session").then(function (probe) {
      var u = probe && probe.authenticated ? probe.user : null;
      if (!u || u.id == null) throw new Error("no_session");
      var orgCode = u.orgCode || orgForRole(u.role, savedSess && savedSess.org);
      // The SERVER says this session is locked (A.CON-SHO-7): the lock screen
      // and nothing else — even if this browser's own lock flag is gone.
      if (u.locked) {
        engageLock({ org: orgCode, user: u.username, name: u.displayName, role: u.role });
        return;
      }
      // Locked here but not on the server (the lock call never reached it):
      // bring the server in line and boot nothing.
      if (lockActive()) { DT.actions.lockSession(0); return; }
      sessionConfirmed = true;
      localDemoSession = false;
      lastAuth = { role: u.role, org: orgCode };
      newAuthEpoch();
      // A later rehydrate can find a different person behind the shared
      // cookie (another tab signed out and in as someone else).
      var switched = adoptIdentity(u.id);
      auditLoaded = false;
      prefsLoaded = false;
      dashHydrated = false; lastDashSnap = null;
      DT.set(function (s) {
        dropPreviousThreads(s, switched);
        s.session = { role: u.role, org: orgCode, user: u.username, name: u.displayName };
        s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
        s.loginError = null;
        s.mfaChallenge = null;
        s.mfaEnrollmentRequired = !!u.mfaEnrollmentRequired;
        s.passwordChangeRequired = !!u.mustChangePassword;
        return s;
      });
      mfaFlagged = !!u.mfaEnrollmentRequired;
      pwChangeFlagged = !!u.mustChangePassword;
      if (u.mfaEnrollmentRequired) return; // held at the enrolment screen; mfaEnrollmentDone() boots the rest
      if (u.mustChangePassword) return;    // held at the change-password screen; passwordChangeDone() boots the rest
      connectWs();
      if (u.role === "developer") hydrateOrgs();
      if (u.role === "developer" || u.role === "director" || u.role === "er_director") hydrateDevUsers(); // people they may manage
      hydrateMyPrefs();
      ensurePushSubscription(); // never prompts on a reload (no user gesture) — A.CON-NEE-1
      if (u.role === "director" || u.role === "er_director" || u.role === "developer") hydrateOpsReport();
      hydrateBroadcasts();
      hydrateAwayMessage();
      hydrate(u.role).then(function () { hydrateConversations(); });
    }).catch(function () {
      // No live server session — drop the restored shell back to the login
      // screen rather than showing a signed-in UI with no data behind it.
      if (savedSess) DT.set(function (s) { s.session = null; return s; });
    });
  }
  // Lock this session on the server (A.CON-SHO-7). Called by the shell's lock
  // button / idle timer AFTER it set the lock flag; `idleMs` = how long the
  // user had already been idle (the 15-minute idle lock passes 15 min, which
  // ends the server session outright — a real automatic logoff). The socket
  // goes first so no event can trigger a fetch meanwhile. A failure (offline,
  // session already gone) leaves the local lock in place; the next restore
  // re-sends it.
  DT.actions.lockSession = function (idleMs) {
    dropSocket();
    var idle = Math.max(0, Number(idleMs) || 0);
    return rawApi("POST", "/api/session/lock", { idleMs: idle }).catch(function () { return null; });
  };
  if (!DEMO_TOKEN) restoreSession();
  // Re-run the restore on demand: the shell calls this when the app lock is
  // cleared in ANOTHER tab (index.html), whose re-authentication may have
  // replaced the session cookie while this tab's socket and clinical slices
  // went stale. Returns the restore promise.
  DT.actions.rehydrate = function () { return restoreSession(); };

  // Load public client config (synthetic-data flag + app name) before/after login
  // so the test-only banner reflects the server. Defaults to synthetic ON.
  rawApi("GET", "/api/config").then(function (cfg) {
    if (cfg) {
      serverSaidSynthetic = cfg.syntheticData === true;
      DT.set(function (s) { s.syntheticData = cfg.syntheticData !== false; return s; });
    }
  }).catch(function () { /* keep the banner default (synthetic on); serverSaidSynthetic stays false */ });

  // ==== modules: per-org feature switches (server-enforced) — BEGIN =========
  // Registry + effective map come from /api/modules (shared/modules.ts). The
  // developer console flips one switch per org via PATCH /api/dev/modules/:id;
  // the server's moduleGate answers 404 module_disabled for anything switched
  // off, so the UI hides nav/controls with DT.moduleOn(id) but never decides.
  // rawApi, not the self-healing api(): a stale saved session must never be
  // "healed" into a demo login just because this refetch got a 401.
  function hydrateModules() {
    return rawApi("GET", "/api/modules").then(function (r) {
      if (!r) return;
      DT.set(function (s) { s.modules = r.modules || {}; s.moduleRegistry = r.registry || []; return s; });
    }).catch(function () {});
  }
  function moduleOrgId(orgRef) {
    if (typeof orgRef === "number") return orgRef;
    var o = (DT.getState().orgs || []).find(function (x) { return x.code === orgRef || x.id === orgRef; });
    return o ? o.id : null;
  }
  function putOrgModules(id, map) {
    DT.set(function (s) {
      s.orgModules = Object.assign({}, s.orgModules || {});
      s.orgModules[id] = map || {};
      return s;
    });
  }
  // Developer: load one tenant's effective map into s.orgModules[orgId].
  DT.actions.loadOrgModules = function (orgRef) {
    var id = moduleOrgId(orgRef);
    if (id == null) return Promise.resolve(null);
    return get("/api/dev/modules/" + id).then(function (r) {
      putOrgModules(id, r && r.modules);
      if (r && r.registry) DT.set(function (s) { s.moduleRegistry = r.registry; return s; });
      return r && r.modules;
    });
  };
  // Developer: one click flips a switch — optimistic, then server truth.
  DT.actions.setModule = function (orgRef, moduleId, enabled) {
    var id = moduleOrgId(orgRef);
    if (id == null) return Promise.reject(new Error("unknown_org"));
    var before = (DT.getState().orgModules || {})[id] || {};
    var optimistic = Object.assign({}, before); optimistic[moduleId] = !!enabled;
    putOrgModules(id, optimistic);
    return api("PATCH", "/api/dev/modules/" + id, { id: moduleId, enabled: !!enabled }).then(function (r) {
      putOrgModules(id, r && r.modules);
      var sess = DT.getState().session;
      if (sess && moduleOrgId(sess.org) === id) hydrateModules(); // flipped our own org
      return r && r.modules;
    }).catch(function (e) {
      putOrgModules(id, before);
      DT.actions.loadOrgModules(id).catch(function () {});
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not change module", msg: (e && e.body && e.body.reason) || String((e && e.message) || e) }; return s; });
      throw e;
    });
  };
  // Components: `if (!DT.moduleOn("broadcasts")) return null;` — unknown ids and
  // a not-yet-hydrated map read as ON so nothing flickers away on first paint.
  DT.moduleOn = function (id) { var m = DT.getState().modules; return !m || m[id] !== false; };
  // Refetch whenever the signed-in identity changes (login, role switch,
  // session restore) and every minute while signed in, so a switch flipped by
  // the developer reaches an open portal without a reload.
  // Compared by REFERENCE: store.set() shallow-clones the top level, so the
  // session object only changes when a login/restore assigns a new one — which
  // also catches re-login as the same user (switches may have flipped since).
  var lastModuleSess = null;
  function syncModulesForSession() {
    var sess = DT.getState().session || null;
    if (sess === lastModuleSess) return;
    lastModuleSess = sess;
    if (sess && (sessionConfirmed || localDemoSession)) hydrateModules();
    else DT.set(function (s) { s.modules = null; s.orgModules = {}; return s; });
  }
  if (DT.subscribe) DT.subscribe(syncModulesForSession);
  // The minute poll is the ONLY periodic request the shell makes on its own, and
  // every request renews the server's 15-minute rolling session. It therefore
  // pauses while the app is locked (window.__dtLock, index.html) or the tab is
  // hidden, so an idle locked/backgrounded tab lets the server session expire
  // on schedule instead of keeping it alive indefinitely (A.CON-SHO-7). A tab
  // returning to the foreground refetches at once.
  function pollingAllowed() {
    try { if (window.__dtLock && window.__dtLock.isLocked()) return false; } catch (e) {}
    try { if (typeof document !== "undefined" && document.visibilityState === "hidden") return false; } catch (e) {}
    return true;
  }
  function pollModules() { if (DT.getState().session && sessionConfirmed && pollingAllowed()) hydrateModules(); }
  setInterval(pollModules, 60000);
  try { document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") pollModules(); }); } catch (e) {}
  // ==== modules — END =======================================================

  // ==== oncall / ehr: who's-on-call board + EHR deep links — BEGIN ==========
  // The board is server-merged (selected schedule source + consult services +
  // next hospitalist, DND → covering already applied). The MRN never reaches
  // the browser: "Open in EHR" asks the server for the resolved URL per click.
  DT.actions.loadOnCallBoard = function () {
    return get("/api/oncall/board").then(function (r) {
      DT.set(function (s) { s.onCallBoard = r || null; return s; });
      return r;
    }).catch(function (e) {
      var msg = String((e && e.message) || "unavailable");
      DT.set(function (s) { s.onCallBoard = { error: msg === "module_disabled" ? "the on-call board is switched off for this organization" : msg, rows: [] }; return s; });
      return null;
    });
  };
  DT.actions.loadOnCallSources = function () {
    return get("/api/oncall/sources").then(function (r) { DT.set(function (s) { s.onCallSources = r || null; return s; }); return r; }).catch(function () { return null; });
  };
  DT.actions.setOnCallSource = function (source) {
    return api("PATCH", "/api/oncall/source", { source: source }).then(function (r) {
      DT.set(function (s) {
        s.__toast = { tone: "accepted", title: "Schedule source: " + ({ amion: "Amion", epic: "Epic", manual: "Manual" }[source] || source), msg: r && r.status && !r.status.configured ? (r.status.message || "Not configured yet.") : "The on-call board now reads from this source." };
        return s;
      });
      return r;
    }).catch(function (e) {
      var m = String((e && e.message) || "");
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't change source", msg: m === "module_disabled" ? "That source's module is switched off for this organization." : (m || "Try again.") }; return s; });
      throw e;
    });
  };
  DT.actions.loadManualSlots = function () {
    return get("/api/oncall/manual").then(function (r) { DT.set(function (s) { s.manualOnCall = r || []; return s; }); return r; }).catch(function () { return []; });
  };
  DT.actions.addManualSlot = function (slot) {
    return api("POST", "/api/oncall/manual", slot).then(function (r) {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Slot added", msg: r.slot + " · " + r.providerName }; return s; });
      return DT.actions.loadManualSlots().then(function () { return r; });
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't add slot", msg: String((e && e.message) || "Try again.") }; return s; });
    });
  };
  DT.actions.updateManualSlot = function (id, patch) {
    return api("PATCH", "/api/oncall/manual/" + encodeURIComponent(id), patch).then(function (r) { return DT.actions.loadManualSlots().then(function () { return r; }); }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't update slot", msg: String((e && e.message) || "Try again.") }; return s; });
    });
  };
  DT.actions.removeManualSlot = function (id) {
    return api("DELETE", "/api/oncall/manual/" + encodeURIComponent(id)).then(function () { return DT.actions.loadManualSlots(); }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't remove slot", msg: String((e && e.message) || "Try again.") }; return s; });
    });
  };
  DT.actions.epicSyncNow = function () {
    return api("POST", "/api/oncall/epic/sync-now", {}).then(function (r) {
      DT.set(function (s) { s.__toast = r && r.lastStatus === "error" ? { tone: "rejected", title: "Epic sync failed", msg: r.error || "See the board's source status." } : { tone: "accepted", title: "Epic synced", msg: (r && r.rowCount) + " on-call rows." }; return s; });
      return r;
    }).catch(function (e) {
      var m = String((e && e.message) || "");
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Epic not synced", msg: m === "epic_not_configured" ? "Needs Epic app credentials (App Orchard/Vendor Services registration) on the server." : m === "module_disabled" ? "Epic on-call is switched off for this organization." : (m || "Try again.") }; return s; });
      return null;
    });
  };
  // Message whoever actually answers for a board row (the covering provider
  // when the holder is on DND). Reuses the role-conversation flow so the thread
  // is named after the role, then jumps to Messages.
  DT.actions.messageOnCallRow = function (row) {
    if (!row || !row.messageable || row.messageUserId == null) return Promise.resolve();
    var label = row.label + (row.covering ? " · covering: " + row.covering.name : "");
    return Promise.resolve(DT.actions.startRoleConversation({ userId: row.messageUserId, label: label })).then(function () {
      DT.set(function (s) { s.ui.nav = "messages"; return s; });
    });
  };
  // EHR deep links (org setting "ehrDeepLink": vendor + template; presets from the server).
  var ehrConfigInflight = null; // many patient rows mount at once — one fetch serves them all
  DT.actions.loadEhrConfig = function () {
    if (ehrConfigInflight) return ehrConfigInflight;
    DT.set(function (s) { if (s.ehrConfig === undefined) s.ehrConfig = null; return s; });
    ehrConfigInflight = get("/api/ehr/config").then(function (r) { DT.set(function (s) { s.ehrConfig = r || null; return s; }); return r; })
      .catch(function () { return null; })
      .finally(function () { ehrConfigInflight = null; });
    return ehrConfigInflight;
  };
  DT.actions.saveEhrConfig = function (vendor, template) {
    return api("PATCH", "/api/ehr/config", { vendor: vendor, template: template || "" }).then(function (r) {
      DT.set(function (s) { s.ehrConfig = Object.assign({}, s.ehrConfig || {}, r || {}); s.__toast = { tone: "accepted", title: "EHR link saved", msg: r && r.configured ? "\"Open in EHR\" is now available on patient rows." : (template ? "Template stored — replace the placeholder host to activate it." : "EHR deep links cleared.") }; return s; });
      return r;
    }).catch(function (e) {
      var m = String((e && e.message) || "");
      var why = { template_missing_placeholder: "The template must contain {ehrId}.", template_scheme: "That URL scheme isn't allowed.", template_whitespace: "The template can't contain spaces.", template_required: "Enter a template." }[m] || (m || "Try again.");
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "EHR link not saved", msg: why }; return s; });
      throw e;
    });
  };
  DT.actions.openInEhr = function (patientId) {
    if (patientId == null) return Promise.resolve();
    // Open the window synchronously (popup blockers), then point it at the URL
    // the server resolves. Custom schemes (epichaiku://) navigate in place.
    var win = null;
    try { win = window.open("", "_blank", "noopener"); } catch (e) { win = null; }
    return get("/api/patients/" + Number(patientId) + "/ehr-link").then(function (r) {
      var url = r && r.url;
      if (!url) throw new Error("no_link");
      if (/^https?:/i.test(url)) { if (win) win.location.href = url; else window.open(url, "_blank", "noopener"); }
      else { if (win) { try { win.close(); } catch (e) {} } window.location.assign(url); }
    }).catch(function (e) {
      if (win) { try { win.close(); } catch (_) {} }
      var m = String((e && e.message) || "");
      var msg = m === "no_ehr_id" ? "No EHR id (MRN) on file for this patient." : m === "forbidden" ? "Only the patient's care team can open their chart." : m === "ehr_not_configured" ? "Ask a director to set the EHR link template in Settings." : m === "module_disabled" ? "EHR deep links are switched off for this organization." : "Couldn't open the chart.";
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Open in EHR", msg: msg }; return s; });
    });
  };
  // ==== oncall / ehr — END ==================================================

  // ==== integrations: Settings → Integrations (server-enforced) — BEGIN =====
  // Every card, switch and test result is the server's answer
  // (/api/integrations, server/integrations/registry.ts). Nothing about an
  // integration is decided or remembered in the browser: there is no local
  // "Connected" flag any more. Errors carry the server's reason through.
  function integrationsQuery(orgId) {
    return orgId != null && orgId !== "" ? "?orgId=" + encodeURIComponent(orgId) : "";
  }
  function serverError(e) {
    return String((e && e.message) || "unavailable");
  }
  // api() with the server's reason / invalid field lifted onto the error.
  function apiWithBody(method, path, body) {
    return api(method, path, body).catch(function (e) {
      var d = (e && e.body) || {};
      if (e) { e.detail = d.message || d.reason || null; e.field = d.field || null; }
      throw e;
    });
  }
  function refreshOwnModules(orgId) {
    var sess = DT.getState().session;
    if (orgId == null || (sess && moduleOrgId(sess.org) === Number(orgId))) hydrateModules();
  }
  DT.actions.loadIntegrations = function (orgId) {
    return get("/api/integrations" + integrationsQuery(orgId));
  };
  // The signed-in user's OWN organization as the server knows it (Settings
  // header for every non-developer role) — never the demo store's org list.
  DT.actions.loadOrgIdentity = function () {
    return get("/api/org/config").then(function (r) {
      var id = r && r.code ? { name: r.name || r.code, code: r.code, timezone: r.timezone || "" } : null;
      DT.set(function (s) { s.orgIdentity = id; return s; });
      return id;
    }).catch(function () { return null; });
  };
  DT.actions.loadIntegrationsOverview = function () {
    return get("/api/dev/integrations");
  };
  DT.actions.setIntegrationEnabled = function (id, enabled, orgId) {
    return apiWithBody("PATCH", "/api/integrations/" + encodeURIComponent(id) + integrationsQuery(orgId), { enabled: !!enabled }).then(function (r) {
      var c = r && r.integration;
      refreshOwnModules(orgId);
      DT.set(function (s) {
        s.__toast = { tone: enabled ? "accepted" : "sent", title: (c ? c.name : id) + (enabled ? " switched on" : " switched off"), msg: c ? c.statusText : "" };
        return s;
      });
      return r;
    }).catch(function (e) {
      DT.set(function (s) {
        s.__toast = { tone: "rejected", title: enabled ? "Can't switch it on yet" : "Couldn't switch it off", msg: e.detail || serverError(e) };
        return s;
      });
      throw e;
    });
  };
  DT.actions.testIntegration = function (id, orgId) {
    return apiWithBody("POST", "/api/integrations/" + encodeURIComponent(id) + "/test" + integrationsQuery(orgId), {}).then(function (r) {
      DT.set(function (s) {
        s.__toast = r && r.ok
          ? { tone: "accepted", title: "Test passed", msg: r.message }
          : { tone: "rejected", title: "Test failed", msg: (r && r.message) || "The connection did not work." };
        return s;
      });
      return r;
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Nothing to test yet", msg: e.detail || serverError(e) }; return s; });
      return null;
    });
  };
  DT.actions.saveIntegrationCredentials = function (id, values, orgId) {
    // Values are sent once over TLS and never kept in the store.
    return apiWithBody("PUT", "/api/integrations/" + encodeURIComponent(id) + "/credentials" + integrationsQuery(orgId), values || {}).then(function (r) {
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "Saved (encrypted)", msg: r && r.integration ? r.integration.statusText : "" }; return s; });
      return r;
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Not saved", msg: e.detail || serverError(e) }; return s; });
      throw e;
    });
  };
  DT.actions.clearIntegrationCredentials = function (id, orgId) {
    return apiWithBody("DELETE", "/api/integrations/" + encodeURIComponent(id) + "/credentials" + integrationsQuery(orgId)).then(function (r) {
      DT.set(function (s) { s.__toast = { tone: "sent", title: "Credentials removed", msg: r && r.integration ? r.integration.statusText : "" }; return s; });
      return r;
    }).catch(function (e) {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't remove them", msg: e.detail || serverError(e) }; return s; });
      throw e;
    });
  };
  // ==== integrations — END ==================================================

  console.log("[DocTurn] live API bridge active — actions wired to /api");
})();
