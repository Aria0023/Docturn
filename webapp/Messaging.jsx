/* DocTurn web-app UI kit — secure messaging (conversation list + thread).
   Fully store-backed: conversations and threads persist, unread clears on open,
   sending posts to the live API, and the typing indicator is REAL — peers'
   typing_start/stop relayed over the WebSocket (never simulated). Attachments
   are deliberately absent until encrypted storage + a PHI policy exist. */

function fmtTime(at) {
  // single source of truth — shared with the store's clock + mobile composer
  if (window.dtFmt && window.dtFmt.hhmm) return window.dtFmt.hhmm(at);
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Human-readable byte size for an attachment download chip.
function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function Messaging() {
  const st = useStore();
  const a = useActions();
  const convos = st.conversations;
  const isMobile = useIsMobile();
  const [active, setActive] = React.useState(st.__activeConvo || (convos[0] && convos[0].id));
  const [draft, setDraft] = React.useState("");
  const [priority, setPriority] = React.useState("routine"); // routine | urgent | stat
  const [pending, setPending] = React.useState([]); // uploaded-but-unsent attachments
  const fileInputRef = React.useRef(null);
  const [q, setQ] = React.useState("");
  const [composing, setComposing] = React.useState(false);
  const [forwarding, setForwarding] = React.useState(null); // message being forwarded, or null
  const [keepPrio, setKeepPrio] = React.useState(false); // forward: keep the original priority (default routine)
  const [tplOpen, setTplOpen] = React.useState(false); // composer template picker
  const [statusFor, setStatusFor] = React.useState(null); // message id whose per-recipient status is expanded
  const [mobileView, setMobileView] = React.useState("list"); // phone: "list" | "thread"
  // Feature modules: hide a control when the org has switched it off (server
  // enforces; a missing helper means "enabled").
  const modOn = (id) => !(window.DT && window.DT.moduleOn) || window.DT.moduleOn(id);
  const threadRef = React.useRef(null);
  const openThread = (id) => { setActive(id); if (isMobile) setMobileView("thread"); };

  // follow a store-initiated conversation switch (e.g. "Message" from another screen)
  React.useEffect(() => { if (st.__activeConvo && st.__activeConvo !== active) setActive(st.__activeConvo); }, [st.__activeConvo]);
  // clear unread whenever the open thread changes
  React.useEffect(() => { if (active) a.openConversation(active); setPending([]); }, [active]);
  // keep the thread pinned to the latest message
  const conv = convos.find((c) => c.id === active) || convos[0];
  // 1:1 peer availability → auto-response banner (DND / covering / off-shift).
  // Only for a TRUE one-to-one: if a covering provider has joined (DND forward
  // adds them), the thread has >1 other participant and is no longer a 1:1, so
  // no peer banner.
  const meId = st.me && st.me.id;
  const peerOthers = conv && !conv.group && !conv.broadcast
    ? (conv.participantIds || []).filter((id) => id !== meId)
    : [];
  const peerId = peerOthers.length === 1 ? peerOthers[0] : null;
  React.useEffect(() => { if (peerId != null && a.loadPeerAvailability) a.loadPeerAvailability(peerId); }, [peerId]);
  const peerAvail = peerId != null ? (st.peerAvail || {})[peerId] : null;
  React.useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [conv && conv.messages.length, conv && conv.typing]);

  const list = convos.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.role || "").toLowerCase().includes(q.toLowerCase()));

  const send = () => {
    if (!draft.trim() && pending.length === 0) return;
    a.sendMessage(active, draft, priority, pending.map((p) => p.id));
    setDraft(""); setPriority("routine"); setPending([]);
    if (a.setTyping) a.setTyping(active, false);
  };
  // Upload each chosen file, appending it to the pending chips as it lands.
  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file later
    files.forEach((f) => {
      Promise.resolve(a.uploadAttachment && a.uploadAttachment(f))
        .then((res) => { if (res && res.id) setPending((prev) => prev.concat([res])); })
        .catch(() => { if (a.toast) a.toast({ tone: "rejected", title: "Upload failed", msg: f.name }); });
    });
  };
  const removePending = (id) => setPending((prev) => prev.filter((p) => p.id !== id));
  const PRIO = { urgent: { label: "Urgent", color: "#B45309", bg: "#FEF3C7", icon: "alert-triangle" }, stat: { label: "STAT", color: "#B91C1C", bg: "#FEE2E2", icon: "siren" } };
  // Forwarding is SERVER-backed: POST /api/messaging/messages/:id/forward
  // creates the message in the target thread with provenance (original
  // sender + time) and carries attachments by reference. The picker resolves
  // a person to their userId (directory first, then the org-wide people map)
  // or an on-call role to its target id.
  const userIdForPerson = (p) => {
    const d = (st.directory || []).find((x) => x.name === p.name);
    if (d) return d.id;
    const op = Object.values(st.orgPeople || {}).find((x) => x.name === p.name);
    return op ? op.id : null;
  };
  const finishForward = (target) => {
    const fw = forwarding;
    setForwarding(null); setComposing(false); setQ("");
    if (!fw || fw.id == null || !a.forwardMessage) return;
    Promise.resolve(a.forwardMessage(fw.id, target, { keepPriority: keepPrio })).then((m) => {
      if (m && m.conversationId != null) { setActive(m.conversationId); if (isMobile) setMobileView("thread"); }
    });
    setKeepPrio(false);
  };
  const startWith = (p) => {
    if (forwarding) {
      const uid = userIdForPerson(p);
      if (uid == null) { if (a.toast) a.toast({ tone: "rejected", title: "Can't forward", msg: p.name + " isn't a registered user." }); return; }
      finishForward({ participantIds: [uid] });
      return;
    }
    a.startConversation({ name: p.name, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" });
    setComposing(false); setQ(""); if (isMobile) setMobileView("thread");
  };

  // On-call / role addressing: whenever the compose picker opens, refresh the
  // server-resolved list of addressable roles (each already resolved to a real
  // messageable user in our org). Selecting one opens a thread named after the
  // role so it's clear who was addressed.
  const onCallTargets = st.onCallTargets || [];
  React.useEffect(() => { if (composing && a.listOnCallTargets) a.listOnCallTargets(); }, [composing]);
  const ROLE_ICON = { consult_service: "stethoscope", next_hospitalist: "repeat", care_team: "users" };
  const startRole = (t) => {
    if (forwarding) { finishForward({ roleTarget: t.id }); return; }
    if (a.startRoleConversation) a.startRoleConversation(t);
    setComposing(false); setQ(""); if (isMobile) setMobileView("thread");
  };
  // Composer templates (org-wide + mine): loaded when the picker opens.
  const templates = st.templates || [];
  React.useEffect(() => { if (tplOpen && a.listTemplates) a.listTemplates(); }, [tplOpen]);
  const insertTemplate = (t) => {
    setDraft((d) => (d && d.trim() ? d.replace(/\s+$/, "") + " " : "") + t.body);
    if (t.priority === "urgent" || t.priority === "stat") setPriority(t.priority);
    setTplOpen(false);
  };
  const myRole = st.session && st.session.role;
  const canManageOrgTemplates = myRole === "director" || myRole === "er_director" || myRole === "developer";
  // Availability line above the composer (DND / off shift) — wording per spec:
  // "<Name> is unavailable — covering: <Covering Name>", plus their own away
  // message when they set one.
  const availLine = (() => {
    if (!peerAvail || !modOn("messaging.dnd")) return null;
    if (!peerAvail.dnd && peerAvail.working !== false) return null;
    const nm = peerAvail.displayName || conv.name;
    let text = nm + " is unavailable";
    if (peerAvail.covering) text += " — covering: " + peerAvail.covering.displayName;
    else if (peerAvail.dnd) text += " — do-not-disturb, no covering provider set. STAT messages will still alert them.";
    else text += " — off shift.";
    return { text, away: peerAvail.awayMessage || null, dnd: !!peerAvail.dnd };
  })();
  const rolesShown = onCallTargets.filter((t) => t.label.toLowerCase().includes(q.toLowerCase()));

  // On a phone, show exactly one pane at a time (list OR thread/compose).
  const showList = !isMobile || (!composing && mobileView === "list");
  const showThread = !isMobile || composing || mobileView === "thread";

  // Mirror the Directory exactly: you can start a message with anyone in the
  // provider directory (filtered by the same search box). Picking someone you
  // already have a thread with just reopens it (startConversation dedupes).
  // Full directory of people you can message (same live source as the Directory
  // tab); shown in a large full-panel picker when composing.
  const startable = (st.providers || []).filter((p) =>
    p.name.toLowerCase().includes(q.toLowerCase()) || (p.specialty || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: "flex", height: isMobile ? "100%" : "calc(100vh - 64px)" }}>
      {/* List */}
      {showList && (
      <div style={{ width: isMobile ? "100%" : 312, flex: isMobile ? "1 1 auto" : "none", borderRight: isMobile ? "none" : "1px solid var(--border)", background: "#fff", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Messages</h2>
            <Button size="icon" variant={composing ? "secondary" : "outline"} icon={composing ? "x" : "pen-square"} onClick={() => { const n = !composing; setComposing(n); if (!n) setForwarding(null); }} />
          </div>
          <Field icon="search" placeholder="Search conversations…" value={q} onChange={setQ} />
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {list.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <button key={c.id} onClick={() => openThread(c.id)}
                style={{ width: "100%", display: "flex", gap: 11, padding: isMobile ? "15px 16px" : "12px 16px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                  background: active === c.id ? "#EFF6FF" : "#fff" }}>
                <div style={{ position: "relative", flex: "none" }}>
                  <Avatar initials={c.initials} size={isMobile ? 46 : 40} tint={c.tint} />
                  {!c.group && !c.broadcast && <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={c.presence} /></span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: isMobile ? 15.5 : 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", flex: "none", marginLeft: 6 }}>{last ? dtFmt.ago(last.at) : ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{c.role}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, gap: 8 }}>
                    <span style={{ fontSize: isMobile ? 14 : 12.5, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: .8, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      {last && (last.priority === "stat" || last.priority === "urgent") && <span style={{ flex: "none", fontSize: 9.5, fontWeight: 800, padding: "1px 5px", borderRadius: 4, color: "#fff", background: last.priority === "stat" ? "#B91C1C" : "#B45309" }}>{last.priority === "stat" ? "STAT" : "URGENT"}</span>}
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.typing ? "typing…" : (last ? (last.me ? "You: " : "") + last.text : "No messages yet")}</span>
                    </span>
                    {c.unread > 0 && <span style={{ flex: "none", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 99, background: "var(--primary)", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.unread}</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {list.length === 0 && <div style={{ padding: "18px 16px 6px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No conversations yet — tap the pencil to message anyone in the directory.</div>}
        </div>
      </div>
      )}

      {/* Thread */}
      {showThread && (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--secondary)", position: "relative" }}>
        {composing && (
          <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "#fff", display: "flex", flexDirection: "column" }}>
            <div style={{ height: 60, flex: "none", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, padding: "0 20px" }}>
              <Icon name={forwarding ? "forward" : "pen-square"} size={18} color="var(--primary)" />
              <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{forwarding ? "Forward to…" : "New message"}</div>
              <Button size="sm" variant="ghost" icon="x" onClick={() => { setComposing(false); setForwarding(null); setQ(""); }}>Close</Button>
            </div>
            {forwarding && (
              <div style={{ flex: "none", padding: "10px 20px", borderBottom: "1px solid var(--border)", background: "var(--secondary)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <Icon name="forward" size={13} color="var(--muted-foreground)" style={{ marginTop: 2, flex: "none" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em" }}>Forwarding</div>
                  <div style={{ fontSize: 12.5, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 460 }}>{forwarding.text}</div>
                  {(forwarding.attachments || []).length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}><Icon name="paperclip" size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />{forwarding.attachments.length} attachment{forwarding.attachments.length === 1 ? "" : "s"} carried along</div>}
                </div>
                {forwarding.priority && forwarding.priority !== "routine" && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: PRIO[forwarding.priority] ? PRIO[forwarding.priority].color : "var(--foreground)", cursor: "pointer", flex: "none" }}>
                    <input type="checkbox" checked={keepPrio} onChange={(e) => setKeepPrio(e.target.checked)} />Keep {PRIO[forwarding.priority] ? PRIO[forwarding.priority].label : forwarding.priority}
                  </label>
                )}
              </div>
            )}
            <div style={{ padding: "12px 20px", flex: "none", borderBottom: "1px solid var(--border)" }}>
              <Field icon="search" placeholder="Search the directory by name or specialty…" value={q} onChange={setQ} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
              {rolesShown.length > 0 && (
                <div>
                  <div style={{ padding: "10px 24px 6px", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>On-call / roles</div>
                  {rolesShown.map((t) => {
                    const existing = convos.some((c) => c.name === t.label);
                    return (
                      <button key={t.id} onClick={() => startRole(t)}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                        style={{ width: "100%", display: "flex", gap: 13, alignItems: "center", padding: "11px 24px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left", background: "#fff" }}>
                        <div style={{ flex: "none", width: 40, height: 40, borderRadius: 99, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={ROLE_ICON[t.kind] || "user-check"} size={19} color="var(--primary)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</div>
                          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Resolves to whoever currently holds this role</div>
                        </div>
                        {existing
                          ? <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Open thread</span>
                          : <Button size="sm" variant="outline" icon="message-square">Message</Button>}
                      </button>
                    );
                  })}
                  <div style={{ padding: "10px 24px 6px", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Directory</div>
                </div>
              )}
              {startable.length === 0 && rolesShown.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No one in the directory matches "{q}".</div>}
              {startable.map((p) => {
                const existing = convos.some((c) => c.name === p.name);
                return (
                  <button key={p.id} onClick={() => startWith(p)}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                    style={{ width: "100%", display: "flex", gap: 13, alignItems: "center", padding: "11px 24px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left", background: "#fff" }}>
                    <div style={{ position: "relative", flex: "none" }}>
                      <Avatar initials={p.avatar} size={40} tint={p.working ? "emerald" : "slate"} />
                      <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.working ? "online" : "offline"} pulse={p.working} /></span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.specialty}{p.working ? " · on shift" : " · off shift"}</div>
                    </div>
                    {existing
                      ? <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Open thread</span>
                      : <Button size="sm" variant="outline" icon="message-square">Message</Button>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {conv ? (<React.Fragment>
        <div style={{ height: 60, flex: "none", background: "#fff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "0 12px" : "0 20px" }}>
          {isMobile && <button onClick={() => setMobileView("list")} title="Back" style={{ width: 40, height: 40, marginLeft: -6, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="arrow-left" size={23} /></button>}
          <Avatar initials={conv.initials} size={36} tint={conv.tint} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{conv.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 5 }}>
              {conv.patientId != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, color: "var(--primary)", background: "#EFF6FF", border: "1px solid var(--primary)", marginRight: 6 }}><Icon name="clipboard-list" size={11} />Patient thread</span>}
              {conv.typing ? <span style={{ color: "var(--status-active)", fontWeight: 600 }}>typing…</span>
                : <><StatusDot status={conv.presence} pulse={conv.presence === "online"} />{conv.presence === "online" ? "Online" : conv.role}</>}
            </div>
          </div>
          {/* No call button: voice isn't a real capability yet — no fake affordances. */}
          <Button size="icon" variant="ghost" icon="info" onClick={() => a.toast({ tone: "accepted", title: conv.name, msg: (conv.group ? conv.role : conv.role + " · ") + (conv.messages.length) + " messages." })} />
        </div>

        {/* Availability line for a 1:1 peer (DND / off shift + their away message). */}
        {availLine && (
          <div data-availability-line style={{ flex: "none", padding: "9px 16px", display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.4,
            background: availLine.dnd ? "#FEF3C7" : "var(--secondary)", color: availLine.dnd ? "#92400E" : "var(--muted-foreground)", borderBottom: "1px solid " + (availLine.dnd ? "#FCD34D" : "var(--border)") }}>
            <Icon name={availLine.dnd ? "moon" : "clock"} size={14} style={{ flex: "none", marginTop: 2 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{availLine.text}</span>
              {availLine.away && <span style={{ display: "block", marginTop: 2, fontStyle: "italic", opacity: .9 }}>“{availLine.away}”</span>}
            </span>
          </div>
        )}

        <div ref={threadRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? "14px 12px" : 20, display: "flex", flexDirection: "column", gap: isMobile ? 10 : 12 }}>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
            <span style={{ background: "#fff", padding: "3px 12px", borderRadius: 99, border: "1px solid var(--border)" }}>
              <Icon name="lock" size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />Encrypted in transit · access audited
            </span>
          </div>
          {conv.messages.map((m, i) => {
            const prio = PRIO[m.priority];
            return (
            <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: isMobile ? "82%" : "62%" }}>
                {prio && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 4, padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 800, letterSpacing: ".03em", color: prio.color, background: prio.bg, border: "1px solid " + prio.color + "55", float: m.me ? "right" : "left" }}>
                    <Icon name={prio.icon} size={11} />{prio.label}
                  </div>
                )}
                {/* Provenance of a forwarded message (server-stamped, never editable). */}
                {m.forwardedFrom && (
                  <div data-forwarded-from style={{ clear: "both", display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 3, justifyContent: m.me ? "flex-end" : "flex-start" }}>
                    <Icon name="forward" size={11} />Forwarded from {m.forwardedFrom.senderName || "unknown"} · {m.forwardedFrom.sentAt ? dtFmt.ago(new Date(m.forwardedFrom.sentAt).getTime()) : ""}
                  </div>
                )}
                {m.text && (
                <div style={{ clear: "both", whiteSpace: "pre-wrap", padding: isMobile ? "10px 14px" : "9px 13px", borderRadius: isMobile ? 16 : 14, fontSize: isMobile ? 15.5 : 13.5, lineHeight: 1.45,
                  background: m.me ? "var(--primary)" : "#fff", color: m.me ? "#fff" : "var(--foreground)",
                  border: m.me ? "none" : (prio ? "1px solid " + prio.color + "88" : "1px solid var(--border)"),
                  borderBottomRightRadius: m.me ? 4 : 14, borderBottomLeftRadius: m.me ? 14 : 4 }}>{m.text}</div>
                )}
                {/* Attachments: inline image thumbnails + file download chips. The
                    <img>/<a> requests carry the session cookie (same-origin), and
                    each fetch is access-checked + audited server-side. */}
                {(m.attachments || []).map((at) => (
                  at.isImage
                    ? <img key={at.id} src={at.url || ("/api/messaging/attachments/" + at.id)} alt={at.fileName}
                        onClick={() => window.open(at.url || ("/api/messaging/attachments/" + at.id), "_blank")}
                        style={{ clear: "both", maxWidth: 220, maxHeight: 220, borderRadius: 10, cursor: "pointer", marginTop: 6, display: "block", border: "1px solid var(--border)" }} />
                    : <a key={at.id} href={at.url || ("/api/messaging/attachments/" + at.id)} target="_blank" rel="noreferrer" download={at.fileName}
                        style={{ clear: "both", marginTop: 6, display: "flex", alignItems: "center", gap: 9, padding: isMobile ? "11px 13px" : "9px 12px", borderRadius: 12, textDecoration: "none",
                          background: "#fff", border: "1px solid var(--border)", color: "var(--foreground)", maxWidth: 260 }}>
                        <Icon name="paperclip" size={16} color="var(--muted-foreground)" />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: isMobile ? 14 : 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{at.fileName}</span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtBytes(at.byteSize)}</span>
                        </span>
                      </a>
                ))}
                {/* Recipient: acknowledge an unacked STAT/urgent message. */}
                {!m.me && prio && !m.ackedByMe && m.id && (
                  <button onClick={() => a.acknowledgeMessage(conv.id, m.id)}
                    style={{ marginTop: 5, display: "inline-flex", alignItems: "center", gap: 5, padding: isMobile ? "8px 16px" : "4px 12px", borderRadius: 99, cursor: "pointer", fontSize: isMobile ? 13.5 : 12, fontWeight: 700, fontFamily: "inherit", color: "#fff", background: prio.color, border: "none" }}>
                    <Icon name="check" size={12} />Acknowledge
                  </button>
                )}
                <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 3, textAlign: m.me ? "right" : "left", display: "flex", gap: 4, justifyContent: m.me ? "flex-end" : "flex-start", alignItems: "center" }}>
                  {fmtTime(m.at)}
                  {/* Sender: show ack status for STAT/urgent. */}
                  {m.me && prio && (m.ackCount > 0
                    ? <span style={{ color: "var(--status-active)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="check-check" size={12} />Acknowledged</span>
                    : <span style={{ color: prio.color, fontWeight: 600 }}>Awaiting ack…</span>)}
                  {m.me && !prio && <Icon name={m.read ? "check-check" : "check"} size={12} color={m.read ? "var(--status-active)" : "var(--muted-foreground)"} />}
                  {!m.me && m.ackedByMe && prio && <span style={{ color: "var(--status-active)", fontWeight: 600 }}>✓ You acknowledged</span>}
                  {/* Group threads: per-recipient status, tap to expand. */}
                  {conv.group && m.id && (m.deliveries || []).length > 0 && (
                    <button data-recipient-status onClick={() => setStatusFor(statusFor === m.id ? null : m.id)} title="Who has seen this"
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", padding: 0, marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "inherit", fontSize: 10.5, textDecoration: "underline dotted" }}>
                      Seen by {m.deliveries.filter((d) => d.readAt).length}{prio ? " · Acked by " + m.deliveries.filter((d) => d.acknowledgedAt).length : ""} of {m.deliveries.length}
                    </button>
                  )}
                  {/* Forward this message to another person or on-call role (server-backed). */}
                  {!conv.broadcast && m.id && (m.text || (m.attachments || []).length > 0) && modOn("messaging.forwarding") && (
                    <button data-forward onClick={() => { setForwarding(m); setKeepPrio(false); setComposing(true); setQ(""); }} title="Forward"
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", padding: 0, marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "inherit", fontSize: 10.5 }}>
                      <Icon name="forward" size={12} />Forward
                    </button>
                  )}
                </div>
                {statusFor === m.id && (m.deliveries || []).length > 0 && (
                  <div data-recipient-status-list style={{ clear: "both", marginTop: 4, padding: "8px 10px", borderRadius: 10, background: "#fff", border: "1px solid var(--border)", fontSize: 11.5, display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.deliveries.map((d) => {
                      const S = { acknowledged: ["check-check", "var(--status-active)", "Acknowledged"], read: ["check-check", "var(--status-active)", "Read"], delivered: ["check", "var(--muted-foreground)", "Delivered"], sent: ["clock", "var(--muted-foreground)", "Sent"] }[d.status] || ["clock", "var(--muted-foreground)", d.status];
                      const at = d.acknowledgedAt || d.readAt || d.deliveredAt;
                      return (
                        <div key={d.userId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Icon name={S[0]} size={12} color={S[1]} />
                          <span style={{ flex: 1, fontWeight: 600, color: "var(--foreground)" }}>{d.displayName || ("User " + d.userId)}</span>
                          <span style={{ color: S[1], fontWeight: 600 }}>{S[2]}</span>
                          {at && <span style={{ color: "var(--muted-foreground)" }}>{fmtTime(new Date(at).getTime())}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            );
          })}
          {conv.typing && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "11px 15px", borderRadius: 14, borderBottomLeftRadius: 4, background: "#fff", border: "1px solid var(--border)", display: "flex", gap: 4 }}>
                {[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--muted-foreground)", animation: "dt-pulse 1.2s infinite", animationDelay: d * 0.18 + "s" }} />)}
              </div>
            </div>
          )}
        </div>

        {/* Pending attachments (uploaded, not yet sent) — removable chips shown
            above the Priority row. Synthetic-data pilot only: no PHI in filenames. */}
        {!conv.broadcast && pending.length > 0 && (
          <div style={{ flex: "none", padding: isMobile ? "8px 12px 0" : "8px 16px 0", background: "#fff", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {pending.map((p) => (
              <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 10px" : "5px 9px", borderRadius: 99, fontSize: isMobile ? 13 : 12, fontWeight: 500, color: "var(--foreground)", background: "var(--secondary)", border: "1px solid var(--border)", maxWidth: 220 }}>
                <Icon name="paperclip" size={13} color="var(--muted-foreground)" />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.fileName}</span>
                <button onClick={() => removePending(p.id)} title="Remove" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", padding: 0, display: "inline-flex", alignItems: "center" }}><Icon name="x" size={13} /></button>
              </span>
            ))}
          </div>
        )}
        {/* Template picker (search, insert into the draft, preselect priority)
            with a small manage view — anchored above the composer. */}
        {tplOpen && !conv.broadcast && (
          <TemplatePicker templates={templates} onPick={insertTemplate} onClose={() => setTplOpen(false)} canManageOrg={canManageOrgTemplates} actions={a} isMobile={isMobile} />
        )}
        {!conv.broadcast && (
          <div style={{ flex: "none", padding: "8px 16px 0", background: "#fff", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginRight: 2 }}>Priority</span>
            {[["routine", "Routine", "var(--muted-foreground)"], ["urgent", "Urgent", "#B45309"], ["stat", "STAT", "#B91C1C"]].map(([id, label, color]) => (
              <button key={id} onClick={() => setPriority(id)}
                style={{ padding: isMobile ? "7px 15px" : "3px 11px", borderRadius: 99, cursor: "pointer", fontSize: isMobile ? 13 : 11.5, fontWeight: 700, fontFamily: "inherit",
                  color: priority === id ? "#fff" : color, background: priority === id ? color : "transparent",
                  border: "1px solid " + (priority === id ? color : "var(--border)") }}>{label}</button>
            ))}
            {modOn("messaging.templates") && (
              <button data-templates onClick={() => setTplOpen(!tplOpen)} title="Insert a message template"
                style={{ marginLeft: "auto", padding: isMobile ? "7px 13px" : "3px 11px", borderRadius: 99, cursor: "pointer", fontSize: isMobile ? 13 : 11.5, fontWeight: 700, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5,
                  color: tplOpen ? "#fff" : "var(--primary)", background: tplOpen ? "var(--primary)" : "transparent", border: "1px solid " + (tplOpen ? "var(--primary)" : "var(--border)") }}>
                <Icon name="file-text" size={12} />Templates
              </button>
            )}
          </div>
        )}
        <div style={{ flex: "none", padding: isMobile ? "10px 12px calc(env(safe-area-inset-bottom, 0px) + 10px)" : 16, background: "#fff", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
          <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,video/mp4" onChange={onPickFiles} style={{ display: "none" }} />
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Attach a file" disabled={conv.broadcast}
            style={{ width: isMobile ? 46 : 40, height: isMobile ? 46 : 40, flex: "none", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", cursor: conv.broadcast ? "default" : "pointer" }}>
            <Icon name="paperclip" size={isMobile ? 20 : 18} />
          </button>
          <div style={{ flex: 1 }}>
            <input value={draft} onChange={(e) => { setDraft(e.target.value); if (a.setTyping) a.setTyping(conv.id, !!e.target.value); }} onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={conv.broadcast ? "Replies disabled for broadcasts" : (priority === "stat" ? "Type a STAT message…" : priority === "urgent" ? "Type an urgent message…" : "Type a secure message…")} disabled={conv.broadcast}
              style={{ width: "100%", height: isMobile ? 46 : 40, border: (priority === "stat" ? "2px solid #B91C1C" : priority === "urgent" ? "2px solid #B45309" : "1.5px solid #94A3B8"), borderRadius: isMobile ? 23 : "var(--radius-md)", padding: isMobile ? "0 18px" : "0 14px", fontSize: isMobile ? 16 : 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: conv.broadcast ? "var(--secondary)" : "#F1F5F9" }} />
          </div>
          {isMobile ? <button onClick={send} title="Send" style={{ width: 46, height: 46, flex: "none", borderRadius: 99, border: "none", background: draft.trim() ? "var(--primary)" : "#93C5FD", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="send" size={20} color="#fff" /></button> : <Button icon="send" onClick={send}>Send</Button>}
        </div>
        </React.Fragment>) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", gap: 8 }}>
            <Icon name="message-square" size={30} color="var(--muted-foreground)" />
            <div style={{ fontSize: 14, fontWeight: 600 }}>No conversation selected</div>
            <div style={{ fontSize: 12.5 }}>Tap the pencil to message anyone in the directory.</div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// Composer template picker: search + insert; "Manage" flips to a small
// add/edit/delete view. Org-wide templates are editable only by directors /
// ER directors / developers (server-enforced; the UI mirrors `canEdit`).
function TemplatePicker({ templates, onPick, onClose, canManageOrg, actions, isMobile }) {
  const [q, setQ] = React.useState("");
  const [manage, setManage] = React.useState(false);
  const [editing, setEditing] = React.useState(null); // null | "new" | template id
  const [form, setForm] = React.useState({ title: "", body: "", priority: "routine", scope: "mine" });
  const PR = { routine: ["Routine", "var(--muted-foreground)"], urgent: ["Urgent", "#B45309"], stat: ["STAT", "#B91C1C"] };
  const shown = (templates || []).filter((t) => !q || (t.title + " " + t.body).toLowerCase().includes(q.toLowerCase()));
  const startNew = () => { setForm({ title: "", body: "", priority: "routine", scope: "mine" }); setEditing("new"); };
  const startEdit = (t) => { setForm({ title: t.title, body: t.body, priority: t.priority || "routine", scope: t.scope }); setEditing(t.id); };
  const save = () => {
    if (!form.title.trim() || !form.body.trim()) { if (actions.toast) actions.toast({ tone: "rejected", title: "Title and text required", msg: "" }); return; }
    const p = editing === "new"
      ? actions.createTemplate({ title: form.title.trim(), body: form.body.trim(), priority: form.priority, scope: form.scope })
      : actions.updateTemplate(editing, { title: form.title.trim(), body: form.body.trim(), priority: form.priority });
    Promise.resolve(p).then(() => setEditing(null));
  };
  const remove = (t) => { if (window.confirm('Delete template "' + t.title + '"?')) actions.deleteTemplate(t.id); };
  const pill = (pr) => <span style={{ fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 4, color: PR[pr] ? PR[pr][1] : "var(--muted-foreground)", border: "1px solid " + (PR[pr] ? PR[pr][1] : "var(--border)") + "66", flex: "none" }}>{PR[pr] ? PR[pr][0] : pr}</span>;
  return (
    <div data-template-picker style={{ flex: "none", margin: isMobile ? "0 8px" : "0 16px", marginBottom: 6, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", maxHeight: 320, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <Icon name="file-text" size={14} color="var(--primary)" />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{manage ? "Manage templates" : "Templates"}</span>
        {!manage && <Button size="sm" variant="ghost" icon="settings-2" onClick={() => setManage(true)}>Manage</Button>}
        {manage && <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => { setManage(false); setEditing(null); }}>Back</Button>}
        <Button size="sm" variant="ghost" icon="x" onClick={onClose} />
      </div>
      {!manage && (
        <React.Fragment>
          <div style={{ padding: "8px 10px 4px" }}><Field icon="search" placeholder="Search templates…" value={q} onChange={setQ} /></div>
          <div style={{ overflowY: "auto", padding: "4px 6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
            {shown.length === 0 && <div style={{ padding: 14, textAlign: "center", fontSize: 12.5, color: "var(--muted-foreground)" }}>{(templates || []).length ? "No template matches." : "No templates yet — add one under Manage."}</div>}
            {shown.map((t) => (
              <button key={t.id} data-template-item onClick={() => onPick(t)}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{t.title}{t.scope === "org" && <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em" }}>org</span>}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>
                </div>
                {pill(t.priority || "routine")}
              </button>
            ))}
          </div>
        </React.Fragment>
      )}
      {manage && editing == null && (
        <div style={{ overflowY: "auto", padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          <Button size="sm" variant="outline" icon="plus" onClick={startNew}>New template</Button>
          {(templates || []).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t.title} <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 600 }}>· {t.scope === "org" ? "organization" : "mine"}</span></div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>
              </div>
              {pill(t.priority || "routine")}
              {t.canEdit && <Button size="sm" variant="ghost" icon="pencil" onClick={() => startEdit(t)} />}
              {t.canEdit && <Button size="sm" variant="ghost" icon="trash-2" onClick={() => remove(t)} />}
            </div>
          ))}
        </div>
      )}
      {manage && editing != null && (
        <div style={{ overflowY: "auto", padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Short name shown in the picker" />
          <Field label="Message" textarea rows={2} value={form.body} onChange={(v) => setForm({ ...form, body: v })} placeholder="Use {room} as a placeholder. No PHI." />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Priority</span>
            {Object.keys(PR).map((id) => (
              <button key={id} onClick={() => setForm({ ...form, priority: id })}
                style={{ padding: "3px 10px", borderRadius: 99, cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: form.priority === id ? "#fff" : PR[id][1], background: form.priority === id ? PR[id][1] : "transparent", border: "1px solid " + (form.priority === id ? PR[id][1] : "var(--border)") }}>{PR[id][0]}</button>
            ))}
            {editing === "new" && canManageOrg && (
              <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={form.scope === "org"} onChange={(e) => setForm({ ...form, scope: e.target.checked ? "org" : "mine" })} />Organization-wide
              </label>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={save}>{editing === "new" ? "Add template" : "Save"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Away message field for the Do-not-disturb modal (AppShell): what senders see
// on the availability line while you're DND / off shift. Saves on blur/Enter
// via the "awayMessage" user preference.
function DndAwayMessageField() {
  const st = useStore();
  const a = useActions();
  const saved = (st.myPrefs && st.myPrefs.awayMessage) || "";
  const [val, setVal] = React.useState(saved);
  React.useEffect(() => { setVal(saved); }, [saved]);
  const commit = () => { if (val.trim() !== saved.trim() && a.setAwayMessage) a.setAwayMessage(val); };
  return (
    <div data-away-message onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}>
      <Field label="Away message (optional)" icon="message-circle" value={val} onChange={setVal} placeholder="e.g. In clinic until 3pm — page my cover for anything urgent" help="Shown to anyone who messages you while you're unavailable." />
    </div>
  );
}

Object.assign(window, { Messaging, TemplatePicker, DndAwayMessageField });
