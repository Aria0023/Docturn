import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Field, Icon } from "@/components/kit";

const DEMO: Array<[string, string, string]> = [
  ["hospitalist", "chen", "Hospitalist"],
  ["er_doctor", "er.doc", "ER physician"],
  ["er_director", "er.director", "ER director"],
  ["director", "director", "Hosp. director"],
  ["developer", "dev", "Developer"],
];
const ROLE_ICON: Record<string, string> = {
  hospitalist: "stethoscope",
  er_doctor: "ambulance",
  er_director: "siren",
  director: "clipboard-list",
  developer: "terminal",
};

export function Login() {
  const { refresh } = useAuth();
  const [orgCode, setOrgCode] = useState("MERCY");
  const [username, setUsername] = useState("chen");
  const [password, setPassword] = useState("docturn");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Second-factor step state.
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [smsSent, setSmsSent] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ twoFactorRequired?: boolean }>("/api/login", {
        orgCode,
        username,
        password,
      });
      if (res?.twoFactorRequired) {
        setMfaRequired(true); // hold for the second factor
      } else {
        await refresh();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Invalid organization, username, or password.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function completeMfa() {
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/2fa/complete-login", { code: mfaCode });
      await refresh();
    } catch {
      setError("Invalid or expired code. Try again, or use a backup code.");
    } finally {
      setLoading(false);
    }
  }

  async function requestSms() {
    try {
      await api.post("/api/2fa/request-sms");
      setSmsSent(true);
    } catch {
      setError("Couldn't send an SMS code.");
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--background)" }}>
      {/* Left: form */}
      <div style={{ flex: "1 1 50%", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>D</span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>DocTurn</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "28px 0 6px" }}>
            {mfaRequired ? "Two-factor authentication" : "Sign in"}
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted-foreground)", margin: "0 0 24px" }}>
            {mfaRequired
              ? "Enter the 6-digit code from your authenticator app, an SMS code, or a backup code."
              : "Secure access to your hospital workspace."}
          </p>

          {mfaRequired ? (
            <form onSubmit={(e) => { e.preventDefault(); void completeMfa(); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label="Verification code" icon="shield-check" value={mfaCode} onChange={setMfaCode} placeholder="123456" />
              {error && <p style={{ fontSize: 13, fontWeight: 500, color: "var(--destructive)", margin: 0 }}>{error}</p>}
              <Button full size="lg" type="submit" disabled={loading || !mfaCode}>
                {loading ? "Verifying…" : "Verify & continue"}
              </Button>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <button type="button" onClick={requestSms} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontWeight: 500 }}>
                  {smsSent ? "SMS code sent ✓" : "Send me an SMS code"}
                </button>
                <button type="button" onClick={() => { setMfaRequired(false); setMfaCode(""); setError(null); }} style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}>
                  Back
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Organization code" icon="building-2" value={orgCode} onChange={(v) => setOrgCode(v.toUpperCase())} help="Your hospital's short code." />
            <Field label="Username" icon="user" value={username} onChange={setUsername} />
            <Field label="Password" icon="lock" type="password" value={password} onChange={setPassword} />

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Quick demo login</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                {DEMO.map(([role, uname, label]) => (
                  <button key={role} type="button" onClick={() => { setUsername(uname); setPassword("docturn"); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "11px 6px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12, fontWeight: 500,
                      border: `1px solid ${username === uname ? "var(--primary)" : "var(--border)"}`,
                      background: username === uname ? "#EFF6FF" : "#fff",
                      color: username === uname ? "var(--primary)" : "var(--foreground)" }}>
                    <Icon name={ROLE_ICON[role]} size={18} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p style={{ fontSize: 13, fontWeight: 500, color: "var(--destructive)", margin: 0 }}>{error}</p>}

            <Button full size="lg" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>

            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)", justifyContent: "center" }}>
              <Icon name="shield-check" size={14} color="var(--status-accepted)" />
              HIPAA-compliant · MFA enabled · 15-min sessions
            </div>
          </form>
          )}
        </div>
      </div>

      {/* Right: brand panel */}
      <div style={{ flex: "1 1 50%", background: "var(--marketing-bg)", display: "none", alignItems: "center", justifyContent: "center", padding: 48, position: "relative", overflow: "hidden" }} className="dt-brand-panel">
        <div style={{ maxWidth: 380, position: "relative", zIndex: 2 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.7)", padding: "5px 12px", borderRadius: "99px", fontSize: 12, fontWeight: 600, color: "var(--sky-700)" }}>
            <Icon name="route" size={14} /> Patient assignment, automated
          </div>
          <h2 style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#0f172a", margin: "18px 0 12px" }}>
            Every admit reaches the right hospitalist — in seconds.
          </h2>
          <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.55, margin: 0 }}>
            Round-robin routing, real-time notifications across push and SMS, and HIPAA-compliant messaging for your whole care team.
          </p>
          <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
            {([
              ["bell-ring", "Notified instantly", "WebSocket → push → SMS cascade"],
              ["repeat", "Fair rotation", "Lowest-census provider goes next"],
              ["lock", "PHI stays protected", "Initials only, full audit trail"],
            ] as const).map(([ic, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#fff", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
                  <Icon name={ic} size={18} />
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: "#64748b" }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,.25), transparent 70%)", top: -80, right: -60 }} />
        <div style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 70%)", bottom: -70, left: -50 }} />
      </div>
    </div>
  );
}
