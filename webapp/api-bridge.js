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

  // The developer account lives in its own platform org, not a clinical tenant,
  // so resolve the right org code by role. Clinical roles must NEVER inherit the
  // platform org (e.g. when switching role from Developer) — their demo accounts
  // live in the MERCY tenant.
  var PLATFORM_ORG = "DOCTURN";
  function orgForRole(role, fallback) {
    if (role === "developer") return PLATFORM_ORG;
    if (!fallback || fallback === PLATFORM_ORG) return "MERCY";
    return fallback;
  }

  // Remember the active role/org so we can transparently re-authenticate if the
  // server session goes away (15-min idle expiry, OR a dev-server restart that
  // wipes the in-memory session store). Set on every successful doLogin.
  var lastAuth = null;

  function rawApi(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
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
      if (is401 && hint && path !== "/api/login") {
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
        s.orgs = (orgs || []).filter(function (o) {
          return String(o.code).toUpperCase() !== PLATFORM_ORG; // platform org isn't a tenant
        }).map(function (o) {
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
    var orgCode = orgForRole(role, org);
    return rawApi("POST", "/api/login", { orgCode: orgCode, username: username, password: "docturn" })
      .then(function () { return get("/api/user"); })
      .then(function (u) {
        lastAuth = { role: u.role, org: orgForRole(u.role, org) }; // enable self-healing re-auth
        DT.set(function (s) {
          s.session = { role: u.role, org: orgCode, user: u.username, name: u.displayName };
          s.me = { name: u.displayName, avatar: initials(u.displayName), role: u.credential || "MD" };
          s.ui.nav = "dashboard";
          s.ui.notifOpen = false;
          return s;
        });
        if (u.role === "developer") { hydrateOrgs(); hydrateDevUsers(); }
        return hydrate(u.role);
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
    doLogin(role, org, user).catch(function (e) {
      if (isNetworkError(e)) {
        // Server down → demo login so the UI is still explorable offline.
        origLogin(role, org, user);
        DT.set(function (s) { s.__toast = { tone: "rejected", title: "Offline — demo mode", msg: "Backend unreachable; showing demo data." }; return s; });
        return;
      }
      // Server reachable but login failed (bad/missing account).
      DT.set(function (s) {
        s.loginError = "Sign-in failed for this role. Run \"npm run seed\" to (re)create demo accounts, then try again.";
        s.__toast = { tone: "rejected", title: "Sign-in failed", msg: "Run \"npm run seed\" to create the demo accounts." };
        return s;
      });
      console.error("[DocTurn] login failed (account missing?):", e);
    });
  };

  // The role switcher must re-authenticate as that role's demo account, not just
  // flip the local role (which would leave the server session unchanged).
  var origSetRole = DT.actions.setRole;
  DT.actions.setRole = function (role) {
    var st = DT.getState();
    var org = (st.session && st.session.org) || "MERCY";
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
      });
    }
    function createOwn(p) {
      return api("POST", "/api/director/hospitalists", {
        username: unameFor(p.name), password: "docturn", displayName: p.name,
        specialty: p.group || "Hospital Medicine", patientCap: 12,
        shiftType: p.shift || "day", role: "hospitalist",
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

  console.log("[DocTurn] live API bridge active — actions wired to /api");
})();
