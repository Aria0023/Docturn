/* ============================================================================
   DocTurn mobile — live app shell.

   Renders the designer's mobile kit look-and-feel (primitives from screens.jsx:
   MI, MBadge, MAvatar, Dot) with REAL data from api.js (window.MDT): the same
   backend, session and WebSocket as the desktop web app. Kit screens that have
   no backend equivalent (dev incidents/logs, fake toggles) are not rendered.
   ============================================================================ */

const { useState, useEffect, useRef, useSyncExternalStore } = React;
const A = window.MDT.actions;

function useStore() {
  return useSyncExternalStore(window.MDT.subscribe, window.MDT.getState);
}

/* ---------- shared bits ---------- */

function hhmm(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}
function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return new Date(ts).toLocaleDateString();
}
function mmss(msLeft) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function btnS(variant) {
  const base = { flex: 1, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" };
  if (variant === "primary") return { ...base, border: "none", background: "var(--primary)", color: "#fff" };
  if (variant === "danger") return { ...base, border: "none", background: "var(--destructive)", color: "#fff" };
  return { ...base, border: "1px solid var(--border)", background: "#fff", color: "var(--foreground)" };
}

function MHeader({ title, sub, action }) {
  return (
    <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + 18px) 20px 12px", background: "#fff", position: "sticky", top: 0, zIndex: 5, borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{title}</h1>
        {action}
      </div>
      {sub && <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MiniTile({ label, value, icon, color }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 13, boxShadow: "var(--shadow-sm)" }}>
      <MI name={icon} size={16} color={color || "var(--primary)"} />
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, letterSpacing: "-.02em" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.2 }}>{label}</div>
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 2px 10px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{children}</h2>
      {right}
    </div>
  );
}

function Toggle({ on, set, color = "var(--status-accepted)" }) {
  return (
    <button onClick={() => set(!on)} style={{ width: 44, height: 26, borderRadius: 99, border: "none", position: "relative", flex: "none", cursor: "pointer", background: on ? color : "var(--status-neutral-bg)", transition: "background .2s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
    </button>
  );
}

function Stepper({ label, value, onDelta, min = 0 }) {
  const bs = (dis) => ({ width: 26, height: 26, borderRadius: 8, border: "1px solid var(--border)", background: dis ? "var(--secondary)" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: dis ? "default" : "pointer", opacity: dis ? 0.45 : 1 });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button onClick={() => value > min && onDelta(-1)} style={bs(value <= min)}><MI name="minus" size={13} color="var(--foreground)" /></button>
        <span style={{ fontSize: 15, fontWeight: 700, minWidth: 18, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button onClick={() => onDelta(1)} style={bs(false)}><MI name="plus" size={13} color="var(--foreground)" /></button>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", background: "var(--secondary)", borderRadius: 12 }}>
      <MI name="search" size={16} color="var(--muted-foreground)" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, width: "100%", fontFamily: "inherit" }} />
    </div>
  );
}

const inputS = { width: "100%", height: 44, border: "1px solid var(--border)", borderRadius: 12, padding: "0 14px", fontSize: 15, outline: "none", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" };

/* Presence: a hospitalist shows on-shift (working); anyone with a live socket
   shows online. */
function presenceOf(st, userId) {
  if (st.online[userId]) return "online";
  const p = st.physicians.find((x) => x.userId === userId);
  if (p) return p.working ? "working" : "offline";
  return "offline";
}

/* ---------- login ---------- */

function LoginView({ st }) {
  const [org, setOrg] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = (e) => {
    if (e) e.preventDefault();
    if (!org.trim() || !user.trim() || !pass || busy) return;
    setBusy(true);
    A.login(org.trim(), user.trim(), pass).catch(() => {}).then(() => setBusy(false));
  };
  return (
    <form onSubmit={submit} style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 26px calc(env(safe-area-inset-bottom, 0px) + 40px)", background: "#F2F4F8" }}>
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <span style={{ width: 74, height: 74, borderRadius: 20, background: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-lg)" }}>
          <span style={{ color: "#fff", fontSize: 40, fontWeight: 800, fontFamily: "var(--font-sans)" }}>D</span>
        </span>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "16px 0 4px", letterSpacing: "-0.02em" }}>DocTurn</h1>
        <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Secure clinical messaging &amp; assignments</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input style={inputS} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Organization code" autoCapitalize="characters" autoCorrect="off" autoComplete="organization" />
        <input style={inputS} value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" autoCapitalize="none" autoCorrect="off" autoComplete="username" />
        <input style={inputS} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" />
      </div>
      {st.loginError && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: "var(--status-rejected-bg)", color: "var(--status-rejected)", fontSize: 13, fontWeight: 600 }}>
          <MI name="triangle-alert" size={15} color="var(--status-rejected)" style={{ marginTop: 1 }} />{st.loginError}
        </div>
      )}
      <button type="submit" disabled={busy} style={{ ...btnS("primary"), marginTop: 16, height: 48, fontSize: 15.5, opacity: busy ? 0.7 : 1, flex: "none" }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div style={{ marginTop: 18, textAlign: "center", fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
        <MI name="lock" size={12} color="var(--muted-foreground)" />HIPAA-aware · sessions expire after 15 min idle
      </div>
    </form>
  );
}

/* ---------- broadcast banner + toast ---------- */

function BroadcastBanner({ st }) {
  const b = st.broadcasts.find((x) => !x.acked);
  if (!b) return null;
  const tone = b.severity === "critical" ? ["var(--status-rejected)", "var(--status-rejected-bg)"] : b.severity === "info" ? ["var(--primary)", "var(--status-active-bg)"] : ["var(--status-pending)", "var(--status-pending-bg)"];
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 90, padding: "calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px", background: tone[1], borderBottom: `2px solid ${tone[0]}`, display: "flex", gap: 10, alignItems: "center", boxShadow: "var(--shadow-lg)" }}>
      <MI name="megaphone" size={19} color={tone[0]} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: tone[0] }}>{b.severity} broadcast</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--foreground)" }}>{b.message}</div>
      </div>
      <button onClick={() => A.ackBroadcast(b.id)} style={{ flex: "none", padding: "8px 14px", borderRadius: 99, border: "none", background: tone[0], color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Acknowledge</button>
    </div>
  );
}

function ToastView({ st }) {
  if (!st.toast) return null;
  const err = st.toast.tone === "err";
  return (
    <div style={{ position: "fixed", left: "50%", bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)", transform: "translateX(-50%)", zIndex: 95, background: err ? "var(--status-rejected)" : "#1E293B", color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "11px 18px", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.25)", maxWidth: "86vw", textAlign: "center", pointerEvents: "none" }}>
      {st.toast.title}
    </div>
  );
}

/* ---------- hospitalist dashboard (live) ---------- */

function DashLive({ st }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!st.pending.length) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [st.pending.length]);

  const me = st.session;
  const mine = st.myHospitalist;
  const census = mine ? mine.census : st.myPatients.length;
  const working = mine ? mine.working : false;

  const rot = st.physicians.filter((p) => p.working).sort((a, b) => a.census - b.census);
  return (
    <div>
      <MHeader title="Dashboard" sub={me.name} action={mine && (
        <button onClick={() => A.setWorking(!working)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
          <Dot status={working ? "accepted" : "offline"} pulse={working} />{working ? "On shift" : "Off"}
        </button>)} />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <MiniTile label="Census" value={census} icon="users" />
          <MiniTile label="Pending" value={st.pending.length} icon="clock" color="var(--status-pending)" />
          <MiniTile label="Cap" value={mine ? mine.cap : "—"} icon="gauge" color="var(--status-neutral)" />
        </div>

        {rot.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 14, boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <MI name="route" size={15} color="var(--primary)" />
                <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>Round-robin</span>
              </div>
              <MBadge status="sent">{rot.length} on shift</MBadge>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {rot.slice(0, 6).map((r, i) => {
                const isMe = r.userId === me.id;
                return (
                  <div key={r.id} style={{ flex: 1, minWidth: 52, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ position: "relative", paddingTop: i === 0 ? 6 : 0 }}>
                      {i === 0 && <span style={{ position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)", fontSize: 8.5, fontWeight: 800, color: "#fff", background: "var(--status-accepted)", borderRadius: 99, padding: "1px 5px", whiteSpace: "nowrap", zIndex: 2 }}>NEXT</span>}
                      <MAvatar initials={window.MDT.initials(r.displayName)} size={isMe ? 40 : 36} tint={i === 0 ? "emerald" : isMe ? "blue" : "slate"} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: isMe ? "var(--primary)" : "var(--muted-foreground)", whiteSpace: "nowrap" }}>{isMe ? "You" : window.MDT.initials(r.displayName)} · {r.census}</span>
                  </div>
                );
              })}
            </div>
            {rot[0] && <div style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6 }}>
              <MI name="arrow-right" size={13} color="var(--status-accepted)" />Next admit → <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{rot[0].displayName}</b> · lowest census
            </div>}
          </div>
        )}

        <IncomingList st={st} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 2px 8px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>My patients</h2>
          {st.myPatients.length > 0 && <MBadge status="accepted" icon="users">{st.myPatients.length}</MBadge>}
        </div>
        {st.myPatients.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 20, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No patients on your census yet.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
            {st.myPatients.map((p, i) => (
              <div key={p.id} style={{ display: "flex", gap: 11, alignItems: "center", padding: "10px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <MAvatar initials={p.initials} size={36} tint="emerald" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{p.initials} · Rm {p.room}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.complaint || "—"}</div>
                </div>
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", flex: "none" }}>{ago(p.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IncomingList({ st }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 2px 8px" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Incoming</h2>
        {st.pending.length > 0 && <MBadge status="pending" icon="clock">{st.pending.length} awaiting</MBadge>}
      </div>
      {st.pending.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 24, textAlign: "center" }}>
          <MI name="inbox" size={22} color="var(--muted-foreground)" />
          <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>No pending assignments</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>You're all caught up.</div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {st.pending.map((p) => (
          <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 11, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <MAvatar initials={p.initials} size={36} tint="amber" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>{p.initials} · Rm {p.room}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600, color: "var(--status-pending)", marginLeft: "auto", flex: "none" }}><MI name="clock" size={11} />{mmss(p.expiresAt - Date.now())}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.complaint} · {p.via} · from {p.from}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
              <button onClick={() => A.decline(p.id)} style={btnS("outline")}><MI name="x" size={15} />Decline</button>
              <button onClick={() => A.accept(p.id)} style={btnS("primary")}><MI name="check" size={15} color="#fff" />Accept</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- ER intake (live) ---------- */

const SENT_BADGE = {
  pending: ["pending", "Routing"],
  accepted: ["accepted", "Accepted"],
  rejected: ["rejected", "Declined"],
  expired: ["offline", "Expired"],
  cancelled: ["offline", "Re-routed"],
};

function ERIntakeLive({ st, showBroadcast }) {
  const [init, setInit] = useState("");
  const [room, setRoom] = useState("");
  const [complaint, setComplaint] = useState("");
  const [specialty, setSpecialty] = useState("General Medicine");
  const [acuity, setAcuity] = useState(0);
  const [provider, setProvider] = useState(0); // 0 = auto round-robin
  const [busy, setBusy] = useState(false);

  const specialties = ["General Medicine"].concat(
    Array.from(new Set(st.physicians.map((p) => p.specialty).filter((s) => s && s !== "General Medicine"))),
  );
  const eligible = st.physicians.filter((p) => p.working).sort((a, b) => a.census - b.census);
  const nextUp = eligible[0];

  const send = () => {
    const ini = init.trim().toUpperCase();
    if (!ini || busy) { if (!ini) window.__mtoast("Add the patient's initials"); return; }
    setBusy(true);
    A.sendAdmission({
      initials: ini.slice(0, 4), room: room.trim(), complaint: complaint.trim(),
      specialty, acuity: acuity || undefined, hospitalistId: provider || undefined,
    }).then((ok) => {
      setBusy(false);
      if (ok) { setInit(""); setRoom(""); setComplaint(""); setAcuity(0); setProvider(0); }
    });
  };

  const chip = (on) => ({ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 99, cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary)" : "#fff", color: on ? "#fff" : "var(--foreground)" });
  const lbl = { fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--muted-foreground)" };

  return (
    <div>
      <MHeader title="Intake" sub={st.session.name} />
      <div style={{ padding: 16 }}>
        {showBroadcast && <BroadcastCard />}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 15, boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <MI name="clipboard-plus" size={15} color="var(--primary)" />
            <span style={{ fontSize: 14, fontWeight: 700 }}>New admission</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inputS, flex: 1 }} value={init} onChange={(e) => setInit(e.target.value)} placeholder="Initials (e.g. AB)" maxLength={4} autoCapitalize="characters" />
            <input style={{ ...inputS, flex: 1 }} value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" />
          </div>
          <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Chief complaint / issue summary…"
            style={{ width: "100%", minHeight: 56, background: "var(--secondary)", borderRadius: 11, padding: "10px 12px", fontSize: 13.5, color: "var(--foreground)", lineHeight: 1.4, border: "none", outline: "none", resize: "none", fontFamily: "inherit", boxSizing: "border-box", marginTop: 8 }} />

          <div style={{ marginTop: 12 }}>
            <span style={lbl}>Specialty</span>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2, marginTop: 7 }}>
              {specialties.map((s) => (
                <button key={s} onClick={() => setSpecialty(s)} style={chip(s === specialty)}>{s}</button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <span style={lbl}>Acuity (optional)</span>
            <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setAcuity(acuity === n ? 0 : n)} style={{ ...chip(acuity === n), flex: 1, justifyContent: "center" }}>{n}</button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={lbl}>Route to</span>
              {!provider && <MBadge status="sent" icon="route">Round-robin</MBadge>}
            </div>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
              <button onClick={() => setProvider(0)} style={chip(!provider)}>Auto</button>
              {eligible.map((p) => (
                <button key={p.id} onClick={() => setProvider(p.id)} style={chip(provider === p.id)}>{p.displayName} · {p.census}/{p.cap}</button>
              ))}
            </div>
            {!provider && nextUp && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, padding: "8px 10px", background: "var(--secondary)", borderRadius: 10 }}>
                <MAvatar initials={window.MDT.initials(nextUp.displayName)} size={28} tint="blue" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>Next up · {nextUp.displayName}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{nextUp.specialty} · lowest census ({nextUp.census}/{nextUp.cap})</div>
                </div>
              </div>
            )}
            {eligible.length === 0 && (
              <div style={{ marginTop: 9, fontSize: 12.5, color: "var(--status-rejected)", fontWeight: 600 }}>No hospitalist is on shift right now.</div>
            )}
          </div>

          <button onClick={send} disabled={busy} style={{ ...btnS("primary"), width: "100%", marginTop: 14, height: 44, fontSize: 14.5, opacity: busy ? 0.7 : 1 }}>
            <MI name="send" size={15} color="#fff" />{busy ? "Routing…" : "Route admission"}
          </button>
        </div>

        <SectionLabel right={st.sent.length > 0 && <MBadge status="sent">{st.sent.length}</MBadge>}>Recently sent</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {st.sent.length === 0 && <div style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 20, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Nothing routed yet.</div>}
          {st.sent.slice(0, 25).map((s) => {
            const [tone, label] = SENT_BADGE[s.status] || SENT_BADGE.pending;
            return (
              <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 13, boxShadow: "var(--shadow-sm)" }}>
                <MAvatar initials={s.initials} size={40} tint="slate" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.complaint || s.initials + (s.room ? " · Rm " + s.room : "")}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>→ {s.provider} · {ago(s.at)}</div>
                </div>
                <MBadge status={tone}>{label}</MBadge>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- broadcast compose (director / ER director) ---------- */

function BroadcastCard() {
  const [msg, setMsg] = useState("");
  const [sev, setSev] = useState("urgent");
  const [busy, setBusy] = useState(false);
  const send = () => {
    if (!msg.trim() || busy) return;
    setBusy(true);
    A.sendBroadcast(msg.trim(), sev).then((ok) => { setBusy(false); if (ok) setMsg(""); });
  };
  const tones = { info: "var(--primary)", urgent: "var(--status-pending)", critical: "var(--status-rejected)" };
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 15, boxShadow: "var(--shadow-sm)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <MI name="megaphone" size={15} color="var(--status-rejected)" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Emergency broadcast</span>
      </div>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message to everyone in the organization…"
        style={{ width: "100%", minHeight: 48, background: "var(--secondary)", borderRadius: 11, padding: "10px 12px", fontSize: 13.5, border: "none", outline: "none", resize: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
        {["info", "urgent", "critical"].map((s) => (
          <button key={s} onClick={() => setSev(s)} style={{ flex: 1, padding: "7px 0", borderRadius: 99, cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-sans)", textTransform: "capitalize", border: sev === s ? `1px solid ${tones[s]}` : "1px solid var(--border)", background: sev === s ? tones[s] : "#fff", color: sev === s ? "#fff" : "var(--muted-foreground)" }}>{s}</button>
        ))}
      </div>
      <button onClick={send} disabled={busy || !msg.trim()} style={{ ...btnS("danger"), width: "100%", marginTop: 10, opacity: busy || !msg.trim() ? 0.6 : 1 }}>
        <MI name="megaphone" size={15} color="#fff" />Send broadcast
      </button>
    </div>
  );
}

/* ---------- director overview (live) ---------- */

function DirectorHomeLive({ st }) {
  const onShift = st.physicians.filter((p) => p.working);
  const totalCensus = st.physicians.reduce((a, p) => a + p.census, 0);
  const totalCap = st.physicians.reduce((a, p) => a + p.cap, 0);
  const queue = [...onShift].sort((a, b) => a.census - b.census);
  return (
    <div>
      <MHeader title="Overview" sub={st.session.name} />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <MiniTile label="On shift" value={onShift.length} icon="activity" color="var(--status-accepted)" />
          <MiniTile label="Providers" value={st.physicians.length} icon="users" />
          <MiniTile label="Census" value={totalCensus + "/" + totalCap} icon="bed-double" color="var(--status-neutral)" />
        </div>

        <BroadcastCard />

        {st.pending.length > 0 && <div style={{ marginBottom: 16 }}><IncomingList st={st} /></div>}

        <SectionLabel right={queue[0] && <MBadge status="sent">Next: {window.MDT.initials(queue[0].displayName)}</MBadge>}>Providers</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {st.physicians.map((p) => {
            const isNext = queue[0] && p.id === queue[0].id;
            return (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: `1px solid ${isNext ? "var(--primary)" : "var(--border)"}`, boxShadow: "var(--shadow-sm)", padding: 12, opacity: p.working ? 1 : 0.62 }}>
                <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: "none" }}>
                    <MAvatar initials={window.MDT.initials(p.displayName)} size={38} tint={p.working ? "emerald" : "slate"} />
                    <span style={{ position: "absolute", bottom: 0, right: 0, border: "2px solid #fff", borderRadius: 99 }}><Dot status={p.working ? "accepted" : "offline"} pulse={p.working} /></span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.displayName}{isNext && <MBadge status="sent">Next</MBadge>}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{p.specialty} · {p.shiftType}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: "none" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Shift</span>
                    <Toggle on={p.working} set={(v) => A.setProviderWorking(p.id, v)} />
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                  <Stepper label="Census" value={p.census} onDelta={(d) => A.adjustCensus(p.id, d)} />
                  <Stepper label="Cap" value={p.cap} onDelta={(d) => A.adjustCap(p.id, d)} min={1} />
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{p.census}/{p.cap} patients</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- messaging (live) ---------- */

function MessagesLive({ st }) {
  const [q, setQ] = useState("");
  const [composing, setComposing] = useState(false);
  const open = st.conversations.find((c) => c.id === st.activeConvo);

  if (open) return <ThreadLive st={st} convo={open} />;
  if (composing) return <ComposeLive st={st} onBack={() => setComposing(false)} />;

  const list = st.conversations.filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()) || (c.last && c.last.text.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <div>
      <MHeader title="Messages" action={
        <button onClick={() => setComposing(true)} style={{ width: 40, height: 40, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><MI name="pen-square" size={18} color="var(--primary)" /></button>} />
      <div style={{ padding: "12px 16px" }}><SearchBox value={q} onChange={setQ} placeholder="Search" /></div>
      <div>
        {list.map((c, i) => {
          const someoneTyping = Object.keys(st.typing[c.id] || {}).length > 0;
          const presence = c.otherUserId ? presenceOf(st, c.otherUserId) : null;
          return (
            <button key={c.id} onClick={() => A.openConversation(c.id)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 13, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none", alignItems: "center", background: "transparent", border: "none", borderTopColor: "var(--border)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <div style={{ position: "relative" }}>
                <MAvatar initials={c.initials} tint={c.broadcast ? "slate" : c.group ? "blue" : "emerald"} />
                {c.group ? <span style={{ position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: 99, background: "var(--primary)", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}><MI name="users" size={9} color="#fff" /></span>
                  : presence && <span style={{ position: "absolute", bottom: 0, right: 0, border: "2px solid #fff", borderRadius: 99 }}><Dot status={presence === "offline" ? "offline" : "accepted"} /></span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)", flex: "none", marginLeft: 8 }}>{c.last ? ago(c.last.at) : ""}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: someoneTyping ? "var(--status-active)" : "var(--muted-foreground)", fontWeight: someoneTyping ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {someoneTyping ? "typing…" : (c.last ? (c.last.me ? "You: " : "") + c.last.text : "New conversation")}
                  </span>
                  {c.unread > 0 && <span style={{ flex: "none", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 99, background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.unread}</span>}
                </div>
              </div>
            </button>
          );
        })}
        {list.length === 0 && (
          <div style={{ textAlign: "center", padding: 34, color: "var(--muted-foreground)", fontSize: 14 }}>
            {st.conversations.length === 0 ? <>No conversations yet.<br />Start one with the compose button.</> : `No conversations match "${q}".`}
          </div>
        )}
      </div>
    </div>
  );
}

function ComposeLive({ st, onBack }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const people = st.people.filter((p) => !p.me);
  const list = people.filter((p) =>
    p.displayName.toLowerCase().includes(q.toLowerCase()) || window.MDT.roleLabel(p.role).toLowerCase().includes(q.toLowerCase()),
  );
  const toggle = (p) => setSel((s) => s.find((x) => x.userId === p.userId) ? s.filter((x) => x.userId !== p.userId) : [...s, p]);
  const isGroup = sel.length > 1;
  const start = () => {
    if (!sel.length || busy) return;
    setBusy(true);
    A.startConversation(sel.map((s) => s.userId)).then(() => { setBusy(false); onBack(); });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + 14px) 14px 11px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, background: "#fff", zIndex: 5 }}>
        <button onClick={onBack} style={{ width: 34, height: 34, borderRadius: 99, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}><MI name="x" size={22} color="var(--primary)" /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>New message</div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{sel.length === 0 ? "Pick one or more people" : isGroup ? sel.length + " people · group" : "Direct message"}</div>
        </div>
        <button onClick={start} disabled={!sel.length || busy} style={{ padding: "8px 15px", borderRadius: 99, border: "none", background: sel.length ? "var(--primary)" : "var(--secondary)", color: sel.length ? "#fff" : "var(--muted-foreground)", fontSize: 13.5, fontWeight: 600, cursor: sel.length ? "pointer" : "default", fontFamily: "var(--font-sans)", flex: "none" }}>{busy ? "Starting…" : isGroup ? "Create group" : "Start"}</button>
      </div>
      {sel.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "11px 16px", borderBottom: "1px solid var(--border)" }}>
          {sel.map((u) => (
            <button key={u.userId} onClick={() => toggle(u)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 5px", borderRadius: 99, border: "none", background: "var(--secondary)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <MAvatar initials={window.MDT.initials(u.displayName)} size={22} tint="blue" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{u.displayName.replace(/^Dr\.\s/, "")}</span>
              <MI name="x" size={13} color="var(--muted-foreground)" />
            </button>
          ))}
        </div>
      )}
      <div style={{ padding: "12px 16px 8px" }}><SearchBox value={q} onChange={setQ} placeholder="Search people or role" /></div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {list.map((u, i) => {
          const on = !!sel.find((x) => x.userId === u.userId);
          return (
            <button key={u.userId} onClick={() => toggle(u)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none", alignItems: "center", background: on ? "var(--secondary)" : "transparent", border: "none", borderTopColor: "var(--border)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <MAvatar initials={window.MDT.initials(u.displayName)} size={36} tint={u.role === "er_doctor" || u.role === "er_director" ? "amber" : "blue"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{u.displayName}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{window.MDT.roleLabel(u.role)}{u.credential ? " · " + u.credential : ""}</div>
              </div>
              <span style={{ width: 22, height: 22, borderRadius: 99, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", border: on ? "none" : "1.5px solid var(--border)", background: on ? "var(--primary)" : "transparent" }}>{on && <MI name="check" size={14} color="#fff" />}</span>
            </button>
          );
        })}
        {list.length === 0 && <div style={{ textAlign: "center", padding: 30, color: "var(--muted-foreground)", fontSize: 14 }}>No people match.</div>}
      </div>
    </div>
  );
}

function ThreadLive({ st, convo }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef(null);
  const someoneTyping = Object.keys(st.typing[convo.id] || {}).length > 0;
  const presence = convo.otherUserId ? presenceOf(st, convo.otherUserId) : null;
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [convo.messages.length, someoneTyping]);
  // Mark newly-arrived messages read while the thread is open.
  useEffect(() => { if (convo.unread > 0) A.openConversation(convo.id); }, [convo.unread]);

  const send = () => {
    if (!draft.trim() || convo.broadcast) return;
    A.sendMessage(convo.id, draft);
    setDraft("");
  };
  const lastMineIdx = convo.messages.map((m) => m.me).lastIndexOf(true);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#F2F4F8" }}>
      <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + 12px) 14px 11px", background: "#fff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 11, flex: "none" }}>
        <button onClick={() => A.closeConversation()} style={{ width: 34, height: 34, borderRadius: 99, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}><MI name="chevron-left" size={22} color="var(--primary)" /></button>
        <MAvatar initials={convo.initials} size={36} tint={convo.broadcast ? "slate" : convo.group ? "blue" : "emerald"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{convo.name}</div>
          <div style={{ fontSize: 12, color: someoneTyping ? "var(--status-active)" : "var(--status-accepted)" }}>
            {someoneTyping ? "typing…" : convo.group ? convo.participantIds.length + " members" : presence === "online" ? "Online" : presence === "working" ? "On shift" : convo.sub || "Offline"}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 5, background: "var(--secondary)", color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 99, marginBottom: 4 }}>
          <MI name="lock" size={11} color="var(--muted-foreground)" />Encrypted in transit · access audited
        </div>
        {convo.messages.map((m, i) => (
          <div key={m.id || i} style={{ display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "78%", padding: "9px 13px", borderRadius: 16, fontSize: 14, lineHeight: 1.4, wordBreak: "break-word",
              background: m.me ? "var(--primary)" : "#fff", color: m.me ? "#fff" : "var(--foreground)",
              border: m.me ? "none" : "1px solid var(--border)", borderBottomRightRadius: m.me ? 5 : 16, borderBottomLeftRadius: m.me ? 16 : 5 }}>{m.text}</div>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>
              {hhmm(m.at)}
              {m.me && i === lastMineIdx && (m.pending
                ? <>&nbsp;· sending…</>
                : <>&nbsp;·&nbsp;<MI name="check-check" size={12} color="var(--status-accepted)" />&nbsp;Delivered</>)}
            </span>
          </div>
        ))}
        {someoneTyping && (
          <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 16, borderBottomLeftRadius: 5, background: "#fff", border: "1px solid var(--border)", display: "flex", gap: 4 }}>
            {[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--muted-foreground)", animation: "dt-pulse 1.2s infinite", animationDelay: d * 0.18 + "s" }} />)}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "10px 12px calc(env(safe-area-inset-bottom, 0px) + 10px)", background: "#fff", borderTop: "1px solid var(--border)", display: "flex", gap: 9, alignItems: "center", flex: "none" }}>
        <input value={draft}
          onChange={(e) => { setDraft(e.target.value); A.setTyping(convo.id, !!e.target.value.trim()); }}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={convo.broadcast ? "Replies disabled" : "Message…"} disabled={convo.broadcast}
          style={{ flex: 1, height: 40, border: "1px solid var(--border)", borderRadius: 20, padding: "0 15px", fontSize: 14, outline: "none", fontFamily: "inherit", background: convo.broadcast ? "var(--secondary)" : "#fff" }} />
        <button onClick={send} style={{ width: 40, height: 40, borderRadius: 99, border: "none", background: draft.trim() ? "var(--primary)" : "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}><MI name="arrow-up" size={18} color={draft.trim() ? "#fff" : "var(--muted-foreground)"} /></button>
      </div>
    </div>
  );
}

/* ---------- on call / directory (live) ---------- */

function PersonRow({ st, p, i, onMessage, sub, tint }) {
  const presence = presenceOf(st, p.userId);
  const on = presence !== "offline";
  return (
    <div key={p.userId} style={{ display: "flex", gap: 11, padding: "9px 16px", alignItems: "center", borderTop: i ? "1px solid var(--border)" : "none" }}>
      <div style={{ position: "relative", flex: "none" }}>
        <MAvatar initials={window.MDT.initials(p.displayName)} size={34} tint={tint || (on ? "emerald" : "slate")} />
        <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><Dot status={on ? "accepted" : "offline"} pulse={presence === "online"} /></span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.displayName}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: on ? "var(--status-accepted)" : "var(--muted-foreground)", flex: "none" }}>{presence === "online" ? "Online" : presence === "working" ? "On" : "Off"}</span>
      {!p.me && (
        <button onClick={() => onMessage(p.userId)} style={{ width: 34, height: 34, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}>
          <MI name="message-square" size={15} color="var(--primary)" />
        </button>
      )}
    </div>
  );
}

function TeamLive({ st, onMessage }) {
  const physByUser = {};
  st.physicians.forEach((p) => { physByUser[p.userId] = p; });
  const onShift = st.physicians.filter((p) => p.working);
  const erDocs = st.people.filter((p) => (p.role === "er_doctor" || p.role === "er_director") && !p.me);
  const offShift = st.physicians.filter((p) => !p.working);
  const Group = ({ icon, label, items, render }) => items.length > 0 && (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 18px 7px" }}>
        <MI name={icon} size={13} color="var(--muted-foreground)" />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted-foreground)" }}>{items.length}</span>
      </div>
      <div style={{ background: "#fff", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>{items.map(render)}</div>
    </div>
  );
  return (
    <div>
      <MHeader title="On call" action={<MBadge status="accepted" icon="circle">{onShift.length} on shift</MBadge>} />
      <div style={{ padding: "14px 0" }}>
        <Group icon="stethoscope" label="Hospitalists on shift" items={onShift}
          render={(p, i) => <PersonRow key={p.userId} st={st} p={p} i={i} onMessage={onMessage} sub={`${p.specialty} · ${p.census}/${p.cap} patients`} tint="emerald" />} />
        <Group icon="ambulance" label="ER physicians" items={erDocs}
          render={(p, i) => <PersonRow key={p.userId} st={st} p={p} i={i} onMessage={onMessage} sub={window.MDT.roleLabel(p.role)} tint="amber" />} />
        <Group icon="moon" label="Off shift" items={offShift}
          render={(p, i) => <PersonRow key={p.userId} st={st} p={p} i={i} onMessage={onMessage} sub={p.specialty} tint="slate" />} />
      </div>
    </div>
  );
}

function DirectoryLive({ st, onMessage }) {
  const [q, setQ] = useState("");
  const physByUser = {};
  st.physicians.forEach((p) => { physByUser[p.userId] = p; });
  const everyone = st.people
    .map((p) => ({ ...p, sub: physByUser[p.userId] ? physByUser[p.userId].specialty : window.MDT.roleLabel(p.role) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const list = everyone.filter((p) => p.displayName.toLowerCase().includes(q.toLowerCase()) || p.sub.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <MHeader title="Directory" action={<MBadge status="offline">{everyone.length}</MBadge>} />
      <div style={{ padding: "12px 16px 8px" }}><SearchBox value={q} onChange={setQ} placeholder="Search everyone" /></div>
      <div style={{ background: "#fff", borderTop: "1px solid var(--border)" }}>
        {list.map((p, i) => (
          <PersonRow key={p.userId} st={st} p={p} i={i} onMessage={onMessage}
            sub={p.sub + (p.credential ? " · " + p.credential : "") + (p.me ? " · you" : "")} />
        ))}
        {list.length === 0 && <div style={{ textAlign: "center", padding: 30, color: "var(--muted-foreground)", fontSize: 14 }}>No matches for "{q}".</div>}
      </div>
    </div>
  );
}

/* ---------- profile (live) ---------- */

function ProfileLive({ st }) {
  const me = st.session;
  const mine = st.myHospitalist;
  const Row = ({ icon, title, sub, control, last }) => (
    <div style={{ display: "flex", gap: 13, alignItems: "center", padding: "13px 16px", borderTop: last ? "none" : "1px solid var(--border)" }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name={icon} size={18} color="var(--primary)" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{sub}</div>
      </div>
      {control}
    </div>
  );
  return (
    <div>
      <MHeader title="Profile" />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 15, alignItems: "center", background: "#fff", border: "1px solid var(--border)", borderRadius: 18, padding: 18, boxShadow: "var(--shadow-sm)" }}>
          <MAvatar initials={window.MDT.initials(me.name)} size={58} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{me.name}</div>
            <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{window.MDT.roleLabel(me.role)}{me.credential ? " · " + me.credential : ""}</div>
            <div style={{ marginTop: 7 }}>
              <MBadge status={st.wsUp ? "accepted" : "offline"} icon="circle">{st.wsUp ? "Live connection" : "Reconnecting…"}</MBadge>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, background: "#fff", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
          {mine && <Row icon="activity" title="Available for assignments" last
            sub={mine.working ? "On shift — receiving admissions" : "Off shift — not in rotation"}
            control={<Toggle on={mine.working} set={(v) => A.setWorking(v)} />} />}
          <Row icon="building-2" title="Organization" sub={me.orgCode ? me.orgCode : "Signed in as @" + me.username} control={null} last={!mine} />
          <Row icon="clock" title="Session" sub="Signs out after 15 min of inactivity" control={null} />
          <Row icon="lock" title="Security" sub="TLS in transit · patients shown by initials only · access audited" control={<MBadge status="accepted" icon="check">On</MBadge>} />
        </div>

        <button onClick={() => A.logout()} style={{ width: "100%", marginTop: 16, height: 46, borderRadius: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--destructive)", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
          <MI name="log-out" size={17} />Sign out
        </button>
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
          DocTurn mobile · same account &amp; data as the desktop app
        </div>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

const SHARED_TABS = [
  ["messages", "Messages", "message-square"],
  ["team", "On call", "users"],
  ["directory", "Directory", "contact"],
  ["profile", "Profile", "user"],
];
const TABSETS = {
  hospitalist: [["home", "Dashboard", "layout-dashboard"], ...SHARED_TABS],
  er_doctor: [["home", "Intake", "clipboard-plus"], ...SHARED_TABS],
  er_director: [["home", "ER ops", "ambulance"], ...SHARED_TABS],
  director: [["home", "Overview", "layout-dashboard"], ...SHARED_TABS],
  developer: SHARED_TABS,
};

function MTabBar({ tabs, active, onTab, badge }) {
  return (
    <div style={{ flex: "none", zIndex: 10, display: "flex", background: "rgba(255,255,255,.96)", backdropFilter: "blur(12px)", borderTop: "1px solid var(--border)", padding: "8px 6px calc(env(safe-area-inset-bottom, 0px) + 10px)" }}>
      {tabs.map(([id, label, icon]) => {
        const on = active === id;
        return (
          <button key={id} onClick={() => onTab(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer", padding: "4px 0", position: "relative", fontFamily: "var(--font-sans)" }}>
            <span style={{ position: "relative" }}>
              <MI name={icon} size={23} color={on ? "var(--primary)" : "var(--status-neutral)"} strokeWidth={on ? 2.4 : 2} />
              {id === "messages" && badge > 0 && <span style={{ position: "absolute", top: -4, right: -7, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 99, background: "var(--destructive)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: on ? "var(--primary)" : "var(--status-neutral)" }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Shell({ st }) {
  const tabs = TABSETS[st.session.role] || SHARED_TABS;
  const [tab, setTab] = useState(tabs[0][0]);
  const unread = st.conversations.reduce((a, c) => a + (c.unread || 0), 0);
  const goMessage = (userId) => { A.startConversation([userId]); setTab("messages"); };

  let screen;
  if (tab === "home") {
    if (st.session.role === "er_doctor") screen = <ERIntakeLive st={st} />;
    else if (st.session.role === "er_director") screen = <ERIntakeLive st={st} showBroadcast />;
    else if (st.session.role === "director") screen = <DirectorHomeLive st={st} />;
    else screen = <DashLive st={st} />;
  } else if (tab === "messages") screen = <MessagesLive st={st} />;
  else if (tab === "team") screen = <TeamLive st={st} onMessage={goMessage} />;
  else if (tab === "directory") screen = <DirectoryLive st={st} onMessage={goMessage} />;
  else screen = <ProfileLive st={st} />;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#F2F4F8" }}>
      <BroadcastBanner st={st} />
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>{screen}</div>
      </div>
      <MTabBar tabs={tabs} active={tab} onTab={setTab} badge={unread} />
      <ToastView st={st} />
    </div>
  );
}

function App() {
  const st = useStore();
  if (st.booting) {
    return (
      <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F2F4F8" }}>
        <span style={{ width: 64, height: 64, borderRadius: 18, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 34, fontWeight: 800 }}>D</span>
      </div>
    );
  }
  if (!st.session) return <LoginView st={st} />;
  return <Shell st={st} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
