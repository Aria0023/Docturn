/* DocTurn web-app UI kit — Schedule Sync (Amion / external on-call import).
   Two ingestion modes:
     • API        — token-based pull (preferred, when the vendor exposes one)
     • Capture     — NO public API: DocTurn signs in on your behalf in a sandboxed
                     headless browser and parses the published on-call grid off the
                     rendered page ("rip contents off screen"). Credentials encrypted
                     server-side, read-only, every fetch audited.
   Self-contained demo component; manages its own local state. Director surface. */

// Real captured grid — Tarzana ISP hospitalist schedule (amion.com/cgi-bin/ocs).
// `secure` = "Secure message to Amion app" (onboarded) vs "Not ready to receive
// secure messages" — the onboarding signal DocTurn uses to invite the rest.
const SS_HRS = { "7a-7p": ["Day call", "amber"], "4p-12a": ["Swing", "blue"], "7p-7a": ["Nights", "slate"], "11p-7a": ["Night X-cover", "slate"] };
const SS_ROWS = [
  { slot: "Tarzana 1", hrs: "7a-7p", prov: "Alyesh, Nathan", grp: "ISP North", secure: false },
  { slot: "Tarzana 2", hrs: "7a-7p", prov: "George, Sharon", grp: "ISP North", secure: true },
  { slot: "Tarzana 3", hrs: "7a-7p", prov: "Ahmed, Amir", grp: "ISP North", secure: false },
  { slot: "Tarzana 4", hrs: "7a-7p", prov: "Kazanchyan, Moe", grp: "Moonlighter", secure: false },
  { slot: "Tarzana 5", hrs: "7a-7p", prov: "Darouichi, Joline", grp: "ISP North", secure: false },
  { slot: "Tarzana 6", hrs: "7a-7p", prov: "Gideon, Danny", grp: "ISP North", secure: false },
  { slot: "Tarzana 7", hrs: "7a-7p", prov: "Gopal, Arun", grp: "ISP Hospitalist", secure: true },
  { slot: "Tarzana 8", hrs: "7a-7p", prov: "Williams, Nicole", grp: "ISP North", secure: true },
  { slot: "Tarzana 9", hrs: "7a-7p", prov: "Malhotra, Veshal", grp: "ISP North", secure: true },
  { slot: "North Triage", hrs: "7a-7p", prov: "Williams, Nicole", grp: "ISP North", secure: true },
  { slot: "Tarzana 2 PM Swing", hrs: "4p-12a", prov: "Manukian, Naira", grp: "ISP North", secure: false },
  { slot: "Tarzana Night Triage", hrs: "7p-7a", prov: "Kohan, Salar", grp: "ISP North", secure: false },
  { slot: "Tarzana Night XC", hrs: "7p-7a", prov: "Niculescu, Alex", grp: "ISP North", secure: true },
];
const SS_MAP = [
  { code: "7a–7p",  shift: "Day call",      tint: "amber" },
  { code: "4p–12a", shift: "Swing",         tint: "blue" },
  { code: "7p–7a",  shift: "Nights",        tint: "slate" },
  { code: "11p–7a", shift: "Night X-cover", tint: "slate" },
];
// "Last, First" → "First Last"; initials from both.
function ssName(prov) { const [last, first] = prov.split(", "); return (first || "") + " " + last; }
function ssInit(prov) { const [last, first] = prov.split(", "); return ((first || " ")[0] + last[0]).toUpperCase(); }

// Amion hours → DocTurn shift type.
const SS_SHIFT = { "7a-7p": "day", "4p-12a": "swing", "7p-7a": "night", "11p-7a": "night" };

// On-call schedule sources. Each organization picks its own — different
// hospitals keep their schedule in different places, so the source is
// org-scoped AND modular by KIND: a scheduling vendor (API/sign-in capture),
// an uploaded document (Word/PDF), or a published web page. Only the Amion
// demo carries a real captured grid; the others ingest the org's own data.
const SS_SOURCES = {
  amion:      { label: "Amion",          kind: "vendor", demo: true, blurb: "amion.com on-call grid",         loginUrl: "https://www.amion.com",         api: "https://www.amion.com/api" },
  qgenda:     { label: "QGenda",         kind: "vendor", blurb: "QGenda provider schedules",                  loginUrl: "https://app.qgenda.com",        api: "https://api.qgenda.com/v2" },
  tangier:    { label: "Tangier / Spok", kind: "vendor", blurb: "Tangier (Spok) on-call",                     loginUrl: "https://www.tangieronline.com", api: "" },
  shiftadmin: { label: "ShiftAdmin",     kind: "vendor", blurb: "ShiftAdmin scheduling",                      loginUrl: "https://www.shiftadmin.com",    api: "" },
  word:       { label: "Word document",  kind: "doc",  accept: ".doc,.docx", icon: "file-text", blurb: "Upload a .doc/.docx schedule" },
  pdf:        { label: "PDF document",   kind: "doc",  accept: ".pdf",       icon: "file-type-2", blurb: "Upload a PDF schedule" },
  online:     { label: "Online page",    kind: "url",  icon: "globe", blurb: "Parse a published web schedule" },
  custom:     { label: "Custom / other", kind: "vendor", blurb: "Custom endpoint or sign-in capture",         loginUrl: "",                              api: "" },
  none:       { label: "Not configured", kind: "none", blurb: "No schedule source set for this organization", loginUrl: "", api: "" },
};
const SS_SOURCE_KEYS = ["amion", "qgenda", "tangier", "shiftadmin", "word", "pdf", "online", "custom"];

// Convert an Amion hour token ("7a","12a","11p","4p") to 24h "HH:00".
function ss24(tok) {
  const m = String(tok).match(/^(\d+)([ap])$/i);
  if (!m) return "00:00";
  let h = parseInt(m[1], 10) % 12;
  if (m[2].toLowerCase() === "p") h += 12;
  return String(h).padStart(2, "0") + ":00";
}
function ssRange(hrs) { const p = String(hrs).split("-"); return ss24(p[0]) + "–" + ss24(p[1]); }

// Distinct shift types implied by the schedule's time intervals — so the org's
// shift types can be created agentically to match what Amion actually uses.
function ssShiftTypes(rows) {
  const seen = new Map();
  rows.forEach((r) => {
    if (seen.has(r.hrs)) return;
    seen.set(r.hrs, { code: r.hrs, name: (SS_HRS[r.hrs] || [r.hrs])[0], time: ssRange(r.hrs) });
  });
  return [...seen.values()];
}

// Collapse the per-slot schedule into the DISTINCT people on it — one card per
// provider (a name appearing in several slots is one person to add as a user).
function ssUniqueProviders(rows) {
  const byName = new Map();
  rows.forEach((r) => {
    const name = ssName(r.prov);
    if (!byName.has(name)) {
      byName.set(name, { name, raw: r.prov, group: r.grp, secure: r.secure, shift: SS_SHIFT[r.hrs] || "day", slots: [r.slot] });
    } else {
      byName.get(name).slots.push(r.slot);
    }
  });
  return [...byName.values()];
}

function SSModeTab({ active, icon, label, sub, onClick }) {
  return (
    <button onClick={onClick} style={{ flex: 1, textAlign: "left", display: "flex", gap: 11, alignItems: "flex-start", padding: "12px 13px", borderRadius: "var(--radius-md)", cursor: "pointer",
      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`, background: active ? "#EFF6FF" : "#fff", transition: "all .15s" }}>
      <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", background: active ? "#fff" : "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={icon} size={16} color={active ? "var(--primary)" : "var(--muted-foreground)"} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? "var(--primary)" : "var(--foreground)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.35, marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

function ShiftChip({ shift, tint }) {
  const c = { amber: ["var(--status-pending-bg)", "var(--status-pending)"], blue: ["var(--status-active-bg)", "var(--status-active)"], slate: ["var(--status-neutral-bg)", "var(--status-neutral)"] }[tint] || ["var(--secondary)", "var(--muted-foreground)"];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-full)", background: c[0], color: c[1], whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: 99, background: c[1], flex: "none" }} />{shift}</span>;
}

function ScheduleSync({ org }) {
  const a = useActions();
  const st = useStore();
  const [connected, setConnected] = React.useState(false);
  const [mode, setMode] = React.useState("capture"); // default to the no-API path
  const [busy, setBusy] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false); // capture preview shown
  const [lastSync, setLastSync] = React.useState("just now");
  const [interval, setIntervalVal] = React.useState("15m");
  const [added, setAdded] = React.useState({});      // provider name → true once imported
  const [adding, setAdding] = React.useState({});    // provider name → true while importing
  const [bulk, setBulk] = React.useState(false);     // "Add all" in flight

  const [shiftsAdded, setShiftsAdded] = React.useState(false);
  const [shiftsBusy, setShiftsBusy] = React.useState(false);

  const orgCode = (org && org.code) || st.selectedOrg || "ISPN";
  const srcKey = (st.scheduleSources && st.scheduleSources[orgCode]) || "amion";
  const src = SS_SOURCES[srcKey] || SS_SOURCES.amion;
  const notConfigured = srcKey === "none";
  const people = React.useMemo(() => ssUniqueProviders(SS_ROWS), []);
  const remaining = people.filter((p) => !added[p.name]);
  const shiftTypes = React.useMemo(() => ssShiftTypes(SS_ROWS), []);

  const importShifts = () => {
    if (!a.importShiftTypes) return;
    setShiftsBusy(true);
    Promise.resolve(a.importShiftTypes(shiftTypes.map((t) => ({ name: t.name, time: t.time }))))
      .then(() => setShiftsAdded(true))
      .finally(() => setShiftsBusy(false));
  };

  const importOne = (p) => {
    setAdding((m) => ({ ...m, [p.name]: true }));
    Promise.resolve(a.importProviders(orgCode, [{ name: p.name, group: p.group, shift: p.shift }]))
      .then(() => { setAdded((m) => ({ ...m, [p.name]: true })); })
      .finally(() => { setAdding((m) => { const n = { ...m }; delete n[p.name]; return n; }); });
  };
  const importAll = () => {
    if (!remaining.length) return;
    setBulk(true);
    Promise.resolve(a.importProviders(orgCode, remaining.map((p) => ({ name: p.name, group: p.group, shift: p.shift }))))
      .then(() => { setAdded((m) => { const n = { ...m }; remaining.forEach((p) => { n[p.name] = true; }); return n; }); })
      .finally(() => setBulk(false));
  };

  // API fields
  const [token, setToken] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("https://www.amion.com/api");
  // Capture fields
  const [loginUrl, setLoginUrl] = React.useState("https://www.amion.com");
  const [username, setUsername] = React.useState("tarzana.isp");
  const [password, setPassword] = React.useState("••••••••••");
  const [schedKey, setSchedKey] = React.useState("!299a6dc6iJRQ");
  // Document / online-page ingestion (non-vendor sources).
  const [fileName, setFileName] = React.useState("");
  const [pageUrl, setPageUrl] = React.useState("");
  const connLabel = src.kind === "doc" ? "Document" : src.kind === "url" ? "Web page" : (mode === "api" ? "API" : "Capture");

  // Switching the org's source resets the live connection and points the
  // sign-in/API fields at the new vendor's defaults.
  React.useEffect(() => {
    setConnected(false); setRevealed(false);
    if (src.api) setBaseUrl(src.api);
    if (src.loginUrl) setLoginUrl(src.loginUrl);
  }, [srcKey]);

  const run = () => {
    setBusy(true);
    setTimeout(() => { setBusy(false); setConnected(true); setRevealed(true); setLastSync("just now"); }, 1200);
  };
  const syncNow = () => { setBusy(true); setTimeout(() => { setBusy(false); setLastSync("just now"); }, 900); };
  const disconnect = () => { setConnected(false); setRevealed(false); };

  return (
    <Card style={{ padding: 18, marginBottom: 18 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4 }}>
        <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "#DBEAFE", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar-clock" size={19} color="var(--primary)" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, whiteSpace: "nowrap" }}>On-call schedule sync</h3>
            <Badge variant="secondary">{src.label}</Badge>
            {connected && <span style={{ whiteSpace: "nowrap" }}><Badge status="accepted" icon="circle">Connected · {connLabel}</Badge></span>}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "2px 0 0" }}>Each organization uses its own scheduling system — pick <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{orgCode}</b>'s source, then import its on-call grid to drive DocTurn's rotation pool.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>Source</span>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <select value={srcKey} onChange={(e) => a.setScheduleSource(orgCode, e.target.value)}
              style={{ appearance: "none", WebkitAppearance: "none", height: 30, padding: "0 26px 0 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-sans)", cursor: "pointer" }}>
              {SS_SOURCE_KEYS.map((k) => <option key={k} value={k}>{SS_SOURCES[k].label}</option>)}
              <option value="none">Not configured</option>
            </select>
            <Icon name="chevron-down" size={12} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
          </div>
          {connected && <Button size="sm" variant="outline" icon="rotate-ccw" onClick={syncNow}>{busy ? "Syncing…" : "Sync now"}</Button>}
        </div>
      </div>

      {notConfigured && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "16px 18px", borderRadius: "var(--radius-md)", background: "var(--secondary)", border: "1px dashed var(--border)" }}>
          <Icon name="calendar-off" size={20} color="var(--muted-foreground)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>No schedule source for {orgCode}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Choose this organization's scheduling system above (Amion, QGenda, …) to import its on-call grid.</div>
          </div>
        </div>
      )}

      {!connected && !notConfigured && src.kind === "vendor" && (
        <React.Fragment>
          {/* mode selector */}
          <div style={{ display: "flex", gap: 10, margin: "14px 0 6px" }}>
            <SSModeTab active={mode === "api"} icon="plug-zap" label="API token" sub="Vendor exposes a schedule API. Cleanest, real-time." onClick={() => setMode("api")} />
            <SSModeTab active={mode === "capture"} icon="scan-line" label="Sign-in capture" sub="No API? We log in & read the schedule off-screen." onClick={() => setMode("capture")} />
          </div>

          {mode === "api" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
              <Field label="API base URL" icon="link" value={baseUrl} onChange={setBaseUrl} />
              <Field label="API token" icon="key-round" value={token} onChange={setToken} type="password" placeholder="paste secret token" help="Stored server-side, never exposed to clients." />
              <div style={{ gridColumn: "1 / -1" }}>
                <Button icon="plug" onClick={run}>{busy ? "Connecting…" : "Test & connect"}</Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "var(--radius-md)", padding: "11px 13px", marginBottom: 14, fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>
                <Icon name="info" size={15} color="#B45309" style={{ marginTop: 1, flex: "none" }} />
                <span>No public API? DocTurn signs in to {src.label} inside an <b>isolated, server-side headless browser</b>, opens your published on-call page, and parses the grid straight off the rendered screen. Credentials are <b>encrypted (AES-256) at rest</b>, used only to fetch the schedule, and every capture is written to the audit log.</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Sign-in URL" icon="link" value={loginUrl} onChange={setLoginUrl} />
                <Field label="Schedule key / org password" icon="hash" value={schedKey} onChange={setSchedKey} help={src.label + "'s interactive-schedule password."} />
                <Field label="Username" icon="user" value={username} onChange={setUsername} />
                <Field label="Password" icon="lock" value={password} onChange={setPassword} type="password" />
              </div>
              <div style={{ marginTop: 14 }}>
                <Button icon="scan-line" onClick={run}>{busy ? "Signing in & capturing…" : "Sign in & capture"}</Button>
              </div>
            </div>
          )}
        </React.Fragment>
      )}

      {/* Document upload (Word / PDF) — many orgs keep the schedule in a file. */}
      {!connected && !notConfigured && src.kind === "doc" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "11px 13px", marginBottom: 14, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            <Icon name="info" size={15} style={{ marginTop: 1, flex: "none" }} />
            <span>Upload <b style={{ color: "var(--foreground)" }}>{orgCode}</b>'s {src.label.toLowerCase()}. DocTurn reads the on-call table out of the file and lists the providers to add — nothing leaves the server unencrypted.</span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Schedule file</label>
              <label style={{ display: "flex", alignItems: "center", gap: 9, height: 40, padding: "0 12px", border: "1px dashed var(--input)", borderRadius: "var(--radius-md)", background: "#fff", cursor: "pointer" }}>
                <Icon name={src.icon || "file-text"} size={16} color="var(--muted-foreground)" />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: fileName ? "var(--foreground)" : "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName || ("Choose a " + src.label + " (" + (src.accept || "") + ")")}</span>
                <input type="file" accept={src.accept} style={{ display: "none" }} onChange={(e) => setFileName((e.target.files && e.target.files[0] && e.target.files[0].name) || "")} />
              </label>
            </div>
            <Button icon="upload" onClick={run} disabled={busy}>{busy ? "Parsing…" : "Upload & parse"}</Button>
          </div>
        </div>
      )}

      {/* Online page — fetch & parse a published web schedule. */}
      {!connected && !notConfigured && src.kind === "url" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "11px 13px", marginBottom: 14, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            <Icon name="info" size={15} style={{ marginTop: 1, flex: "none" }} />
            <span>Paste <b style={{ color: "var(--foreground)" }}>{orgCode}</b>'s published schedule page. DocTurn fetches it server-side and parses the on-call grid off the page.</span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 0 }}><Field label="Schedule URL" icon="link" value={pageUrl} onChange={setPageUrl} placeholder="https://…/oncall" /></div>
            <Button icon="globe" onClick={run} disabled={busy}>{busy ? "Fetching…" : "Fetch & parse"}</Button>
          </div>
        </div>
      )}

      {/* capture / sync result */}
      {connected && revealed && src.demo && (
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "minmax(0,260px) 1fr", gap: 16, alignItems: "start" }}>
          {/* captured raw page */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
              <Icon name="scan-line" size={13} color="var(--muted-foreground)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Captured page</span>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: "#E2574C" }} /><span style={{ width: 8, height: 8, borderRadius: 99, background: "#E9B23E" }} /><span style={{ width: 8, height: 8, borderRadius: 99, background: "#3FB950" }} />
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: "var(--muted-foreground)", marginLeft: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>amion.com/cgi-bin/ocs?Lo=…</span>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                  <thead><tr>
                    <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "#fff" }}>Assignment</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "#fff" }}>Provider</th>
                    <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "#fff" }} title="Secure-message ready">Sec</th>
                  </tr></thead>
                  <tbody>
                    {SS_ROWS.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: "5px 10px", borderBottom: i < SS_ROWS.length - 1 ? "1px solid var(--border)" : "none", whiteSpace: "nowrap" }}>{r.slot}<span style={{ color: "var(--muted-foreground)", marginLeft: 5 }}>{r.hrs}</span></td>
                        <td style={{ padding: "5px 8px", borderBottom: i < SS_ROWS.length - 1 ? "1px solid var(--border)" : "none", whiteSpace: "nowrap" }}>{r.prov}</td>
                        <td style={{ padding: "5px 8px", borderBottom: i < SS_ROWS.length - 1 ? "1px solid var(--border)" : "none", textAlign: "center" }}>
                          <Icon name={r.secure ? "check" : "x"} size={12} color={r.secure ? "var(--status-accepted)" : "var(--status-rejected)"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* hours → shift mapping */}
            <div style={{ marginTop: 11 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Shift types detected</span>
                {shiftsAdded
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--status-accepted)" }}><Icon name="check" size={12} />Added</span>
                  : <Button size="sm" variant="outline" icon="plus" onClick={importShifts} disabled={shiftsBusy}>{shiftsBusy ? "Adding…" : "Add to org (" + shiftTypes.length + ")"}</Button>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {shiftTypes.map((t) => (
                  <div key={t.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, background: "var(--secondary)", padding: "1px 6px", borderRadius: 5, minWidth: 46, textAlign: "center" }}>{t.code}</code>
                    <Icon name="arrow-right" size={12} color="var(--muted-foreground)" />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--muted-foreground)" }}>{t.time}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.4 }}>
                Created automatically from the schedule's actual time intervals — so the org's shift types match Amion.
              </div>
            </div>
          </div>

          {/* parsed result → people you can add as users */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, flexWrap: "wrap" }}>
              <Icon name="users-round" size={14} color="var(--status-accepted)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Providers found → add as users</span>
              <Badge status="accepted">{people.length} people</Badge>
              {remaining.length > 0 && (
                <span style={{ marginLeft: "auto" }}>
                  <Button size="sm" icon="user-plus" onClick={importAll}>{bulk ? "Adding…" : "Add all (" + remaining.length + ")"}</Button>
                </span>
              )}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", margin: "0 0 8px", lineHeight: 1.45 }}>
              Each distinct person on the schedule, ready to add to <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{orgCode}</b> as a hospitalist user. Shift slots aren't imported — just the people.
            </p>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", maxHeight: 360, overflowY: "auto" }}>
              {people.map((p, i) => {
                const isAdded = !!added[p.name];
                const isAdding = !!adding[p.name];
                return (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 13px", borderTop: i ? "1px solid var(--border)" : "none", opacity: isAdded ? 0.6 : 1 }}>
                    <Avatar initials={ssInit(p.raw)} size={30} tint={isAdded ? "emerald" : "slate"} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.group} · {p.slots.length} slot{p.slots.length > 1 ? "s" : ""}</div>
                    </div>
                    <ShiftChip shift={p.shift === "day" ? "Day" : p.shift === "swing" ? "Swing" : "Night"} tint={p.shift === "day" ? "amber" : p.shift === "swing" ? "blue" : "slate"} />
                    {isAdded
                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--status-accepted)", flex: "none" }}><Icon name="check" size={13} />Added</span>
                      : <Button size="sm" variant="outline" icon="user-plus" onClick={() => importOne(p)} disabled={isAdding}>{isAdding ? "Adding…" : "Add"}</Button>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 9, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
              <Icon name="info" size={13} style={{ marginTop: 1, flex: "none" }} />Added providers become hospitalist users in this organization and appear in the rotation pool. Re-running a sync won't create duplicates.
            </div>

            {/* controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted-foreground)" }}>
                <Icon name="clock" size={14} />Re-sync every
                <select value={interval} onChange={(e) => setIntervalVal(e.target.value)} style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, padding: "5px 8px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", color: "var(--foreground)", cursor: "pointer" }}>
                  <option value="5m">5 min</option>
                  <option value="15m">15 min</option>
                  <option value="30m">30 min</option>
                  <option value="1h">1 hour</option>
                  <option value="2h">2 hours</option>
                  <option value="6h">6 hours</option>
                  <option value="12h">Twice a day</option>
                  <option value="24h">Once a day</option>
                  <option value="manual">Manual only</option>
                </select>
              </div>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>· Last sync <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{lastSync}</b></span>
              <button onClick={disconnect} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--destructive)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="unplug" size={13} />Disconnect</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11, fontSize: 11.5, color: "var(--muted-foreground)" }}>
              <Icon name="shield-check" size={13} color="var(--status-accepted)" />Read-only · credentials encrypted at rest · every capture written to the audit log.
            </div>
          </div>
        </div>
      )}

      {/* Non-Amion sources: connected, but no demo grid is wired — show an
          honest parsed-result panel plus the same re-sync controls. */}
      {connected && revealed && !src.demo && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "var(--status-accepted-bg)", border: "1px solid var(--status-accepted)", borderRadius: "var(--radius-md)", padding: "11px 13px", marginBottom: 14, fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.5 }}>
            <Icon name="circle-check-big" size={15} color="var(--status-accepted)" style={{ marginTop: 1, flex: "none" }} />
            <span>Connected to <b>{src.label}</b> for <b>{orgCode}</b> via {connLabel.toLowerCase()}. DocTurn will parse this source and list its providers here to add to the rotation pool.</span>
          </div>
          <div style={{ border: "1px dashed var(--border)", borderRadius: "var(--radius-md)", padding: 22, textAlign: "center", color: "var(--muted-foreground)" }}>
            <Icon name="users-round" size={20} color="var(--muted-foreground)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginTop: 8 }}>No providers parsed yet</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>Wire a live {src.label} feed{src.kind === "doc" ? " (or upload the real schedule)" : ""} to import this organization's people automatically.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted-foreground)" }}>
              <Icon name="clock" size={14} />Re-sync every
              <select value={interval} onChange={(e) => setIntervalVal(e.target.value)} style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, padding: "5px 8px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", color: "var(--foreground)", cursor: "pointer" }}>
                <option value="5m">5 min</option>
                <option value="15m">15 min</option>
                <option value="30m">30 min</option>
                <option value="1h">1 hour</option>
                <option value="2h">2 hours</option>
                <option value="6h">6 hours</option>
                <option value="12h">Twice a day</option>
                <option value="24h">Once a day</option>
                <option value="manual">Manual only</option>
              </select>
            </div>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>· Last sync <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{lastSync}</b></span>
            <button onClick={disconnect} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--destructive)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="unplug" size={13} />Disconnect</button>
          </div>
        </div>
      )}
    </Card>
  );
}

Object.assign(window, { ScheduleSync });
