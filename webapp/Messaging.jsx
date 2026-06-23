/* DocTurn web-app UI kit — secure messaging (conversation list + thread).
   Fully store-backed: conversations and threads persist, unread clears on open,
   sending posts to the store and triggers a simulated typing + reply, and the
   header / search / new-thread / attach controls all do real work. */

function fmtTime(at) {
  // single source of truth — shared with the store's clock + mobile composer
  if (window.dtFmt && window.dtFmt.hhmm) return window.dtFmt.hhmm(at);
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function Messaging() {
  const st = useStore();
  const a = useActions();
  const convos = st.conversations;
  const isMobile = useIsMobile();
  const [active, setActive] = React.useState(st.__activeConvo || (convos[0] && convos[0].id));
  const [draft, setDraft] = React.useState("");
  const [q, setQ] = React.useState("");
  const [composing, setComposing] = React.useState(false);
  const [mobileView, setMobileView] = React.useState("list"); // phone: "list" | "thread"
  const threadRef = React.useRef(null);
  const openThread = (id) => { setActive(id); if (isMobile) setMobileView("thread"); };

  // follow a store-initiated conversation switch (e.g. "Message" from another screen)
  React.useEffect(() => { if (st.__activeConvo && st.__activeConvo !== active) setActive(st.__activeConvo); }, [st.__activeConvo]);
  // clear unread whenever the open thread changes
  React.useEffect(() => { if (active) a.openConversation(active); }, [active]);
  // keep the thread pinned to the latest message
  const conv = convos.find((c) => c.id === active) || convos[0];
  React.useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [conv && conv.messages.length, conv && conv.typing]);

  const list = convos.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.role || "").toLowerCase().includes(q.toLowerCase()));

  const send = () => { if (!draft.trim()) return; a.sendMessage(active, draft); setDraft(""); };
  const startWith = (p) => { a.startConversation({ name: p.name, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" }); setComposing(false); setQ(""); if (isMobile) setMobileView("thread"); };

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
    <div style={{ display: "flex", height: isMobile ? "calc(100vh - 56px)" : "calc(100vh - 64px)" }}>
      {/* List */}
      {showList && (
      <div style={{ width: isMobile ? "100%" : 312, flex: isMobile ? "1 1 auto" : "none", borderRight: isMobile ? "none" : "1px solid var(--border)", background: "#fff", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Messages</h2>
            <Button size="icon" variant={composing ? "secondary" : "outline"} icon={composing ? "x" : "pen-square"} onClick={() => setComposing(!composing)} />
          </div>
          <Field icon="search" placeholder="Search conversations…" value={q} onChange={setQ} />
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {list.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <button key={c.id} onClick={() => openThread(c.id)}
                style={{ width: "100%", display: "flex", gap: 11, padding: "12px 16px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                  background: active === c.id ? "#EFF6FF" : "#fff" }}>
                <div style={{ position: "relative", flex: "none" }}>
                  <Avatar initials={c.initials} size={40} tint={c.tint} />
                  {!c.group && !c.broadcast && <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={c.presence} /></span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", flex: "none", marginLeft: 6 }}>{last ? dtFmt.ago(last.at) : ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{c.role}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: .8 }}>{c.typing ? "typing…" : (last ? (last.me ? "You: " : "") + last.text : "No messages yet")}</span>
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
              <Icon name="pen-square" size={18} color="var(--primary)" />
              <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>New message</div>
              <Button size="sm" variant="ghost" icon="x" onClick={() => { setComposing(false); setQ(""); }}>Close</Button>
            </div>
            <div style={{ padding: "12px 20px", flex: "none", borderBottom: "1px solid var(--border)" }}>
              <Field icon="search" placeholder="Search the directory by name or specialty…" value={q} onChange={setQ} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
              {startable.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No one in the directory matches "{q}".</div>}
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
          {isMobile && <button onClick={() => setMobileView("list")} title="Back" style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="arrow-left" size={20} /></button>}
          <Avatar initials={conv.initials} size={36} tint={conv.tint} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{conv.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 5 }}>
              {conv.typing ? <span style={{ color: "var(--status-active)", fontWeight: 600 }}>typing…</span>
                : <><StatusDot status={conv.presence} pulse={conv.presence === "online"} />{conv.presence === "online" ? "Online" : conv.role}</>}
            </div>
          </div>
          <Button size="icon" variant="ghost" icon="phone" onClick={() => a.toast({ tone: "sent", title: "Calling " + conv.name, msg: "Connecting on the secure line…" })} />
          <Button size="icon" variant="ghost" icon="info" onClick={() => a.toast({ tone: "accepted", title: conv.name, msg: (conv.group ? conv.role : conv.role + " · ") + (conv.messages.length) + " messages · end-to-end audited." })} />
        </div>

        <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
            <span style={{ background: "#fff", padding: "3px 12px", borderRadius: 99, border: "1px solid var(--border)" }}>
              <Icon name="lock" size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />End-to-end encrypted · auto-deletes in 30 days
            </span>
          </div>
          {conv.messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "62%" }}>
                <div style={{ padding: "9px 13px", borderRadius: 14, fontSize: 13.5, lineHeight: 1.45,
                  background: m.me ? "var(--primary)" : "#fff", color: m.me ? "#fff" : "var(--foreground)",
                  border: m.me ? "none" : "1px solid var(--border)",
                  borderBottomRightRadius: m.me ? 4 : 14, borderBottomLeftRadius: m.me ? 14 : 4 }}>{m.text}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 3, textAlign: m.me ? "right" : "left", display: "flex", gap: 4, justifyContent: m.me ? "flex-end" : "flex-start", alignItems: "center" }}>
                  {fmtTime(m.at)}{m.me && <Icon name={m.read ? "check-check" : "check"} size={12} color={m.read ? "var(--status-active)" : "var(--muted-foreground)"} />}
                </div>
              </div>
            </div>
          ))}
          {conv.typing && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "11px 15px", borderRadius: 14, borderBottomLeftRadius: 4, background: "#fff", border: "1px solid var(--border)", display: "flex", gap: 4 }}>
                {[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--muted-foreground)", animation: "dt-pulse 1.2s infinite", animationDelay: d * 0.18 + "s" }} />)}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: "none", padding: 16, background: "#fff", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
          <Button size="icon" variant="ghost" icon="paperclip" onClick={() => a.toast({ tone: "accepted", title: "Attachment", msg: "File sharing is audited and PHI-scanned." })} />
          <div style={{ flex: 1 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={conv.broadcast ? "Replies disabled for broadcasts" : "Type a secure message…"} disabled={conv.broadcast}
              style={{ width: "100%", height: 40, border: "1px solid var(--input)", borderRadius: "var(--radius-md)", padding: "0 14px", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: conv.broadcast ? "var(--secondary)" : "#fff" }} />
          </div>
          <Button icon="send" onClick={send}>Send</Button>
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

Object.assign(window, { Messaging });
