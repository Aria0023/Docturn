/* DocTurn web-app UI kit — App lock screen (HIPAA session security).
   Shows on manual lock or after inactivity. Unlock with a 4-digit PIN
   (any code, demo) or "Face ID". Mirrors the mobile app-lock + the 15-min
   session-timeout policy. Self-contained; calls onUnlock() to dismiss. */

function LockScreen({ me, appName, reason, onUnlock }) {
  const who = me || { name: "Dr. Jordan Chen", avatar: "JC", role: "Director" };
  const [pin, setPin] = React.useState("");
  const [shake, setShake] = React.useState(false);

  const press = (d) => {
    setPin((p) => {
      if (p.length >= 4) return p;
      const next = p + d;
      if (next.length === 4) setTimeout(() => onUnlock(), 260);
      return next;
    });
  };
  const back = () => setPin((p) => p.slice(0, -1));
  const faceId = () => { setShake(false); setTimeout(() => onUnlock(), 500); };

  React.useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "face", "0", "back"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "linear-gradient(160deg,#0b1220 0%,#172033 60%,#1e293b 100%)", display: "flex", alignItems: "center", justifyContent: "center", animation: "dt-toast-in .2s ease" }}>
      <div style={{ width: 320, textAlign: "center", color: "#fff" }}>
        {/* brand + lock */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 26 }}>
          <span style={{ width: 56, height: 56, borderRadius: 16, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(37,99,235,.4)" }}><Icon name="lock" size={26} color="#fff" /></span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{appName || "DocTurn"} locked</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", marginTop: 3 }}>{reason || "Session paused for security"}</div>
          </div>
        </div>

        {/* who */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 14px 6px 6px", borderRadius: 99, background: "rgba(255,255,255,.08)", marginBottom: 22 }}>
          <span style={{ width: 30, height: 30, borderRadius: 99, background: "rgba(255,255,255,.16)", color: "#fff", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{who.avatar}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{who.name}</span>
        </div>

        {/* pin dots */}
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 28, transition: "transform .1s", transform: shake ? "translateX(0)" : "none" }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ width: 14, height: 14, borderRadius: 99, border: "1.5px solid rgba(255,255,255,.45)", background: i < pin.length ? "#fff" : "transparent", transition: "background .15s" }} />
          ))}
        </div>

        {/* keypad */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, justifyItems: "center" }}>
          {KEYS.map((k) => {
            if (k === "face") return (
              <button key={k} onClick={faceId} title="Face ID" style={lockKeyStyle(true)}>
                <Icon name="scan-face" size={24} color="rgba(255,255,255,.85)" />
              </button>
            );
            if (k === "back") return (
              <button key={k} onClick={back} title="Delete" style={lockKeyStyle(true)}>
                <Icon name="delete" size={22} color="rgba(255,255,255,.85)" />
              </button>
            );
            return (
              <button key={k} onClick={() => press(k)} style={lockKeyStyle(false)}
                onMouseDown={(e) => e.currentTarget.style.background = "rgba(255,255,255,.22)"}
                onMouseUp={(e) => e.currentTarget.style.background = "rgba(255,255,255,.1)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,.1)"}>
                {k}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 24, fontSize: 11.5, color: "rgba(255,255,255,.45)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="shield-check" size={13} color="rgba(255,255,255,.45)" />Auto-locks after 15 min idle · HIPAA
        </div>
      </div>
    </div>
  );
}

function lockKeyStyle(plain) {
  return {
    width: 66, height: 66, borderRadius: 99, border: "none", cursor: "pointer",
    background: plain ? "transparent" : "rgba(255,255,255,.1)",
    color: "#fff", fontSize: 26, fontWeight: 400, fontFamily: "var(--font-sans)",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background .12s",
  };
}

Object.assign(window, { LockScreen });
