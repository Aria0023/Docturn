/* ============================================================================
   DocTurn mobile — live API bridge + tiny store.

   Same backend, same session cookie, same WebSocket as the desktop web app
   (webapp/api-bridge.js); reshaped for the phone UI. All data comes from /api,
   live updates from /ws. Nothing here logs message content or patient data,
   and nothing is persisted client-side beyond the HttpOnly session cookie.
   ============================================================================ */
(function () {
  "use strict";

  // ---- tiny observable store ------------------------------------------------
  var state = {
    booting: true,          // resolving an existing session on load
    session: null,          // { id, username, role, org, orgCode, name, credential }
    loginError: null,
    people: [],             // every org user: { userId, displayName, credential, role }
    physicians: [],         // hospitalist roster: { id(hospitalistId), userId, displayName, specialty, working, shiftType, census, cap }
    online: {},             // userId -> true (WS presence)
    pending: [],            // my incoming assignments (hospitalist/director)
    myPatients: [],         // my accepted census
    sent: [],               // ER: assignments I routed, live status
    conversations: [],      // { id, type, name, participantIds, unread, last, messages }
    activeConvo: null,
    typing: {},             // convoId -> { userId: true }
    broadcasts: [],         // live emergency broadcasts this session (+ ack state)
    myHospitalist: null,    // my own rotation profile if I have one
    toast: null,
    wsUp: false,
  };
  var subs = [];
  // Replace the state object on every update so React's useSyncExternalStore
  // sees a new snapshot reference and re-renders.
  function set(patch) {
    state = Object.assign({}, state, patch);
    subs.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function subscribe(fn) {
    subs.push(fn);
    return function () { subs = subs.filter(function (f) { return f !== fn; }); };
  }
  function toast(title, tone) {
    set({ toast: { title: title, tone: tone || "ok", at: Date.now() } });
    setTimeout(function () {
      if (state.toast && Date.now() - state.toast.at >= 2400) set({ toast: null });
    }, 2600);
  }

  // ---- fetch helper (same-origin, cookie session) ----------------------------
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 204) return { __status: 204 };
      return r.text().then(function (t) {
        var d = null;
        if (t) { try { d = JSON.parse(t); } catch (e) { d = { error: "bad_response" }; } }
        if (!r.ok) {
          var err = new Error((d && d.error) || ("HTTP " + r.status));
          err.status = r.status;
          err.body = d;
          throw err;
        }
        if (d && typeof d === "object" && !Array.isArray(d)) d.__status = r.status;
        return d;
      });
    });
  }
  var get = function (p) { return api("GET", p); };

  function initials(name) {
    // Drop honorifics so "Dr. Alex Niculescu" -> "AN", not "DA".
    return String(name || "?").replace(/^(dr|mr|ms|mrs)\.?\s+/i, "")
      .split(/[\s.]+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0]; }).join("").toUpperCase() || "?";
  }

  // ---- hydration --------------------------------------------------------------
  function meId() { return state.session ? state.session.id : null; }

  function hydratePeople() {
    // care-team candidates = every user in my org (HIPAA-safe fields only).
    return get("/api/care-team/candidates").then(function (rows) {
      var me = state.session;
      var people = (rows || []).map(function (u) {
        return { userId: u.userId, displayName: u.displayName, credential: u.credential || "", role: u.role };
      });
      if (me) people.push({ userId: me.id, displayName: me.name, credential: me.credential || "", role: me.role, me: true });
      set({ people: people });
    }).catch(function () {});
  }

  function hydratePhysicians() {
    return Promise.all([
      get("/api/hospitalists").catch(function () { return []; }),
      get("/api/physicians/directory").catch(function () { return []; }),
    ]).then(function (res) {
      var hosps = res[0] || [], dir = res[1] || [];
      var byId = {};
      dir.forEach(function (d) { byId[d.id] = d; });
      var physicians = hosps.map(function (h) {
        var d = byId[h.id] || {};
        return {
          id: h.id, userId: h.userId,
          displayName: d.displayName || ("Provider #" + h.id),
          credential: d.credential || "",
          specialty: h.specialty, working: !!h.working, shiftType: h.shiftType,
          census: h.currentPatientCount, cap: h.patientCap,
        };
      });
      var mine = physicians.find(function (p) { return p.userId === meId(); }) || null;
      set({ physicians: physicians, myHospitalist: mine });
    });
  }

  function hydrateAssignments() {
    var role = state.session && state.session.role;
    var jobs = [];
    if (role === "hospitalist" || role === "director" || role === "developer") {
      jobs.push(get("/api/assignments/pending").then(function (rows) {
        return get("/api/patients").catch(function () { return []; }).then(function (pats) {
          var pById = {};
          (pats || []).forEach(function (p) { pById[p.id] = p; });
          var uByid = {};
          state.people.forEach(function (u) { uByid[u.userId] = u; });
          set({
            pending: (rows || []).map(function (a) {
              var p = pById[a.patientId] || {};
              var er = uByid[a.erDoctorId];
              return {
                id: a.id, patientId: a.patientId,
                initials: p.initials || "??", room: p.roomNumber || "—",
                complaint: p.issueSummary || "", specialty: p.specialty || "General Medicine",
                from: er ? er.displayName : "ER",
                via: a.via === "manual" ? "Manual" : "Round-robin",
                expiresAt: a.expiresAt ? new Date(a.expiresAt).getTime() : Date.now() + 600000,
              };
            }),
          });
          return get("/api/assignments/my").catch(function () { return []; }).then(function (mine) {
            set({
              myPatients: (mine || []).map(function (a) {
                var p = pById[a.patientId] || {};
                return {
                  id: a.id, initials: p.initials || "??", room: p.roomNumber || "—",
                  complaint: p.issueSummary || "",
                  at: a.createdAt ? new Date(a.createdAt).getTime() : Date.now(),
                };
              }),
            });
          });
        });
      }).catch(function () {}));
    }
    if (role === "er_doctor" || role === "er_director" || role === "developer") {
      jobs.push(get("/api/assignments/sent").then(function (rows) {
        set({
          sent: (rows || []).map(function (a) {
            return {
              id: a.id, initials: a.initials, room: a.room || "",
              complaint: a.complaint || "", provider: a.provider,
              status: a.status, via: a.via,
              at: a.createdAt ? new Date(a.createdAt).getTime() : Date.now(),
            };
          }),
        });
      }).catch(function () {}));
    }
    return Promise.all(jobs);
  }

  function hydrateConversations() {
    return get("/api/messaging/conversations").then(function (convos) {
      return Promise.all((convos || []).map(function (c) {
        return get("/api/messaging/conversations/" + c.id + "/messages")
          .then(function (msgs) { return { c: c, msgs: msgs || [] }; })
          .catch(function () { return { c: c, msgs: [] }; });
      })).then(function (rows) {
        var uByid = {};
        state.people.forEach(function (u) { uByid[u.userId] = u; });
        var me = meId();
        var mapped = rows.map(function (row) {
          var c = row.c;
          var others = (c.participantIds || []).filter(function (id) { return id !== me; });
          var other = others.length === 1 ? uByid[others[0]] : null;
          var name = c.name || (other ? other.displayName : (others.length > 1 ? "Group (" + (c.participantIds || []).length + ")" : "Conversation"));
          return {
            id: c.id, type: c.type, name: name,
            initials: c.type === "emergency" ? "!" : initials(name),
            group: c.type === "group" || (c.participantIds || []).length > 2,
            broadcast: c.type === "emergency",
            otherUserId: other ? other.userId : null,
            sub: other ? (roleLabel(other.role) + (other.credential ? " · " + other.credential : "")) : (c.type === "group" ? (c.participantIds || []).length + " members" : ""),
            participantIds: c.participantIds || [],
            unread: c.unreadCount || 0,
            last: c.lastMessage ? { text: c.lastMessage.content, at: new Date(c.lastMessage.createdAt).getTime(), me: c.lastMessage.senderId === me, priority: c.lastMessage.priority || "routine" } : null,
            messages: row.msgs.map(function (m) {
              return { id: m.id, me: m.senderId === me, senderId: m.senderId, text: m.content, at: new Date(m.createdAt || Date.now()).getTime(), priority: m.priority || "routine", ackCount: m.ackCount || 0, ackedByMe: !!m.acknowledgedByMe };
            }),
          };
        });
        mapped.sort(function (a, b) { return ((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0); });
        set({ conversations: mapped });
      });
    }).catch(function () {});
  }

  function roleLabel(role) {
    return { hospitalist: "Hospitalist", er_doctor: "ER physician", er_director: "ER director", director: "Hospitalist director", developer: "Developer" }[role] || "Provider";
  }

  function hydrateAll() {
    return hydratePeople()
      .then(function () { return Promise.all([hydratePhysicians(), hydrateAssignments(), hydrateConversations()]); });
  }

  // ---- websocket ---------------------------------------------------------------
  var ws = null;
  var typingTimers = {};
  function connectWs() {
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    if (typeof WebSocket === "undefined") return;
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var sock;
    try { sock = new WebSocket(proto + "//" + location.host + "/ws"); } catch (e) { return; }
    ws = sock;
    sock.onopen = function () { set({ wsUp: true }); };
    sock.onmessage = function (e) {
      var ev; try { ev = JSON.parse(e.data); } catch (err) { return; }
      if (!ev || !ev.type) return;
      if (ev.type === "MESSAGE_RECEIVED") {
        hydrateConversations();
      } else if (ev.type === "MESSAGE_ACK") {
        hydrateConversations();
      } else if (ev.type === "USER_PRESENCE_CHANGED") {
        var online = Object.assign({}, state.online);
        if (ev.online) online[ev.userId] = true; else delete online[ev.userId];
        set({ online: online });
      } else if (ev.type === "user_typing") {
        var t = Object.assign({}, state.typing);
        var conv = Object.assign({}, t[ev.conversationId] || {});
        if (ev.typing) conv[ev.userId] = true; else delete conv[ev.userId];
        t[ev.conversationId] = conv;
        set({ typing: t });
        // typing_stop can get lost — expire after 5s.
        clearTimeout(typingTimers[ev.conversationId + ":" + ev.userId]);
        typingTimers[ev.conversationId + ":" + ev.userId] = setTimeout(function () {
          var t2 = Object.assign({}, state.typing);
          var c2 = Object.assign({}, t2[ev.conversationId] || {});
          delete c2[ev.userId];
          t2[ev.conversationId] = c2;
          set({ typing: t2 });
        }, 5000);
      } else if (ev.type === "BROADCAST_CREATED" && ev.broadcast) {
        var b = ev.broadcast;
        if (!state.broadcasts.some(function (x) { return x.id === b.id; })) {
          set({ broadcasts: [{ id: b.id, message: b.message, severity: b.severity, at: new Date(b.createdAt || Date.now()).getTime(), acked: b.senderId === meId() }].concat(state.broadcasts) });
        }
      } else if (ev.type === "ASSIGNMENT_CREATED" || ev.type === "ASSIGNMENT_UPDATED" || ev.type === "PATIENT_BOARD_UPDATED") {
        hydrateAssignments(); hydratePhysicians();
      }
    };
    sock.onclose = function () {
      if (ws === sock) ws = null;
      set({ wsUp: false });
      if (state.session) setTimeout(connectWs, 3000);
    };
    sock.onerror = function () { try { sock.close(); } catch (e) {} };
  }
  function wsSend(obj) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  // ---- actions -------------------------------------------------------------------
  var actions = {};

  function finishLogin(u, orgCode) {
    set({
      session: { id: u.id, username: u.username, role: u.role, orgCode: orgCode || "", name: u.displayName, credential: u.credential || "" },
      loginError: null, booting: false,
    });
    connectWs();
    enableWebPush();
    return hydrateAll();
  }

  // ---- web push: content-free wake-ups when the app is closed ---------------
  function urlB64ToUint8Array(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function enableWebPush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
      if (Notification.permission === "denied") return;
      Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") return;
        Promise.all([navigator.serviceWorker.ready, api("GET", "/api/push/vapid-key")])
          .then(function (r) {
            var reg = r[0]; var key = r[1] && r[1].key;
            if (!reg || !key) return null;
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
          })
          .then(function (sub) {
            if (sub) return api("POST", "/api/mobile/device-tokens", { token: JSON.stringify(sub), platform: "webpush" });
          })
          .catch(function () { /* push is best-effort */ });
      });
    } catch (e) { /* older browsers */ }
  }

  actions.login = function (orgCode, username, password) {
    set({ loginError: null });
    return api("POST", "/api/login", { orgCode: orgCode, username: username, password: password })
      .then(function (u) {
        if (u && u.twoFactorRequired) {
          set({ loginError: "This account requires two-factor sign-in — use the desktop app to complete 2FA." });
          return null;
        }
        return finishLogin(u, orgCode);
      })
      .catch(function (e) {
        var msg = e && e.status === 401 ? "Wrong organization code, username or password."
          : e && e.status === 429 ? "Too many attempts — wait a minute and retry."
          : "Can't reach the server. Check your connection.";
        set({ loginError: msg });
        throw e;
      });
  };

  actions.logout = function () {
    try { if (ws) { ws.onclose = null; ws.close(); ws = null; } } catch (e) {}
    api("POST", "/api/logout", {}).catch(function () {});
    set({
      session: null, conversations: [], pending: [], myPatients: [], sent: [],
      people: [], physicians: [], online: {}, typing: {}, broadcasts: [],
      activeConvo: null, myHospitalist: null, booting: false,
    });
  };

  actions.refresh = hydrateAll;

  // -- messaging
  actions.openConversation = function (id) {
    set({ activeConvo: id });
    var convo = state.conversations.find(function (c) { return c.id === id; });
    if (convo && convo.unread > 0) {
      var ids = convo.messages.filter(function (m) { return !m.me && m.id; }).map(function (m) { return m.id; });
      set({ conversations: state.conversations.map(function (c) { return c.id === id ? Object.assign({}, c, { unread: 0 }) : c; }) });
      if (ids.length) api("POST", "/api/messaging/messages/mark-read", { messageIds: ids }).catch(function () {});
    }
  };
  actions.closeConversation = function () { set({ activeConvo: null }); };
  // Acknowledge a STAT/urgent message (stronger than read).
  actions.acknowledgeMessage = function (convoId, messageId) {
    if (messageId == null) return Promise.resolve(false);
    set({ conversations: state.conversations.map(function (c) {
      if (c.id !== convoId) return c;
      return Object.assign({}, c, { messages: c.messages.map(function (m) { return m.id === messageId ? Object.assign({}, m, { ackedByMe: true }) : m; }) });
    }) });
    return api("POST", "/api/messaging/messages/ack", { messageIds: [messageId] })
      .then(function () { return hydrateConversations().then(function () { return true; }); })
      .catch(function () { toast("Couldn't acknowledge — try again", "err"); return false; });
  };

  actions.sendMessage = function (convoId, text, priority) {
    var t = String(text || "").trim();
    if (!t) return Promise.resolve(false);
    var pri = priority === "stat" || priority === "urgent" ? priority : "routine";
    // optimistic append
    set({
      conversations: state.conversations.map(function (c) {
        if (c.id !== convoId) return c;
        return Object.assign({}, c, {
          messages: c.messages.concat([{ id: "tmp" + Date.now(), me: true, text: t, at: Date.now(), pending: true, priority: pri, ackCount: 0 }]),
          last: { text: t, at: Date.now(), me: true, priority: pri },
        });
      }),
    });
    actions.setTyping(convoId, false);
    return api("POST", "/api/messaging/send", { conversationId: Number(convoId), content: t, priority: pri })
      .then(function () { return hydrateConversations().then(function () { return true; }); })
      .catch(function () {
        toast("Message not sent — check connection", "err");
        // drop the optimistic bubble
        set({
          conversations: state.conversations.map(function (c) {
            if (c.id !== convoId) return c;
            return Object.assign({}, c, { messages: c.messages.filter(function (m) { return !m.pending; }) });
          }),
        });
        return false;
      });
  };

  var typingState = {};
  actions.setTyping = function (convoId, on) {
    var convo = state.conversations.find(function (c) { return c.id === convoId; });
    if (!convo) return;
    if (!!typingState[convoId] !== !!on) {
      typingState[convoId] = !!on;
      wsSend({ type: on ? "typing_start" : "typing_stop", conversationId: Number(convoId), participantIds: convo.participantIds });
    }
    clearTimeout(typingState["t" + convoId]);
    if (on) {
      typingState["t" + convoId] = setTimeout(function () { actions.setTyping(convoId, false); }, 2500);
    }
  };

  actions.startConversation = function (userIds, groupName) {
    var me = meId();
    if (me == null || !userIds || !userIds.length) return Promise.resolve(null);
    if (userIds.length === 1) {
      var existing = state.conversations.find(function (c) {
        return c.type === "direct" && c.participantIds.indexOf(userIds[0]) >= 0 && c.participantIds.indexOf(me) >= 0;
      });
      if (existing) { actions.openConversation(existing.id); return Promise.resolve(existing.id); }
    }
    var body = userIds.length > 1
      ? { type: "group", name: groupName || undefined, participantIds: userIds }
      : { type: "direct", participantIds: userIds };
    return api("POST", "/api/messaging/conversations", body)
      .then(function (convo) {
        return hydrateConversations().then(function () {
          set({ activeConvo: convo.id });
          return convo.id;
        });
      })
      .catch(function () { toast("Couldn't start conversation", "err"); return null; });
  };

  // -- assignments (hospitalist / director)
  actions.accept = function (id) {
    set({ pending: state.pending.filter(function (p) { return p.id !== id; }) });
    return api("PATCH", "/api/assignments/" + id + "/accept")
      .then(function () { toast("Assignment accepted — added to your census"); return Promise.all([hydrateAssignments(), hydratePhysicians()]); })
      .catch(function (e) { toast("Couldn't accept — " + ((e && e.message) || "try again"), "err"); return hydrateAssignments(); });
  };
  actions.decline = function (id) {
    set({ pending: state.pending.filter(function (p) { return p.id !== id; }) });
    return api("PATCH", "/api/assignments/" + id + "/reject")
      .then(function () { toast("Declined — re-routing to next provider"); return hydrateAssignments(); })
      .catch(function () { toast("Couldn't decline — try again", "err"); return hydrateAssignments(); });
  };
  actions.setWorking = function (working) {
    var h = state.myHospitalist;
    if (!h) return Promise.resolve();
    set({ myHospitalist: Object.assign({}, h, { working: working }) });
    return api("PATCH", "/api/hospitalists/" + h.id + "/working-status", { working: working })
      .then(function () { return hydratePhysicians(); })
      .catch(function () { toast("Couldn't update shift status", "err"); return hydratePhysicians(); });
  };

  // -- director provider management
  actions.setProviderWorking = function (hospitalistId, working) {
    set({ physicians: state.physicians.map(function (p) { return p.id === hospitalistId ? Object.assign({}, p, { working: working }) : p; }) });
    return api("PATCH", "/api/hospitalists/" + hospitalistId + "/working-status", { working: working })
      .then(function () { return hydratePhysicians(); })
      .catch(function () { toast("Couldn't update shift status", "err"); return hydratePhysicians(); });
  };
  actions.adjustCap = function (hospitalistId, delta) {
    var p = state.physicians.find(function (x) { return x.id === hospitalistId; });
    if (!p) return Promise.resolve();
    var cap = Math.max(1, p.cap + delta);
    set({ physicians: state.physicians.map(function (x) { return x.id === hospitalistId ? Object.assign({}, x, { cap: cap }) : x; }) });
    return api("PATCH", "/api/physicians/" + hospitalistId + "/capacity", { patientCap: cap })
      .then(function () { return hydratePhysicians(); })
      .catch(function () { toast("Couldn't update cap", "err"); return hydratePhysicians(); });
  };
  actions.adjustCensus = function (hospitalistId, delta) {
    var p = state.physicians.find(function (x) { return x.id === hospitalistId; });
    if (!p) return Promise.resolve();
    var census = Math.max(0, p.census + delta);
    set({ physicians: state.physicians.map(function (x) { return x.id === hospitalistId ? Object.assign({}, x, { census: census }) : x; }) });
    return api("PATCH", "/api/hospitalists/" + hospitalistId + "/census", { currentPatientCount: census, reason: "manual adjustment (mobile)" })
      .then(function () { return hydratePhysicians(); })
      .catch(function () { toast("Couldn't update census", "err"); return hydratePhysicians(); });
  };

  // -- ER intake
  actions.sendAdmission = function (fields) {
    // fields: { initials, room, complaint, specialty, acuity, hospitalistId|null }
    return api("POST", "/api/patients", {
      initials: fields.initials,
      roomNumber: fields.room || undefined,
      issueSummary: fields.complaint || "",
      specialty: fields.specialty || undefined,
      acuity: fields.acuity || undefined,
    }).then(function (p) {
      return api("POST", "/api/assignments", {
        patientId: p.id,
        mode: fields.hospitalistId ? "manual" : "round_robin",
        hospitalistId: fields.hospitalistId || undefined,
      });
    }).then(function () {
      toast("Admission routed");
      return Promise.all([hydrateAssignments(), hydratePhysicians()]).then(function () { return true; });
    }).catch(function (e) {
      var m = String((e && e.message) || "");
      toast(/no_provider|no eligible/i.test(m) ? "No hospitalist on shift to receive this" : "Couldn't route — " + (m || "try again"), "err");
      return false;
    });
  };

  // -- broadcasts
  actions.sendBroadcast = function (message, severity) {
    return api("POST", "/api/broadcasts", { message: message, severity: severity || "urgent" })
      .then(function () { toast("Broadcast sent to the organization"); return true; })
      .catch(function () { toast("Couldn't send broadcast", "err"); return false; });
  };
  actions.ackBroadcast = function (id) {
    set({ broadcasts: state.broadcasts.map(function (b) { return b.id === id ? Object.assign({}, b, { acked: true }) : b; }) });
    return api("POST", "/api/broadcasts/" + id + "/ack").catch(function () {});
  };
  actions.dismissBroadcast = function (id) {
    set({ broadcasts: state.broadcasts.filter(function (b) { return b.id !== id; }) });
  };
  actions.toast = toast;

  // ---- boot: resume an existing session if the cookie is still valid ----------
  get("/api/user")
    .then(function (u) { return finishLogin(u, ""); })
    .catch(function () { set({ booting: false }); });

  window.MDT = {
    getState: function () { return state; },
    subscribe: subscribe,
    actions: actions,
    roleLabel: roleLabel,
    initials: initials,
  };
})();
