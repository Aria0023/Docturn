/* DocTurn web-app UI kit — CONTINUOUS COMPLIANCE MONITOR.

   The sibling of Compliance.jsx: that screen shows what HAPPENED (audit trail,
   PHI access, incidents); this one shows whether the CONTROLS that are supposed
   to protect that data are actually in place right now.

   Every automated row on this screen is recomputed server-side on each load
   from live database state and runtime configuration (GET /api/compliance/status).
   Nothing here is decorative: a green pill means a check measured something and
   compared it to a threshold. Controls that code cannot verify are shown as
   "Needs human" and stay that way until a named owner attests to them. */

const CM_STATUS = {
  pass:    { label: "Pass",        fg: "var(--status-accepted)", bg: "var(--status-accepted-bg)", icon: "check-circle-2" },
  warn:    { label: "Warn",        fg: "var(--status-pending)",  bg: "var(--status-pending-bg)",  icon: "alert-triangle" },
  fail:    { label: "Fail",        fg: "var(--status-rejected)", bg: "var(--status-rejected-bg)", icon: "x-octagon" },
  manual:  { label: "Needs human", fg: "var(--status-active)",   bg: "var(--status-active-bg)",   icon: "user-check" },
  unknown: { label: "Unknown",     fg: "var(--status-neutral)",  bg: "var(--status-neutral-bg)",  icon: "help-circle" },
};

const CM_ATTEST_OPTIONS = [
  ["", "— not attested —"],
  ["met", "Met"],
  ["in_progress", "In progress"],
  ["not_met", "Not met"],
  ["na", "Not applicable"],
];

function CmStatusPill({ status }) {
  const s = CM_STATUS[status] || CM_STATUS.unknown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: "var(--radius-full)", background: s.bg, color: s.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
      <Icon name={s.icon} size={12} />{s.label}
    </span>
  );
}

/* Readiness ring — the fraction of controls that are genuinely passing. Warn,
   fail, unknown and un-attested controls all count as zero, which is why this
   number starts low and has to be earned. */
function CmReadinessRing({ pct, size = 108 }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const val = Math.max(0, Math.min(100, Number(pct) || 0));
  const tone = val >= 80 ? "var(--status-accepted)" : val >= 50 ? "var(--status-pending)" : "var(--status-rejected)";
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * val) / 100} style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{val}%</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em" }}>ready</span>
      </div>
    </div>
  );
}

function CmCount({ status, n }) {
  const s = CM_STATUS[status] || CM_STATUS.unknown;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-md)", background: s.bg, minWidth: 96 }}>
      <Icon name={s.icon} size={15} color={s.fg} />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: s.fg, fontVariantNumeric: "tabular-nums" }}>{n}</div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: s.fg, opacity: 0.85 }}>{s.label}</div>
      </div>
    </div>
  );
}

/* Inline attestation editor for the controls only a human can answer. */
function CmAttestEditor({ control, onSave }) {
  const a = control.attestation || {};
  const [status, setStatus] = React.useState(a.status || "");
  const [owner, setOwner] = React.useState(a.owner || "");
  const [note, setNote] = React.useState(a.note || "");
  const [url, setUrl] = React.useState(a.evidenceUrl || "");
  const [due, setDue] = React.useState((a.reviewDue || "").slice(0, 10));
  const [busy, setBusy] = React.useState(false);

  const save = () => {
    if (!status) return;
    setBusy(true);
    Promise.resolve(onSave({
      controlId: control.id,
      status: status,
      owner: owner || undefined,
      note: note || undefined,
      evidenceUrl: url || "",
      reviewDue: due || "",
    })).then(function () { setBusy(false); }, function () { setBusy(false); });
  };

  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>
        Attestation — a named person, not the software, answers this
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 170px", gap: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid={"attest-status-" + control.id}
            style={{ width: "100%", height: 40, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--input)", background: "#fff", fontSize: 14, fontFamily: "inherit", color: "var(--foreground)" }}>
            {CM_ATTEST_OPTIONS.map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option>; })}
          </select>
        </div>
        <Field label="Owner" value={owner} onChange={setOwner} placeholder="Who is accountable?" icon="user" />
        <Field label="Review due" value={due} onChange={setDue} type="date" />
      </div>
      <Field label="Evidence link" value={url} onChange={setUrl} placeholder="https://… signed BAA, policy PDF, training roster" icon="link" />
      <Field label="Note" value={note} onChange={setNote} placeholder="What was done, by whom, and when" textarea rows={2} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button size="sm" icon="save" onClick={save} title={status ? "" : "Choose a status first"}>{busy ? "Saving…" : "Save attestation"}</Button>
        {a.attestedAt && <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Last attested {String(a.attestedAt).slice(0, 10)}{a.owner ? " by " + a.owner : ""}</span>}
        {a.reviewOverdue && <Badge status="rejected" icon="alert-triangle">Review overdue</Badge>}
      </div>
    </div>
  );
}

function CmControlRow({ control, onSave }) {
  const [open, setOpen] = React.useState(false);
  const cites = (control.hipaa || []).concat(control.soc2 || []);
  return (
    <div data-control={control.id} data-status={control.status}
      style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <span style={{ flex: "none", marginTop: 1 }}><CmStatusPill status={control.status} /></span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{control.title}</span>
            <span className="ds-mono" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{control.id}</span>
            {control.kind === "manual" && <Badge status="offline" icon="user-check">Attested by a person</Badge>}
            {control.effectiveSeverity === "critical" && control.status !== "pass" && <Badge status="rejected">Critical</Badge>}
          </div>
          {/* The live measured value — the whole point of the screen. */}
          <div data-detail={control.id} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--foreground)", marginTop: 4 }}>{control.detail}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
            {cites.map(function (c) {
              return <span key={c} className="ds-mono" style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: "var(--radius-full)", background: "var(--secondary)", color: "var(--muted-foreground)" }}>{c}</span>;
            })}
          </div>
          {control.status !== "pass" && (
            <div style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 8, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted-foreground)" }}>
              <Icon name="wrench" size={13} color="var(--primary)" style={{ marginTop: 2, flex: "none" }} />
              <span><strong style={{ color: "var(--foreground)" }}>Fix:</strong> {control.remediation}</span>
            </div>
          )}
        </div>
        {control.kind === "manual" && (
          <Button size="sm" variant="outline" icon={open ? "chevron-up" : "pencil"} onClick={() => setOpen(!open)}>
            {open ? "Close" : (control.attestation ? "Update" : "Attest")}
          </Button>
        )}
      </div>
      {open && control.kind === "manual" && <CmAttestEditor control={control} onSave={onSave} />}
    </div>
  );
}

function ComplianceMonitor() {
  const a = useActions();
  const [report, setReport] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(function () {
    setLoading(true);
    return Promise.resolve(a.loadComplianceStatus())
      .then(function (r) { setReport(r || null); setErr(r ? null : "no_data"); setLoading(false); })
      .catch(function (e) { setErr(String((e && e.message) || "failed")); setLoading(false); });
  }, []);

  React.useEffect(function () { load(); }, [load]);

  const saveAttestation = function (patch) {
    return Promise.resolve(a.saveAttestation(patch)).then(function () { return load(); });
  };

  const exportPack = function () {
    return Promise.resolve(a.exportEvidence()).then(function (pack) {
      if (!pack) return;
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "docturn-compliance-evidence-" + stamp + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  };

  const sum = (report && report.summary) || { pass: 0, warn: 0, fail: 0, manual: 0, unknown: 0, total: 0, readinessPct: 0 };
  const mode = (report && report.mode) || null;
  const controls = (report && report.controls) || [];

  // Group by category, preserving catalog order within each group.
  const groups = [];
  const index = {};
  controls.forEach(function (c) {
    if (index[c.category] == null) { index[c.category] = groups.length; groups.push({ category: c.category, rows: [] }); }
    groups[index[c.category]].rows.push(c);
  });

  return (
    <PageWrap>
      <SettingsTabs />

      {/* The honest banner. Deliberately first, deliberately unmissable. */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", marginBottom: 18, borderRadius: "var(--radius-md)", background: "#1E293B", color: "#fff" }}>
        <Icon name="shield-alert" size={18} color="#FDBA74" style={{ marginTop: 1, flex: "none" }} />
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3 }}>These checks cover technical safeguards only — they are not a certification.</div>
          <span style={{ color: "#CBD5E1" }}>
            HIPAA has no certification, and SOC 2 is an attestation only a licensed CPA firm can issue. Business Associate Agreements,
            the security risk analysis, workforce training and contingency planning are organizational controls that no software can
            verify — they appear below as <strong style={{ color: "#fff" }}>“Needs human”</strong> until a named owner attests to them.
            Everything marked Pass was measured from this running system at load time; nothing on this page is hardcoded.
          </span>
        </div>
      </div>

      {err && !report && (
        <Card style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--destructive)" }}>
          Couldn't load the compliance status ({err}). <Button size="sm" variant="outline" icon="refresh-cw" onClick={load}>Retry</Button>
        </Card>
      )}
      {!report && !err && (
        <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Running live control checks…</Card>
      )}

      {report && (
        <React.Fragment>
          <Card style={{ padding: 18, marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <CmReadinessRing pct={sum.readinessPct} />
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <span style={{ fontSize: 17, fontWeight: 800 }}>Control readiness</span>
                  {mode && (
                    <span data-testid="cm-mode" style={{ padding: "3px 10px", borderRadius: "var(--radius-full)", fontSize: 11.5, fontWeight: 800, letterSpacing: ".03em",
                      background: mode.synthetic ? "var(--status-accepted-bg)" : "var(--status-rejected-bg)",
                      color: mode.synthetic ? "var(--status-accepted)" : "var(--status-rejected)" }}>
                      {mode.label} DATA
                    </span>
                  )}
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                    {sum.pass} of {sum.total} controls verified · generated {String(report.generatedAt || "").replace("T", " ").slice(0, 19)} UTC
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <CmCount status="pass" n={sum.pass} />
                  <CmCount status="warn" n={sum.warn} />
                  <CmCount status="fail" n={sum.fail} />
                  <CmCount status="manual" n={sum.manual} />
                  <CmCount status="unknown" n={sum.unknown} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Button size="sm" variant="outline" icon="refresh-cw" onClick={load}>{loading ? "Checking…" : "Refresh"}</Button>
                <Button size="sm" icon="download" onClick={exportPack}>Export evidence pack</Button>
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map(function (g) {
              const failing = g.rows.filter(function (r) { return r.status === "fail"; }).length;
              return (
                <Card key={g.category} style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", background: "var(--secondary)" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>{g.category}</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{g.rows.length} control{g.rows.length === 1 ? "" : "s"}</span>
                    {failing > 0 && <Badge status="rejected" icon="alert-triangle">{failing} failing</Badge>}
                  </div>
                  {g.rows.map(function (c) {
                    return <CmControlRow key={c.id} control={c} onSave={saveAttestation} />;
                  })}
                </Card>
              );
            })}
          </div>

          {report.limitations && (
            <Card style={{ padding: 18, marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Scope &amp; limitations</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 10, lineHeight: 1.6 }}>{report.limitations.summary}</div>
              <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                {(report.limitations.limitations || []).map(function (l, i) {
                  return <li key={i} style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--foreground)" }}>{l}</li>;
                })}
              </ul>
              {report.limitations.readinessFormula && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--secondary)", fontSize: 12, lineHeight: 1.6, color: "var(--muted-foreground)" }}>
                  <strong style={{ color: "var(--foreground)" }}>How readiness is computed: </strong>{report.limitations.readinessFormula}
                </div>
              )}
            </Card>
          )}
        </React.Fragment>
      )}
    </PageWrap>
  );
}

Object.assign(window, { ComplianceMonitor, CmStatusPill, CmReadinessRing });
