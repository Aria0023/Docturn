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

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (t) {
        var d = t ? JSON.parse(t) : null;
        if (!r.ok) throw new Error((d && d.error) || r.statusText);
        return d;
      });
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
        initials: p.initials || "??",
        room: p.roomNumber || "—",
        complaint: p.issueSummary || "",
        from: (er.displayName || "ER") + " (ER)",
        specialty: p.specialty || "General Medicine",
        via: a.via === "manual" ? "Manual" : "Round-robin",
        expiresAt: a.expiresAt ? new Date(a.expiresAt).getTime() : Date.now() + 600000,
      };
    });
  }
  function mapAccepted(assignments, patientsById) {
    return (assignments || []).map(function (a) {
      var p = patientsById[a.patientId] || {};
      return { id: "p" + a.id, initials: p.initials || "??", room: p.roomNumber || "—", complaint: p.issueSummary || "" };
    });
  }
  function mapBoard(rows) {
    return (rows || []).map(function (r) {
      return {
        id: "b" + r.patient.id,
        initials: r.patient.initials,
        room: r.patient.room || "—",
        dept: r.patient.department || "MED",
        issue: r.patient.issue || "",
        status: r.patient.status || r.status,
        attending: r.responsible && r.responsible.attending
          ? { name: r.responsible.attending.displayName, avatar: initials(r.responsible.attending.displayName) }
          : { name: "", avatar: "" },
        unit: (r.responsible && r.responsible.unit ? r.responsible.unit : []).map(function (u) {
          return { avatar: initials(u.displayName), role: u.credential || "" };
        }),
        consultants: r.consultants || [],
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
      if (role === "hospitalist") {
        extra.push(get("/api/assignments/pending").catch(function () { return []; }));
        extra.push(get("/api/assignments/my").catch(function () { return []; }));
      } else {
        extra.push(Promise.resolve([]));
        extra.push(Promise.resolve([]));
      }
      extra.push(get("/api/patient-board").catch(function () { return null; }));

      return Promise.all(extra).then(function (e) {
        var pending = e[0], mine = e[1], board = e[2];
        DT.set(function (s) {
          if (hosps && users) s.providers = mapProviders(hosps, usersById);
          if (role === "hospitalist") {
            s.pending = mapPending(pending, patientsById, usersById);
            s.myPatients = mapAccepted(mine, patientsById);
          }
          if (board) s.board = mapBoard(board);
          return s;
        });
      });
    }).catch(function () { /* keep demo data on any failure */ });
  }
  function rehydrate() {
    var st = DT.getState();
    return hydrate(st.session && st.session.role);
  }

  // Developer: hydrate real organizations into the kit's org shape.
  function hydrateOrgs() {
    return get("/api/dev/organizations").then(function (orgs) {
      DT.set(function (s) {
        s.orgs = (orgs || []).map(function (o) {
          return {
            id: o.id, code: o.code, name: o.name,
            city: o.city, state: o.state, timezone: o.timezone,
            users: o.userCount || 0, assignments: 0, active: true,
          };
        });
        if (s.orgs.length && !s.orgs.some(function (o) { return o.code === s.selectedOrg; })) {
          s.selectedOrg = s.orgs[0].code;
        }
        return s;
      });
    }).catch(function () {});
  }

  // ---- action overrides ----------------------------------------------------
  // Real authentication for both first login and the topbar role switcher, so
  // the SERVER session always matches the role shown in the UI (otherwise dev
  // endpoints 403 and CRUD operates on demo data with no real ids).
  function doLogin(role, org, user) {
    var username = DEMO[role] || user || "chen";
    return api("POST", "/api/login", { orgCode: org || "MERCY", username: username, password: "docturn" })
      .then(function () { return get("/api/user"); })
      .then(function (u) {
        DT.set(function (s) {
          s.session = { role: u.role, org: org || "MERCY", user: u.username, name: u.displayName };
          s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD" };
          s.ui.nav = "dashboard";
          s.ui.notifOpen = false;
          return s;
        });
        if (u.role === "developer") { hydrateOrgs(); hydrateDevUsers(); }
        return hydrate(u.role);
      });
  }

  DT.actions.login = function (role, org, user) {
    doLogin(role, org, user).catch(function () {
      // Backend unreachable / no such account → demo login so UI still works.
      origLogin(role, org, user);
    });
  };

  // The role switcher must re-authenticate as that role's demo account, not just
  // flip the local role (which would leave the server session unchanged).
  var origSetRole = DT.actions.setRole;
  DT.actions.setRole = function (role) {
    var st = DT.getState();
    var org = (st.session && st.session.org) || "MERCY";
    doLogin(role, org).catch(function () {
      if (origSetRole) origSetRole(role);
    });
  };

  DT.actions.accept = function (id) {
    api("PATCH", "/api/assignments/" + id + "/accept").then(rehydrate).catch(function () {});
    DT.set(function (s) { s.__toast = { tone: "accepted", title: "Assignment accepted", msg: "Added to your census." }; return s; });
  };
  DT.actions.decline = function (id) {
    api("PATCH", "/api/assignments/" + id + "/reject").then(rehydrate).catch(function () {});
    DT.set(function (s) { s.__toast = { tone: "rejected", title: "Declined — re-routing", msg: "Sent to the next provider." }; return s; });
  };

  DT.actions.sendAssignment = function (provider, fields, consults) {
    var mode = (DT.nextUp() && provider.id === DT.nextUp().id) ? "round_robin" : "manual";
    api("POST", "/api/patients", {
      initials: fields.initials, roomNumber: fields.room, issueSummary: fields.complaint, specialty: fields.specialty,
    }).then(function (p) {
      return api("POST", "/api/assignments", { patientId: p.id, mode: mode, hospitalistId: bid(provider.id) });
    }).then(rehydrate).catch(function () {});
    DT.set(function (s) {
      s.sent = [{ id: "s" + Date.now(), initials: fields.initials, provider: provider.name, complaint: fields.complaint, consultants: consults || [], time: "Today · " + fmt.clockLabel(), day: "Today", status: "sent" }].concat(s.sent);
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

  // Developer: hydrate real cross-tenant users into the kit's devUsers shape.
  function hydrateDevUsers() {
    return get("/api/dev/users").then(function (users) {
      DT.set(function (s) {
        s.devUsers = (users || []).map(function (u) {
          return { id: u.id, name: u.name, role: u.role, org: u.org, specialty: u.specialty || "", scope: u.role === "developer" ? "root" : "local" };
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
  DT.actions.deleteTenant = function (o) {
    if (!o) return;
    function toast(title, msg) { DT.set(function (s) { s.__toast = { tone: "rejected", title: title, msg: msg }; return s; }); }
    // Resolve the real org id by code if the row object lacks one (e.g. demo
    // data) — this also surfaces a 403 if the session isn't a real developer.
    var resolve = o.id
      ? Promise.resolve(o.id)
      : get("/api/dev/organizations").then(function (list) {
          var m = (list || []).find(function (x) { return x.code === o.code; });
          return m ? m.id : null;
        });
    resolve.then(function (id) {
      if (!id) { toast("Cannot delete", "Sign in as a Developer to manage organizations."); return; }
      return api("DELETE", "/api/dev/organizations/" + id).then(function () {
        hydrateOrgs();
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Organization deleted", msg: o.name + " removed." }; return s; });
      });
    }).catch(function (e) {
      var m = String(e && e.message);
      if (m === "org_not_empty") toast("Could not delete", "This tenant still has users — remove them first.");
      else if (m === "forbidden") toast("Cannot delete", "Sign in as a Developer to manage organizations.");
      else toast("Could not delete", "Delete failed — see console.");
      console.error("[DocTurn] deleteTenant failed", e);
    });
  };

  console.log("[DocTurn] live API bridge active — actions wired to /api");
})();
