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
  var meId = null;   // current user's backend id (for messaging "me" / participants)
  var auditLoaded = false; // fetch the per-org audit trail once per context, then only while viewing Compliance
  var prefsLoaded = false; // load per-org consult catalog + theme once per context (later rehydrates keep local edits)
  // Demo console: when loaded as an iframe pane with ?token=<t>, this pane
  // authenticates with that bearer token instead of the shared session cookie,
  // so three users can run side by side in one browser. Null for normal use.
  var DEMO_TOKEN = (function () { try { return new URLSearchParams(window.location.search).get("token"); } catch (e) { return null; } })();
  var ws = null;     // live WebSocket for real-time messages + assignment events
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

  // Remember the active role/org so we can transparently re-authenticate if the
  // server session goes away (15-min idle expiry, OR a dev-server restart that
  // wipes the in-memory session store). Set on every successful doLogin.
  var lastAuth = null;

  function rawApi(method, path, body) {
    var headers = body ? { "Content-Type": "application/json" } : {};
    if (DEMO_TOKEN) headers["Authorization"] = "Bearer " + DEMO_TOKEN;
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: (body || DEMO_TOKEN) ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (t) {
        var d = null;
        if (t) { try { d = JSON.parse(t); } catch (e) { d = { error: t.slice(0, 120) }; } }
        if (!r.ok) {
          var err = new Error((d && d.error) || r.statusText || ("HTTP " + r.status));
          err.status = r.status;
          throw err;
        }
        return d;
      });
    });
  }

  // Which role/org to (re)authenticate as: a confirmed prior login if we have
  // one, otherwise the role the UI is currently showing — so even a session that
  // never really logged in (demo fallback after a transient server hiccup) can
  // be promoted to a real session on demand.
  function authHint() {
    if (lastAuth) return lastAuth;
    var sess = (DT.getState && DT.getState().session) || null;
    if (sess && sess.role) return { role: sess.role, org: orgForRole(sess.role, sess.org) };
    return null;
  }

  // Self-healing wrapper: on a 401 (no/expired session), re-authenticate as the
  // active role once and retry — so a session that died mid-use, or never
  // established, doesn't surface as a dead "unauthorized" button. Never recurses
  // on the login call itself.
  function api(method, path, body) {
    return rawApi(method, path, body).catch(function (e) {
      var is401 = e && (e.status === 401 || String(e.message) === "unauthorized");
      var hint = authHint();
      // Token-mode panes authenticate by bearer token, not a re-loginable cookie
      // session, so don't attempt the cookie self-heal there.
      if (is401 && hint && path !== "/api/login" && !DEMO_TOKEN) {
        return rawApi("POST", "/api/login", {
          orgCode: hint.org, username: DEMO[hint.role] || "chen", password: "docturn",
        }).then(function () { lastAuth = hint; return rawApi(method, path, body); });
      }
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
      var sameDay = d.toDateString() === now.toDateString();
      var day = sameDay ? "Today" : (d.toDateString() === new Date(now.getTime() - 86400000).toDateString() ? "Yesterday" : d.toLocaleDateString());
      return {
        id: "as" + a.id, backendId: a.id, patientId: a.patientId,
        initials: a.initials, provider: a.provider, complaint: a.complaint,
        consultants: [], acuity: a.acuity || null,
        time: day + " · " + fmt.hhmm(d.getTime()), day: day,
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
    return Promise.all([
      get("/api/hospitalists").catch(function () { return null; }),
      // directory is readable by every role and carries provider names; /api/users
      // is director-only, so we derive names from the directory instead.
      get("/api/physicians/directory").catch(function () { return null; }),
      get("/api/patients").catch(function () { return null; }),
    ]).then(function (res) {
      var hosps = res[0], directory = res[1], patients = res[2];
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
      extra.push(get("/api/patient-board").catch(function () { return null; }));
      // ER roles: their live "sent" board (declines / re-routes / accepts).
      var wantsSent = (role === "er_doctor" || role === "er_director");
      extra.push(wantsSent ? get("/api/assignments/sent").catch(function () { return null; }) : Promise.resolve(null));
      // Director: org settings (auto-reassign-on-decline toggle).
      extra.push(role === "director" ? get("/api/settings").catch(function () { return null; }) : Promise.resolve(null));
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

      return Promise.all(extra).then(function (e) {
        var pending = e[0], mine = e[1], board = e[2], sent = e[3], settings = e[4], regs = e[5], auditData = e[6], orgCfg = e[7];
        DT.set(function (s) {
          if (hosps && users) s.providers = mapProviders(hosps, usersById);
          // Full registered directory (all roles): drives the ER Consult-services
          // roster + midlevel pool from real people, not hardcoded lists.
          if (directory) s.directory = (directory || []).map(function (d) {
            return { id: d.userId, name: d.displayName, avatar: initials(d.displayName), specialty: d.specialty || "", credential: d.credential || "", working: !!d.working, shift: d.shiftType || "" };
          });
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
          if (settings && settings.org) s.settings = Object.assign({}, s.settings, { autoReassign: !!settings.org.autoReassignOnDecline });
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
  function nameForUserId(uid) {
    var d = (DT.getState().directory || []).find(function (x) { return x.id === uid; });
    return d ? d.name : null;
  }
  function dirByUserId(uid) {
    return (DT.getState().directory || []).find(function (x) { return x.id === uid; }) || null;
  }
  function mapMessage(m) {
    return { id: m.id, me: m.senderId === meId, text: m.content, at: new Date(m.createdAt || Date.now()).getTime(), read: true };
  }
  // Pull the user's conversations + their messages from the backend into the
  // kit's conversation shape. Shared server state → both devices see the same.
  function hydrateConversations() {
    return get("/api/messaging/conversations").then(function (convos) {
      return Promise.all((convos || []).map(function (c) {
        return get("/api/messaging/conversations/" + c.id + "/messages")
          .then(function (msgs) { return { c: c, msgs: msgs || [] }; })
          .catch(function () { return { c: c, msgs: [] }; });
      })).then(function (rows) {
        DT.set(function (s) {
          s.conversations = rows.map(function (row) {
            var c = row.c;
            var others = (c.participantIds || []).filter(function (id) { return id !== meId; });
            var dirOther = others.length ? dirByUserId(others[0]) : null;
            var nm = c.name || (others.length === 1 ? (nameForUserId(others[0]) || "Conversation") : "Group conversation");
            return {
              id: c.id,
              name: nm,
              role: c.type === "emergency" ? "Code · all providers" : (c.type === "group" ? ("Group · " + (c.participantIds || []).length + " members") : ((dirOther && dirOther.specialty) || "Provider")),
              initials: initials(nm),
              presence: (dirOther && dirOther.working) ? "online" : "offline",
              tint: c.type === "emergency" ? "slate" : (c.type === "group" ? "blue" : "emerald"),
              unread: c.unreadCount || 0,
              group: c.type === "group",
              broadcast: c.type === "emergency",
              typing: false,
              participantIds: c.participantIds || [],
              messages: (row.msgs || []).map(mapMessage),
            };
          });
          return s;
        });
      });
    }).catch(function () { /* keep whatever's there on failure */ });
  }

  // ---- live WebSocket ------------------------------------------------------
  // Cookie-authenticated socket at /ws. Refreshes messaging on MESSAGE_RECEIVED
  // and the role's data on assignment/board/broadcast events, so a second device
  // updates live without a manual refresh.
  function connectWs() {
    try { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; } } catch (e) {}
    if (typeof WebSocket === "undefined" || typeof location === "undefined") return;
    try {
      var proto = location.protocol === "https:" ? "wss:" : "ws:";
      var wsUrl = proto + "//" + location.host + "/ws" + (DEMO_TOKEN ? ("?token=" + encodeURIComponent(DEMO_TOKEN)) : "");
      var sock = new WebSocket(wsUrl);
      ws = sock;
      sock.onmessage = function (e) {
        var ev; try { ev = JSON.parse(e.data); } catch (_) { return; }
        if (!ev || !ev.type) return;
        if (ev.type === "MESSAGE_RECEIVED") hydrateConversations();
        else if (ev.type === "ASSIGNMENT_CREATED" || ev.type === "ASSIGNMENT_UPDATED" || ev.type === "PATIENT_BOARD_UPDATED" || ev.type === "BROADCAST_SENT") rehydrate();
      };
      sock.onclose = function () { if (ws === sock) ws = null; if (DT.getState().session) setTimeout(connectWs, 3000); };
      sock.onerror = function () { try { sock.close(); } catch (e) {} };
    } catch (e) { /* WS unavailable — messaging still works via fetch on actions */ }
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

  function doLogin(role, org, user) {
    var username = DEMO[role] || user || "chen";
    var primary = orgForRole(role, org);
    var canonical = canonicalOrg(role);

    function finish(u, orgCode) {
      lastAuth = { role: u.role, org: orgForRole(u.role, org) }; // enable self-healing re-auth
      meId = u.id;
      auditLoaded = false; // new login context → reload that org's audit on first hydrate
      prefsLoaded = false;
      DT.set(function (s) {
        s.session = { role: u.role, org: orgCode, user: u.username, name: u.displayName };
        s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
        s.ui.nav = "dashboard";
        s.ui.notifOpen = false;
        s.loginError = null;
        return s;
      });
      connectWs();
      if (u.role === "developer") { hydrateOrgs(); hydrateDevUsers(); }
      return hydrate(u.role).then(function (r) { hydrateConversations(); return r; });
    }
    function attempt(orgCode) {
      return rawApi("POST", "/api/login", { orgCode: orgCode, username: username, password: "docturn" })
        .then(function () { return get("/api/user"); })
        .then(function (u) { return finish(u, orgCode); });
    }

    return attempt(primary).catch(function (e) {
      // Demo resilience: a wrong/stale org code (cached "MERCY") shouldn't block
      // sign-in — retry once with the role's canonical demo org.
      if (!isNetworkError(e) && primary !== canonical) return attempt(canonical);
      throw e;
    });
  }

  // Distinguish "backend unreachable" (fetch rejects with a TypeError) from
  // "backend rejected the credentials" (HTTP 4xx → Error from api()). For the
  // former we silently fall back to the demo UI; for the latter we keep the user
  // on the login screen and tell them WHY — almost always a missing demo account
  // (DB seeded before that role existed), fixed by re-running `npm run seed`.
  function isNetworkError(e) {
    // A real fetch transport failure (server down/unreachable). Match by message
    // because `instanceof TypeError` is unreliable across realms.
    return (e && e.name === "TypeError") ||
      /Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|ERR_NETWORK|load failed/i.test(String(e && e.message));
  }

  DT.actions.login = function (role, org, user) {
    // Return the promise so callers that await login wait for hydrate to finish
    // (session + per-org prefs settled) before acting.
    return doLogin(role, org, user).catch(function (e) {
      if (isNetworkError(e)) {
        // Server down → demo login so the UI is still explorable offline.
        origLogin(role, org, user);
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Offline — demo mode", msg: "Backend unreachable; showing demo data." }; return s; });
        return;
      }
      // Server reachable but login failed (bad/missing account or org code).
      var why = String((e && e.message) || "");
      var msg = /credential/i.test(why) ? "Wrong account/password for this role."
        : /organization|not.?found/i.test(why) ? "That organization code wasn't found — try org code ISPN."
        : "Run \"npm run seed\" to create the demo accounts.";
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
    var org = (st.session && st.session.org) || "ISPN";
    if (st.impersonating) DT.set(function (s) { s.impersonating = null; return s; }); // leaving the impersonated portal
    doLogin(role, org).catch(function (e) {
      if (isNetworkError(e)) {
        if (origSetRole) origSetRole(role);
        return;
      }
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not switch role", msg: "That role's account is missing — run \"npm run seed\"." }; return s; });
      console.error("[DocTurn] setRole failed:", e);
    });
  };

  DT.actions.accept = function (id) {
    api("PATCH", "/api/assignments/" + id + "/accept").then(rehydrate).catch(function () {});
    DT.set(function (s) {
      var p = (s.pending || []).find(function (x) { return x.id === id; });
      if (p) s.myAdmissions = [{ id: "ma" + id, at: Date.now(), patientId: p.patientId, initials: p.initials, room: p.room, complaint: p.complaint, consultants: [] }].concat(s.myAdmissions || []);
      s.pending = (s.pending || []).filter(function (x) { return x.id !== id; }); // drop from Incoming immediately
      s.__toast = { tone: "accepted", title: "Assignment accepted", msg: "Added to your census." };
      return s;
    });
  };
  // Request a consult on a patient — available to hospitalists, directors and ER
  // (the backend allows all of them). Optimistically tags the patient everywhere
  // they appear, then re-hydrates from the server.
  DT.actions.requestConsult = function (patientId, specialty) {
    if (patientId == null || !specialty) return;
    var pid = bid(patientId);
    api("POST", "/api/patients/" + pid + "/consults", { specialty: specialty }).then(rehydrate).catch(function (e) {
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
  DT.actions.decline = function (id) {
    api("PATCH", "/api/assignments/" + id + "/reject").then(rehydrate).catch(function () {});
    DT.set(function (s) {
      s.pending = (s.pending || []).filter(function (x) { return x.id !== id; }); // drop from Incoming immediately
      s.__toast = { tone: "rejected", title: "Declined — re-routing", msg: "Sent to the next provider." };
      return s;
    });
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

  // Persist the director's "auto-reassign on decline" toggle to the org settings
  // (other settings stay local to the kit).
  var origSetSetting = DT.actions.setSetting;
  DT.actions.setSetting = function (key, value) {
    if (key === "autoReassign") {
      api("PATCH", "/api/settings/org", { key: "autoReassignOnDecline", value: !!value }).catch(function () {});
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

  // Logout: tear down the live socket + clear the server session too.
  var origLogout = DT.actions.logout;
  DT.actions.logout = function () {
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    meId = null;
    rawApi("POST", "/api/logout", {}).catch(function () {});
    if (origLogout) origLogout();
  };

  // ---- messaging overrides (backend-backed, cross-device) ------------------
  var origStartConversation = DT.actions.startConversation;
  DT.actions.openConversation = function (id) {
    var convo = (DT.getState().conversations || []).find(function (c) { return c.id === id; });
    DT.set(function (s) { s.conversations = (s.conversations || []).map(function (c) { return c.id === id ? Object.assign({}, c, { unread: 0 }) : c; }); s.__activeConvo = id; return s; });
    if (convo) {
      var ids = (convo.messages || []).filter(function (m) { return !m.me && m.id; }).map(function (m) { return m.id; });
      if (ids.length) api("POST", "/api/messaging/messages/mark-read", { messageIds: ids }).catch(function () {});
    }
  };
  DT.actions.sendMessage = function (id, text) {
    if (!text || !text.trim()) return;
    var t = text.trim();
    DT.set(function (s) {
      s.conversations = (s.conversations || []).map(function (c) {
        return c.id === id ? Object.assign({}, c, { messages: (c.messages || []).concat([{ id: "tmp" + Date.now(), me: true, text: t, at: Date.now(), read: true }]), unread: 0 }) : c;
      });
      return s;
    });
    api("POST", "/api/messaging/send", { conversationId: Number(id), content: t })
      .then(function () { hydrateConversations(); })
      .catch(function () { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Message not sent", msg: "Couldn't reach the server." }; return s; }); });
  };
  DT.actions.startConversation = function (participant) {
    var other = (DT.getState().directory || []).find(function (d) { return d.name === participant.name; });
    if (!other || meId == null) { if (origStartConversation) origStartConversation(participant); return; } // not a registered user → local only
    return get("/api/messaging/conversations").then(function (convos) {
      var existing = (convos || []).find(function (c) { return c.type === "direct" && (c.participantIds || []).indexOf(other.id) >= 0 && (c.participantIds || []).indexOf(meId) >= 0; });
      if (existing) {
        return hydrateConversations().then(function () { DT.set(function (s) { s.__activeConvo = existing.id; s.conversations = (s.conversations || []).map(function (c) { return c.id === existing.id ? Object.assign({}, c, { unread: 0 }) : c; }); return s; }); });
      }
      return api("POST", "/api/messaging/conversations", { type: "direct", participantIds: [other.id] }).then(function (convo) {
        return hydrateConversations().then(function () { DT.set(function (s) { s.__activeConvo = convo.id; return s; }); });
      });
    }).catch(function () { if (origStartConversation) origStartConversation(participant); });
  };

  DT.actions.sendAssignment = function (provider, fields, consults) {
    var mode = (DT.nextUp() && provider.id === DT.nextUp().id) ? "round_robin" : "manual";
    var sentId = "s" + Date.now();
    var admId = "ad-" + sentId;
    api("POST", "/api/patients", {
      initials: fields.initials, roomNumber: fields.room, issueSummary: fields.complaint, specialty: fields.specialty,
      acuity: fields.acuity || undefined,
    }).then(function (p) {
      return api("POST", "/api/assignments", { patientId: p.id, mode: mode, hospitalistId: bid(provider.id) });
    }).then(rehydrate).catch(function (e) {
      // Network failure → keep the optimistic row (offline demo mode). But a
      // server REJECTION (e.g. this tab's session is signed in as a different
      // role because two tabs in one browser share a cookie) must NOT look like
      // success: undo the optimistic row and tell the user what happened.
      if (isNetworkError(e)) return;
      var why = String((e && e.message) || "");
      DT.set(function (s) {
        s.sent = (s.sent || []).filter(function (x) { return x.id !== sentId; });
        s.admissions = (s.admissions || []).filter(function (x) { return x.id !== admId; });
        s.__toast = { tone: "rejected", title: "Couldn't send assignment",
          msg: /forbidden|role|unauthor/i.test(why)
            ? "This tab isn't signed in as an ER physician. Two tabs in one browser share a login — use a separate browser or device per user."
            : (/no.?provider/i.test(why) ? "No eligible hospitalist is on shift to receive this." : "The server rejected this admission — please retry.") };
        return s;
      });
    });
    DT.set(function (s) {
      s.sent = [{ id: sentId, initials: fields.initials, provider: provider.name, complaint: fields.complaint, consultants: consults || [], acuity: fields.acuity || 3, time: "Today · " + fmt.clockLabel(), day: "Today", status: "sent" }].concat(s.sent);
      // append to the admissions log (every admission given to a team)
      s.admissions = [{ id: admId, at: Date.now(), initials: fields.initials, room: fields.room || "—", provider: provider.name, specialty: fields.specialty || "General Medicine", acuity: fields.acuity || 3, via: mode === "round_robin" ? "Round-robin" : "Manual", status: "sent" }].concat(s.admissions || []);
      s.__toast = { tone: "sent", title: "Assignment sent to " + provider.name, msg: "Notified by push, SMS fallback." };
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
    api("POST", "/api/round-robin/reset").catch(function () {});
    DT.set(function (s) { s.__toast = { tone: "accepted", title: "Rotation index reset", msg: "Round-robin restarts from the top." }; return s; });
  };
  DT.actions.addProvider = function (data) {
    var name = (data.name || "").trim();
    if (!name) return;
    var uname = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 20) || ("dr" + Date.now());
    api("POST", "/api/director/hospitalists", {
      username: uname, password: "docturn", displayName: name,
      specialty: data.specialty || "Hospital Medicine", patientCap: parseInt(data.cap, 10) || 12,
      shiftType: data.shift || "day", role: "hospitalist",
    }).then(rehydrate).catch(function () {});
    DT.set(function (s) { s.__toast = { tone: "accepted", title: "Provider added", msg: name + " added to the group." }; return s; });
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
      return api("POST", "/api/director/hospitalists", {
        username: unameFor(p.name), password: "docturn", displayName: p.name,
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

  // Developer: hydrate real cross-tenant users into the kit's devUsers shape.
  function hydrateDevUsers() {
    return get("/api/dev/users").then(function (users) {
      DT.set(function (s) {
        s.devUsers = (users || []).map(function (u) {
          return { id: u.id, name: u.name, role: u.role, org: u.org, specialty: u.specialty || "", credential: u.credential || "", scope: u.role === "developer" ? "root" : "local" };
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
    }).then(function () {
      hydrateDevUsers(); hydrateOrgs();
      DT.set(function (s) { s.__toast = { tone: "accepted", title: "User created", msg: form.name + " added to " + form.org + "." }; return s; });
    }).catch(function () {
      DT.set(function (s) { s.__toast = { tone: "rejected", title: "Could not create user", msg: "Check the form and try again." }; return s; });
    });
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
  // developer ROOT access — open any user's portal (audited session swap) to
  // see exactly what they see and fix things in place.
  DT.actions.impersonate = function (user) {
    if (!user || user.id == null) return;
    if (user.role === "developer") { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Can't impersonate", msg: "Pick a non-developer account." }; return s; }); return; }
    return api("POST", "/api/dev/impersonate", { userId: Number(user.id) })
      .then(function () { return get("/api/user"); })
      .then(function (u) {
        meId = u.id;
        auditLoaded = false;
        prefsLoaded = false;
        DT.set(function (s) {
          s.session = { role: u.role, org: user.org || s.selectedOrg, user: u.username, name: u.displayName };
          s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
          s.impersonating = { name: u.displayName, role: u.role, org: user.org || s.selectedOrg };
          s.ui.nav = "dashboard"; s.ui.notifOpen = false;
          return s;
        });
        connectWs();
        return hydrate(u.role).then(function (r) { hydrateConversations(); return r; });
      })
      .catch(function () { DT.set(function (s) { s.__toast = { tone: "rejected", title: "Couldn't open portal", msg: "Impersonation failed." }; return s; }); });
  };
  DT.actions.stopImpersonating = function () {
    return doLogin("developer").then(function () {
      DT.set(function (s) { s.impersonating = null; return s; });
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
        meId = u.id;
        auditLoaded = false;
        prefsLoaded = false;
        DT.set(function (s) {
          s.session = { role: u.role, org: u.orgCode || code, user: u.username, name: u.displayName };
          s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
          s.selectedOrg = u.orgCode || code;
          s.impersonating = { name: u.orgName || code, role: u.role, org: u.orgCode || code, managing: true };
          s.ui.nav = "dashboard"; s.ui.notifOpen = false;
          return s;
        });
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
      lastAuth = { role: u.role, org: u.role === "developer" ? PLATFORM_ORG : "ISPN" };
      meId = u.id;
      DT.set(function (s) {
        s.session = { role: u.role, org: lastAuth.org, user: u.username, name: u.displayName };
        s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD", id: u.id };
        s.ui.nav = "dashboard"; s.ui.notifOpen = false; s.loginError = null;
        return s;
      });
      connectWs();
      if (u.role === "developer") { hydrateOrgs(); hydrateDevUsers(); }
      hydrate(u.role).then(function () { hydrateConversations(); });
    }).catch(function (e) { console.error("[DocTurn] demo token bootstrap failed", e); });
  }

  console.log("[DocTurn] live API bridge active — actions wired to /api");
})();
