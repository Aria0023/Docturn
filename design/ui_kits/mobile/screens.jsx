/* DocTurn mobile app (Expo / RN) — UI kit screens.
   Rendered inside the IOSDevice frame. Bottom-tab navigation. */

function MI({ name, size = 20, color, strokeWidth = 2, style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({ attrs: { width: size, height: size, "stroke-width": strokeWidth }, root: host });
  }, [name, size, strokeWidth]);
  return <span ref={ref} style={{ display: "inline-flex", alignItems: "center", color, flex: "none", ...style }} />;
}

const SB = { pending: ["var(--status-pending-bg)", "var(--status-pending)"], accepted: ["var(--status-accepted-bg)", "var(--status-accepted)"], sent: ["var(--status-active-bg)", "var(--status-active)"], rejected: ["var(--status-rejected-bg)", "var(--status-rejected)"], offline: ["var(--status-neutral-bg)", "var(--status-neutral)"] };

// Lightweight in-device toast (vanilla DOM, works in any frame).
window.__mtoast = function (msg) {
  var host = document.body;
  var t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;left:50%;bottom:120px;transform:translateX(-50%) translateY(8px);z-index:9999;background:#1E293B;color:#fff;font-family:var(--font-sans);font-size:14px;font-weight:600;padding:11px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .2s, transform .2s;pointer-events:none;max-width:80vw;text-align:center;";
  host.appendChild(t);
  requestAnimationFrame(function () { t.style.opacity = "1"; t.style.transform = "translateX(-50%) translateY(0)"; });
  setTimeout(function () { t.style.opacity = "0"; t.style.transform = "translateX(-50%) translateY(8px)"; setTimeout(function () { t.remove(); }, 250); }, 1700);
};

function MBadge({ status, children, icon }) {
  const [bg, fg] = SB[status] || SB.offline;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 99, fontSize: 12, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap" }}>{icon && <MI name={icon} size={11} />}{children}</span>;
}

function MAvatar({ initials, size = 44, tint = "blue" }) {
  const t = { blue: ["#DBEAFE", "var(--primary)"], emerald: ["var(--status-accepted-bg)", "var(--status-accepted)"], amber: ["var(--status-pending-bg)", "var(--status-pending)"], slate: ["var(--status-neutral-bg)", "var(--status-neutral)"] }[tint];
  return <span style={{ width: size, height: size, borderRadius: 99, background: t[0], color: t[1], fontWeight: 700, fontSize: size * 0.36, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{initials}</span>;
}

function Dot({ status = "offline", pulse }) {
  const fg = (SB[status] || SB.offline)[1];
  return <span style={{ position: "relative", width: 10, height: 10, display: "inline-block", flex: "none" }}>
    <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: fg }} />
    {pulse && <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: fg, animation: "dt-pulse 1.5s infinite" }} />}
  </span>;
}

function Header({ title, action }) {
  return (
    <div style={{ padding: "56px 20px 12px", background: "#fff", position: "sticky", top: 0, zIndex: 5, borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{title}</h1>
        {action}
      </div>
    </div>
  );
}

/* ---------- Screens ---------- */

function DashboardScreen({ pending, onAccept, onDecline, working, setWorking, census, rotation }) {
  const rot = rotation || [
    { initials: "SC", name: "Dr. Sarah Chen", census: 3 },
    { initials: "JC", name: "You", census: 4, me: true },
    { initials: "AP", name: "Dr. Amir Patel", census: 5 },
    { initials: "OH", name: "Dr. Omar Haddad", census: 6 },
    { initials: "ML", name: "Dr. Maria Lopez", census: 7 },
  ];
  const meIdx = rot.findIndex((r) => r.me);
  const nextUp = rot[0];
  return (
    <div>
      <Header title="Dashboard" action={
        <button onClick={() => setWorking(!working)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
          <Dot status={working ? "accepted" : "offline"} pulse={working} />{working ? "On shift" : "Off"}
        </button>} />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          {[["Census", census, "users", "blue"], ["Pending", pending.length, "clock", "amber"], ["Cap", "12", "gauge", "slate"]].map(([l, v, ic, t]) => (
            <div key={l} style={{ flex: 1, background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 14, boxShadow: "var(--shadow-sm)" }}>
              <MI name={ic} size={16} color={{ blue: "var(--primary)", amber: "var(--status-pending)", slate: "var(--status-neutral)" }[t]} />
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{v}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Round-robin rotation */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 14, boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <MI name="route" size={15} color="var(--primary)" />
              <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>Round-robin</span>
            </div>
            <MBadge status="sent">#{meIdx + 1} of {rot.length}</MBadge>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {rot.map((r, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ position: "relative", paddingTop: i === 0 ? 6 : 0 }}>
                  {i === 0 && <span style={{ position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)", fontSize: 8.5, fontWeight: 800, color: "#fff", background: "var(--status-accepted)", borderRadius: 99, padding: "1px 5px", whiteSpace: "nowrap", zIndex: 2 }}>NEXT</span>}
                  <MAvatar initials={r.initials} size={r.me ? 40 : 36} tint={i === 0 ? "emerald" : r.me ? "blue" : "slate"} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: r.me ? "var(--primary)" : "var(--muted-foreground)", whiteSpace: "nowrap" }}>{r.me ? "You" : r.initials}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6 }}>
            <MI name="arrow-right" size={13} color="var(--status-accepted)" />Next admit → <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{nextUp.name}</b> · lowest census
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 2px 8px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Incoming</h2>
          {pending.length > 0 && <MBadge status="pending" icon="clock">{pending.length} awaiting</MBadge>}
        </div>

        {pending.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 24, textAlign: "center" }}>
            <MI name="inbox" size={22} color="var(--muted-foreground)" />
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>No pending assignments</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>You're all caught up.</div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {pending.map((p) => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 11, boxShadow: "var(--shadow-sm)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <MAvatar initials={p.initials} size={36} tint="amber" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>{p.initials} · Rm {p.room}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600, color: "var(--status-pending)", marginLeft: "auto", flex: "none" }}><MI name="clock" size={11} />{p.expires}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.complaint} · {p.via}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                <button onClick={() => onDecline(p.id)} style={btn("outline")}><MI name="x" size={15} />Decline</button>
                <button onClick={() => onAccept(p.id)} style={btn("primary")}><MI name="check" size={15} />Accept</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function btn(variant) {
  const base = { flex: 1, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" };
  if (variant === "primary") return { ...base, border: "none", background: "var(--primary)", color: "#fff" };
  return { ...base, border: "1px solid var(--border)", background: "#fff", color: "var(--foreground)" };
}

function ChatThread({ convo, onBack }) {
  const [msgs, setMsgs] = React.useState(convo.messages || [
    { me: false, text: convo.preview || "Hi there.", t: convo.time || "now" },
  ]);
  const [draft, setDraft] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const endRef = React.useRef(null);
  React.useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [msgs, typing]);
  const REPLIES = ["Copy — on it.", "Thanks for the heads up.", "Accepting now.", "On my way up.", "Understood, I'll update the chart."];
  const lastMeIdx = msgs.map((m) => m.me).lastIndexOf(true);
  const send = () => {
    if (!draft.trim() || convo.broadcast) return;
    setMsgs((m) => [...m, { me: true, text: draft.trim(), t: "now" }]);
    setDraft("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m, { me: false, text: REPLIES[Math.floor(Math.random() * REPLIES.length)], t: "now" }]);
    }, 1400);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#F2F4F8" }}>
      <div style={{ padding: "52px 14px 11px", background: "#fff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 11, position: "sticky", top: 0, zIndex: 5 }}>
        <button onClick={onBack} style={{ width: 34, height: 34, borderRadius: 99, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name="chevron-left" size={22} color="var(--primary)" /></button>
        <MAvatar initials={convo.initials} size={36} tint={convo.tint} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{convo.name}</div>
          <div style={{ fontSize: 12, color: "var(--status-accepted)" }}>{convo.group ? (convo.members ? convo.members.length + " members · " + sentenceMembers(convo) : "Group") : "Online"}</div>
        </div>
        <button onClick={() => window.__mtoast && window.__mtoast("Calling " + convo.name + "…")} style={{ width: 36, height: 36, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name="phone" size={16} color="var(--primary)" /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 5, background: "var(--secondary)", color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 99, marginBottom: 4 }}>
          <MI name="lock" size={11} color="var(--muted-foreground)" />End-to-end encrypted · auto-deletes in 30 days
        </div>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "76%", padding: "9px 13px", borderRadius: 16, fontSize: 14, lineHeight: 1.4,
              background: m.me ? "var(--primary)" : "#fff", color: m.me ? "#fff" : "var(--foreground)",
              border: m.me ? "none" : "1px solid var(--border)", borderBottomRightRadius: m.me ? 5 : 16, borderBottomLeftRadius: m.me ? 16 : 5 }}>{m.text}</div>
            {m.me && i === lastMeIdx && !typing && (
              <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}><MI name="check-check" size={12} color="var(--status-accepted)" />Read</span>
            )}
          </div>
        ))}
        {typing && <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 16, borderBottomLeftRadius: 5, background: "#fff", border: "1px solid var(--border)", display: "flex", gap: 4 }}>{[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--muted-foreground)", animation: "dt-pulse 1.2s infinite", animationDelay: d * 0.18 + "s" }} />)}</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "10px 12px 26px", background: "#fff", borderTop: "1px solid var(--border)", display: "flex", gap: 9, alignItems: "center" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={convo.broadcast ? "Replies disabled" : "Message…"} disabled={convo.broadcast}
          style={{ flex: 1, height: 40, border: "1px solid var(--border)", borderRadius: 20, padding: "0 15px", fontSize: 14, outline: "none", fontFamily: "inherit", background: convo.broadcast ? "var(--secondary)" : "#fff" }} />
        <button onClick={send} style={{ width: 40, height: 40, borderRadius: 99, border: "none", background: draft.trim() ? "var(--primary)" : "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name="arrow-up" size={18} color={draft.trim() ? "#fff" : "var(--muted-foreground)"} /></button>
      </div>
    </div>
  );
}

const MSG_ROSTER = [
  { id: "u1", initials: "AP", name: "Dr. Amir Patel", sub: "Hospital Medicine", tint: "emerald" },
  { id: "u2", initials: "SC", name: "Dr. Sarah Chen", sub: "Cardiology", tint: "blue" },
  { id: "u3", initials: "ML", name: "Dr. Maria Lopez", sub: "Pulmonology", tint: "blue" },
  { id: "u4", initials: "RK", name: "Dr. Ruth Kim", sub: "GI", tint: "blue" },
  { id: "u5", initials: "NF", name: "Dr. Nadia Farouk", sub: "Endocrine", tint: "blue" },
  { id: "u6", initials: "OH", name: "Dr. Omar Haddad", sub: "Infectious Disease", tint: "blue" },
  { id: "u7", initials: "JL", name: "Dr. James Liu", sub: "Nephrology", tint: "blue" },
  { id: "u8", initials: "LO", name: "Dr. Lena Ortiz", sub: "Neurology", tint: "blue" },
  { id: "u9", initials: "PS", name: "Priya Shah, NP", sub: "Pulmonology · NP", tint: "slate" },
  { id: "u10", initials: "RO", name: "Dr. Ruth Osei", sub: "ER physician", tint: "amber" },
];

function ComposeScreen({ onBack, onStart }) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState([]);
  const toggle = (u) => setSel((s) => s.find((x) => x.id === u.id) ? s.filter((x) => x.id !== u.id) : [...s, u]);
  const list = MSG_ROSTER.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || u.sub.toLowerCase().includes(q.toLowerCase()));
  const isGroup = sel.length > 1;
  const start = () => {
    if (sel.length === 0) return;
    const name = isGroup ? sel.map((s) => s.name.replace(/^Dr\.\s/, "").split(/[ ,]/)[0]).join(", ") : sel[0].name;
    const convo = isGroup
      ? { id: "g" + Date.now(), name, initials: String(sel.length), tint: "blue", group: true, members: sel, status: "accepted", preview: "", messages: [] }
      : { id: sel[0].id, name: sel[0].name, initials: sel[0].initials, tint: sel[0].tint, status: "accepted", preview: "", messages: [] };
    onStart(convo);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ padding: "52px 14px 11px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, background: "#fff", zIndex: 5 }}>
        <button onClick={onBack} style={{ width: 34, height: 34, borderRadius: 99, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name="x" size={22} color="var(--primary)" /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>New message</div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{sel.length === 0 ? "Pick one or more people" : isGroup ? sel.length + " people · group" : "Direct message"}</div>
        </div>
        <button onClick={start} disabled={sel.length === 0} style={{ padding: "8px 15px", borderRadius: 99, border: "none", background: sel.length ? "var(--primary)" : "var(--secondary)", color: sel.length ? "#fff" : "var(--muted-foreground)", fontSize: 13.5, fontWeight: 600, cursor: sel.length ? "pointer" : "default", fontFamily: "var(--font-sans)", flex: "none" }}>{isGroup ? "Create group" : "Start"}</button>
      </div>

      {/* selected chips */}
      {sel.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "11px 16px", borderBottom: "1px solid var(--border)" }}>
          {sel.map((u) => (
            <button key={u.id} onClick={() => toggle(u)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 5px", borderRadius: 99, border: "none", background: "var(--secondary)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <MAvatar initials={u.initials} size={22} tint={u.tint} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{u.name.replace(/^Dr\.\s/, "")}</span>
              <MI name="x" size={13} color="var(--muted-foreground)" />
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "12px 16px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", background: "var(--secondary)", borderRadius: 12 }}>
          <MI name="search" size={16} color="var(--muted-foreground)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or specialty" style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, width: "100%", fontFamily: "inherit" }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {list.map((u, i) => {
          const on = !!sel.find((x) => x.id === u.id);
          return (
            <button key={u.id} onClick={() => toggle(u)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none", alignItems: "center", background: on ? "var(--secondary)" : "transparent", border: "none", borderTopColor: "var(--border)", cursor: "pointer" }}>
              <MAvatar initials={u.initials} size={36} tint={u.tint} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{u.sub}</div>
              </div>
              <span style={{ width: 22, height: 22, borderRadius: 99, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", border: on ? "none" : "1.5px solid var(--border)", background: on ? "var(--primary)" : "transparent" }}>{on && <MI name="check" size={14} color="#fff" />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function sentenceMembers(c) { return (c.members || []).map((m) => m.sub.split(" · ")[0]).join(", "); }

function MessagesScreen({ convos }) {
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [read, setRead] = React.useState({});
  const [composing, setComposing] = React.useState(false);
  const [extra, setExtra] = React.useState([]);
  if (composing) return <ComposeScreen onBack={() => setComposing(false)} onStart={(c) => { setExtra((e) => [c, ...e.filter((x) => x.id !== c.id)]); setComposing(false); setOpen(c); }} />;
  if (open) return <ChatThread convo={open} onBack={() => { setRead((r) => ({ ...r, [open.id]: true })); setOpen(null); }} />;
  const all = [...extra, ...convos];
  const list = all.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.preview || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <Header title="Messages" action={<button onClick={() => setComposing(true)} style={{ width: 40, height: 40, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><MI name="pen-square" size={18} color="var(--primary)" /></button>} />
      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", background: "var(--secondary)", borderRadius: 12, marginBottom: 8 }}>
          <MI name="search" size={16} color="var(--muted-foreground)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, width: "100%", fontFamily: "inherit" }} />
        </div>
      </div>
      <div>
        {list.map((c, i) => {
          const unread = read[c.id] ? 0 : c.unread;
          return (
          <button key={c.id} onClick={() => setOpen(c)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 13, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none", alignItems: "center", background: "transparent", border: "none", borderTopColor: "var(--border)", cursor: "pointer" }}>
            <div style={{ position: "relative" }}>
              <MAvatar initials={c.initials} tint={c.tint} />
              {c.group ? <span style={{ position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: 99, background: "var(--primary)", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}><MI name="users" size={9} color="#fff" /></span>
                : <span style={{ position: "absolute", bottom: 0, right: 0, border: "2px solid #fff", borderRadius: 99 }}><Dot status={c.status} /></span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", flex: "none", marginLeft: 8 }}>{c.time || "now"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, gap: 8 }}>
                <span style={{ fontSize: 13.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.group && !c.preview ? sentenceMembers(c) : (c.preview || "New conversation")}</span>
                {unread > 0 && <span style={{ flex: "none", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 99, background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{unread}</span>}
              </div>
            </div>
          </button>
          );
        })}
        {list.length === 0 && <div style={{ textAlign: "center", padding: 30, color: "var(--muted-foreground)", fontSize: 14 }}>No conversations match "{q}".</div>}
      </div>
    </div>
  );
}

function TeamScreen({ providers }) {
  // Who's on, condensed — hospitalists on shift, consult services on call, ER physicians on.
  const onCall = [
    { initials: "SC", name: "Dr. Sarah Chen", sub: "Hospitalist · Cardiology", tint: "emerald" },
    { initials: "AP", name: "Dr. Amir Patel", sub: "Hospitalist · Hosp. Med", tint: "emerald" },
    { initials: "ML", name: "Dr. Maria Lopez", sub: "Hospitalist · Pulmonology", tint: "emerald" },
  ];
  const consults = [
    { initials: "SC", name: "Dr. Sarah Chen", sub: "Cardiology", tint: "blue" },
    { initials: "RK", name: "Dr. Ruth Kim", sub: "GI", tint: "blue" },
    { initials: "NF", name: "Dr. Nadia Farouk", sub: "Endocrine", tint: "blue" },
    { initials: "OH", name: "Dr. Omar Haddad", sub: "Infectious Disease", tint: "blue" },
  ];
  const erDocs = [
    { initials: "RO", name: "Dr. Ruth Osei", sub: "ER physician", tint: "amber" },
    { initials: "PO", name: "Dr. Paul Okafor", sub: "ER physician", tint: "amber" },
    { initials: "DR", name: "Dr. Dana Reyes", sub: "ER physician", tint: "amber" },
  ];
  const Row = (p, i, arr) => (
    <div key={p.name + i} style={{ display: "flex", gap: 11, padding: "9px 16px", alignItems: "center", borderTop: i ? "1px solid var(--border)" : "none" }}>
      <div style={{ position: "relative", flex: "none" }}>
        <MAvatar initials={p.initials} size={34} tint={p.tint} />
        <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><Dot status="accepted" pulse /></span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.sub}</div>
      </div>
      <button onClick={() => window.__mtoast("Messaging " + p.name + "…")} style={{ width: 34, height: 34, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}><MI name="message-square" size={15} color="var(--primary)" /></button>
    </div>
  );
  const Group = ({ icon, label, count, items }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 18px 7px" }}>
        <MI name={icon} size={13} color="var(--muted-foreground)" />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted-foreground)" }}>{count}</span>
      </div>
      <div style={{ background: "#fff", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>{items.map(Row)}</div>
    </div>
  );
  return (
    <div>
      <Header title="On call" action={<MBadge status="accepted" icon="circle">{onCall.length + consults.length + erDocs.length} on</MBadge>} />
      <div style={{ padding: "14px 0" }}>
        <Group icon="stethoscope" label="Hospitalists on shift" count={onCall.length} items={onCall} />
        <Group icon="activity" label="Consults on call" count={consults.length} items={consults} />
        <Group icon="ambulance" label="ER physicians" count={erDocs.length} items={erDocs} />
      </div>
    </div>
  );
}
function Div() { return <div style={{ height: 1, background: "var(--border)", marginLeft: 73 }} />; }
function SubHead({ children }) { return <div style={{ padding: "16px 16px 7px", fontSize: 12.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{children}</div>; }

function DirectoryScreen({ providers }) {
  const [q, setQ] = React.useState("");
  // Everyone — hospitalists, consults, ER docs, midlevels — one condensed list.
  const everyone = [
    { initials: "SC", name: "Dr. Sarah Chen", role: "Cardiology", on: true },
    { initials: "AP", name: "Dr. Amir Patel", role: "Hospital Medicine", on: true },
    { initials: "ML", name: "Dr. Maria Lopez", role: "Pulmonology", on: true },
    { initials: "OH", name: "Dr. Omar Haddad", role: "Infectious Disease", on: true },
    { initials: "RK", name: "Dr. Ruth Kim", role: "GI", on: true },
    { initials: "NF", name: "Dr. Nadia Farouk", role: "Endocrine", on: true },
    { initials: "JL", name: "Dr. James Liu", role: "Nephrology", on: false },
    { initials: "LO", name: "Dr. Lena Ortiz", role: "Neurology", on: true },
    { initials: "RO", name: "Dr. Ruth Osei", role: "ER physician", on: true },
    { initials: "PO", name: "Dr. Paul Okafor", role: "ER physician", on: true },
    { initials: "DR", name: "Dr. Dana Reyes", role: "ER physician", on: false },
    { initials: "PS", name: "Priya Shah, NP", role: "Pulmonology · NP", on: true },
    { initials: "MB", name: "Marcus Bell, PA-C", role: "General Med · PA", on: false },
    { initials: "JW", name: "Jordan Wu, PA-C", role: "Hosp. Med · PA", on: true },
  ];
  const list = everyone.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.role.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <Header title="Directory" action={<MBadge status="offline">{everyone.length}</MBadge>} />
      <div style={{ padding: "12px 16px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", background: "var(--secondary)", borderRadius: 12 }}>
          <MI name="search" size={16} color="var(--muted-foreground)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everyone" style={{ border: "none", outline: "none", background: "transparent", fontSize: 15, width: "100%", fontFamily: "inherit" }} />
        </div>
      </div>
      <div style={{ background: "#fff", borderTop: "1px solid var(--border)" }}>
        {list.map((p, i) => (
          <div key={p.name} style={{ display: "flex", gap: 11, padding: "8px 16px", alignItems: "center", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ position: "relative", flex: "none" }}>
              <MAvatar initials={p.initials} size={32} tint={p.on ? "emerald" : "slate"} />
              <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><Dot status={p.on ? "accepted" : "offline"} /></span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: p.on ? "var(--status-accepted)" : "var(--muted-foreground)", flex: "none" }}>{p.on ? "On" : "Off"}</span>
            <button onClick={() => window.__mtoast("Calling " + p.name + "…")} style={{ width: 32, height: 32, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}><MI name="phone" size={14} color="var(--primary)" /></button>
          </div>
        ))}
        {list.length === 0 && <div style={{ textAlign: "center", padding: 30, color: "var(--muted-foreground)", fontSize: 14 }}>No matches for "{q}".</div>}
      </div>
    </div>
  );
}
function iconBtn() { return { width: 40, height: 40, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }; }

function ProfileScreen({ profile }) {
  const p = profile || { name: "Dr. Jordan Chen", role: "Hospitalist · Cardiology", initials: "JC", org: "Mercy General · MERCY" };
  const [twoFA, setTwoFA] = React.useState(true);
  const [push, setPush] = React.useState(true);
  const [sms, setSms] = React.useState(true);
  const [available, setAvailable] = React.useState(true);
  const [appLock, setAppLock] = React.useState(true);
  const [autoDelete, setAutoDelete] = React.useState(true);
  const [signedOut, setSignedOut] = React.useState(false);

  const Toggle = ({ on, set }) => (
    <button onClick={() => set(!on)} style={{ width: 44, height: 26, borderRadius: 99, border: "none", position: "relative", flex: "none", cursor: "pointer", background: on ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
    </button>
  );
  const SettingRow = ({ icon, title, sub, control, last }) => (
    <div style={{ display: "flex", gap: 13, alignItems: "center", padding: "13px 16px", borderTop: last ? "none" : "1px solid var(--border)" }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name={icon} size={18} color="var(--primary)" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{sub}</div>
      </div>
      {control}
    </div>
  );

  if (signedOut) {
    return (
      <div>
        <Header title="Profile" />
        <div style={{ padding: 40, textAlign: "center" }}>
          <span style={{ width: 64, height: 64, borderRadius: 18, background: "var(--secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}><MI name="log-out" size={28} color="var(--muted-foreground)" /></span>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Signed out</div>
          <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", margin: "6px 0 20px" }}>Your session on this device has ended.</div>
          <button onClick={() => setSignedOut(false)} style={{ height: 46, padding: "0 26px", borderRadius: 12, border: "none", background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 600 }}>Sign back in</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Profile" />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 15, alignItems: "center", background: "#fff", border: "1px solid var(--border)", borderRadius: 18, padding: 18, boxShadow: "var(--shadow-sm)" }}>
          <MAvatar initials={p.initials} size={58} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{p.name}</div>
            <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{p.role}</div>
            <div style={{ marginTop: 7 }}><MBadge status={available ? "accepted" : "offline"} icon="circle">{available ? "Available" : "Away"}</MBadge></div>
          </div>
        </div>

        <div style={{ marginTop: 16, background: "#fff", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
          <SettingRow icon="activity" title="Available for assignments" sub={available ? "Receiving round-robin admits" : "Paused — not in rotation"} control={<Toggle on={available} set={setAvailable} />} />
          <SettingRow icon="shield-check" title="Two-factor auth" sub={twoFA ? "TOTP + SMS · on" : "Off — less secure"} control={<Toggle on={twoFA} set={setTwoFA} />} />
          <SettingRow icon="bell" title="Push notifications" sub="Firebase Cloud Messaging" control={<Toggle on={push} set={setPush} />} />
          <SettingRow icon="message-circle" title="SMS fallback" sub="If push isn't delivered" control={<Toggle on={sms} set={setSms} />} last />
        </div>

        <div style={{ marginTop: 16, background: "#fff", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
          <div style={{ padding: "11px 16px 3px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Security &amp; compliance</div>
          <SettingRow icon="scan-face" title="App lock" sub={appLock ? "Face ID + PIN on launch" : "Off — not recommended"} control={<Toggle on={appLock} set={setAppLock} />} />
          <SettingRow icon="timer" title="Auto-delete messages" sub={autoDelete ? "After 30 days · HIPAA retention" : "Kept indefinitely"} control={<Toggle on={autoDelete} set={setAutoDelete} />} />
          <SettingRow icon="lock" title="Encryption" sub="End-to-end · at rest &amp; in transit" control={<MBadge status="accepted" icon="check">On</MBadge>} last />
        </div>

        <div style={{ marginTop: 16, background: "#fff", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
          <SettingRow icon="building-2" title="Organization" sub={p.org} control={<MI name="chevron-right" size={18} color="var(--muted-foreground)" />} />
          <SettingRow icon="clock" title="Session" sub="15-min timeout" control={<MI name="chevron-right" size={18} color="var(--muted-foreground)" />} last />
        </div>

        <button onClick={() => setSignedOut(true)} style={{ width: "100%", marginTop: 16, height: 46, borderRadius: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--destructive)", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
          <MI name="log-out" size={17} />Sign out
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { MI, MBadge, MAvatar, Dot, DashboardScreen, MessagesScreen, TeamScreen, DirectoryScreen, ProfileScreen });
