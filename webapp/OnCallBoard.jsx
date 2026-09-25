/* DocTurn web-app UI kit — "Who's on call" board.
   Every role / service with its current holder, merged server-side from the
   org's selected schedule source (Amion grid, Epic FHIR, or the director's
   manual list) plus the consult-service on-call holders and the rotation's
   next hospitalist. DND → covering is already resolved by the server; the
   Message button addresses whoever actually answers. Directors pick the source
   and maintain the manual slots here. Also exports the "Open in EHR" button
   used on patient rows (EHR deep links, module ehr.deepLinks). */

const OC_GROUPS = ["Hospitalist slots", "Triage", "Night", "Consult services", "Next up"];
const OC_GROUP_ICON = { "Hospitalist slots": "stethoscope", "Triage": "siren", "Night": "moon", "Consult services": "users-round", "Next up": "repeat" };
const OC_SOURCE_LABEL = { amion: "Amion", epic: "Epic", manual: "Manual", consults: "Consult services", rotation: "Rotation" };
const OC_SHIFT = { day: ["Day", "amber"], swing: ["Swing", "blue"], night: ["Night", "slate"] };

function ocModuleOn(id) { try { return window.DT && window.DT.moduleOn ? window.DT.moduleOn(id) : true; } catch (e) { return true; } }
function ocAgo(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}
function ocInitials(name) {
  const clean = String(name || "").replace(/^dr\.?\s+/i, "").replace(/,.*$/, "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  return ((parts[0] || "")[0] + ((parts[parts.length - 1] || "")[0] || "")).toUpperCase();
}

function OcChip({ children, tint, icon, title }) {
  const c = { amber: ["var(--status-pending-bg)", "var(--status-pending)"], blue: ["var(--status-active-bg)", "var(--status-active)"], slate: ["var(--status-neutral-bg)", "var(--status-neutral)"], green: ["var(--status-accepted-bg)", "var(--status-accepted)"], red: ["var(--status-rejected-bg)", "var(--status-rejected)"] }[tint] || ["var(--secondary)", "var(--muted-foreground)"];
  return <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-full)", background: c[0], color: c[1], whiteSpace: "nowrap" }}>{icon && <Icon name={icon} size={11} />}{children}</span>;
}

// Source chip: "Amion · synced 12 min ago" / "Epic · synced …" / "Manual · updated …".
function OcSourceChip({ source }) {
  if (!source) return null;
  const st = source.status || {};
  const verb = source.id === "manual" ? "updated" : "synced";
  const tint = !st.configured ? "slate" : st.lastStatus === "error" ? "red" : st.lastStatus === "ok" ? "green" : "amber";
  const icon = source.id === "epic" ? "database" : source.id === "manual" ? "pencil" : "calendar-clock";
  return <OcChip tint={tint} icon={icon} title={st.error || st.message || ""}>{OC_SOURCE_LABEL[source.id] || source.id}{st.configured ? " · " + verb + " " + ocAgo(st.lastSyncAt) : " · not configured"}</OcChip>;
}

function OcRow({ r, i, onMessage }) {
  const holder = r.holderName || "Unassigned";
  const shift = r.shift && OC_SHIFT[r.shift];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none", flexWrap: "wrap" }}>
      <Avatar initials={r.holderName ? ocInitials(r.holderName) : "—"} size={34} tint={!r.holderName ? "slate" : r.dnd ? "amber" : r.holderUserId != null ? "emerald" : "blue"} />
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 7 }}>
          {holder}
          {r.dnd && (r.covering
            ? <OcChip tint="amber" icon="moon">DND · covering: {r.covering.name}</OcChip>
            : <OcChip tint="red" icon="moon">DND · no covering</OcChip>)}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.label}{r.service && r.service !== r.label ? " · " + r.service : ""}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {r.hours && <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, background: "var(--secondary)", padding: "2px 7px", borderRadius: 5 }}>{r.hours}</span>}
        {shift && <OcChip tint={shift[1]}>{shift[0]}</OcChip>}
        <OcChip tint="slate" title={r.asOf ? "As of " + new Date(r.asOf).toLocaleString() : ""}>{OC_SOURCE_LABEL[r.source] || r.source}</OcChip>
        {r.holderName && r.holderUserId == null && <OcChip tint="amber" icon="user-x" title="Named on the schedule but not a DocTurn user yet">not in DocTurn</OcChip>}
      </div>
      <div style={{ marginLeft: "auto" }}>
        <Button size="sm" variant="outline" icon="message-square" onClick={() => r.messageable && onMessage(r)}
          style={{ opacity: r.messageable ? 1 : 0.45, cursor: r.messageable ? "pointer" : "not-allowed" }}
          title={r.messageable ? "Message " + (r.covering ? r.covering.name : holder) : (r.holderUserId == null ? "No DocTurn user to message" : r.dnd ? "On DND with no covering provider" : "That's you")}>
          Message
        </Button>
      </div>
    </div>
  );
}

// Director: pick the org's schedule source. Options that aren't configured
// (no Amion feed / no Epic credentials) stay visible but explain themselves.
function OcSourcePicker({ sources, onPick, busy }) {
  if (!sources) return null;
  const opts = [
    { id: "amion", label: "Amion", icon: "calendar-clock", on: sources.modules && sources.modules.amion !== false },
    { id: "epic", label: "Epic (FHIR)", icon: "database", on: sources.modules && sources.modules.epic !== false },
    { id: "manual", label: "Manual", icon: "pencil", on: true },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 2, padding: 3, background: "var(--secondary)", borderRadius: "var(--radius-md)", alignSelf: "flex-start" }}>
        {opts.map((o) => {
          const st = (sources.sources || {})[o.id] || {};
          const active = sources.selected === o.id;
          const disabled = !o.on;
          return (
            <button key={o.id} onClick={() => !disabled && !busy && onPick(o.id)} disabled={disabled}
              title={disabled ? "Module switched off for this organization (developer console)" : (st.message || "")}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 5, border: "none", cursor: disabled ? "not-allowed" : "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)",
                background: active ? "#fff" : "transparent", color: active ? "var(--primary)" : "var(--muted-foreground)", boxShadow: active ? "var(--shadow-sm)" : "none", opacity: disabled ? 0.5 : 1 }}>
              <Icon name={o.icon} size={13} />{o.label}
              <span style={{ width: 7, height: 7, borderRadius: 99, background: st.configured ? (st.lastStatus === "error" ? "var(--status-rejected)" : "var(--status-accepted)") : "var(--status-neutral)" }} title={st.configured ? "configured" : "not configured"} />
            </button>
          );
        })}
      </div>
      {(() => {
        const st = (sources.sources || {})[sources.selected];
        if (!st || st.configured) return null;
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#92400E", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: "var(--radius-md)", padding: "9px 12px", lineHeight: 1.45 }}>
            <Icon name="triangle-alert" size={14} color="#92400E" style={{ marginTop: 1, flex: "none" }} />
            <span>{st.message || "This source isn't configured yet."}</span>
          </div>
        );
      })()}
    </div>
  );
}

// Director: the manual on-call list (org setting "manualOnCall"), edited in place.
function OcManualEditor({ slots, people, onAdd, onRemove, onUpdate }) {
  const [slot, setSlot] = React.useState("");
  const [hours, setHours] = React.useState("7a-7p");
  const [who, setWho] = React.useState("");
  const [group, setGroup] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const sorted = (people || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const submit = () => {
    const person = sorted.find((p) => String(p.id) === who);
    const providerName = person ? person.name : who.trim();
    if (!slot.trim() || !providerName) return;
    setBusy(true);
    Promise.resolve(onAdd({ slot: slot.trim(), hours: hours.trim(), providerName, providerUserId: person ? person.id : null, group: group.trim() }))
      .then(() => { setSlot(""); setGroup(""); })
      .finally(() => setBusy(false));
  };
  const inp = { height: 34, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13, fontFamily: "var(--font-sans)", background: "#fff", minWidth: 0 };
  return (
    <Card style={{ padding: 16, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name="pencil" size={16} color="var(--primary)" />
        <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Manual on-call slots</h3>
        <Badge variant="secondary">{(slots || []).length}</Badge>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 12px", lineHeight: 1.45 }}>Maintained here in DocTurn. Used when the source is "Manual" — the fallback for organizations without an Amion feed or Epic credentials, and the override when a schedule is wrong.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1.4fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="Slot (e.g. Tarzana 1)" style={inp} />
        <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Hours (7a-7p)" style={{ ...inp, fontFamily: "var(--font-mono, monospace)" }} />
        <select value={who} onChange={(e) => setWho(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
          <option value="">Provider…</option>
          {sorted.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Group (optional)" style={inp} />
        <Button size="sm" icon="plus" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
      </div>
      {(slots || []).length === 0
        ? <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 0" }}>No manual slots yet.</div>
        : <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            {slots.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 13 }}>
                <span style={{ fontWeight: 600, minWidth: 120 }}>{s.slot}</span>
                <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, background: "var(--secondary)", padding: "1px 6px", borderRadius: 5 }}>{s.hours || "—"}</code>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.providerName}{s.group ? <span style={{ color: "var(--muted-foreground)" }}> · {s.group}</span> : null}</span>
                <OcChip tint={(OC_SHIFT[s.shift] || ["", "slate"])[1]}>{(OC_SHIFT[s.shift] || [s.shift])[0]}</OcChip>
                <button onClick={() => onRemove(s.id)} title="Remove slot" style={{ width: 28, height: 28, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}><Icon name="trash-2" size={14} /></button>
              </div>
            ))}
          </div>}
    </Card>
  );
}

function OnCallBoard() {
  const st = useStore();
  const a = useActions();
  const role = st.session && st.session.role;
  const isDirector = role === "director" || role === "developer";
  const board = st.onCallBoard || null;
  const sources = st.onCallSources || null;
  const [busy, setBusy] = React.useState(false);
  const [showManual, setShowManual] = React.useState(false);

  const refresh = React.useCallback(() => {
    if (!a.loadOnCallBoard) return Promise.resolve();
    return Promise.all([a.loadOnCallBoard(), isDirector && a.loadOnCallSources ? a.loadOnCallSources() : null, isDirector && a.loadManualSlots ? a.loadManualSlots() : null]);
  }, [isDirector]);
  React.useEffect(() => { refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); }, [refresh]);

  if (!ocModuleOn("oncall.board")) {
    return <PageWrap><Card style={{ padding: 28, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>The on-call board is switched off for this organization.</Card></PageWrap>;
  }

  const rows = (board && board.rows) || [];
  const source = board && board.source;
  const grouped = OC_GROUPS.map((g) => ({ g, rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length);
  const syncNow = () => {
    if (!source) return;
    const fn = source.id === "epic" ? a.epicSyncNow : source.id === "amion" ? a.amionSyncNow : null;
    if (!fn) return refresh();
    setBusy(true);
    Promise.resolve(fn()).catch(() => {}).then(refresh).finally(() => setBusy(false));
  };
  const pick = (id) => { if (!a.setOnCallSource) return; setBusy(true); Promise.resolve(a.setOnCallSource(id)).then(refresh).finally(() => setBusy(false)); };
  const message = (r) => { if (a.messageOnCallRow) a.messageOnCallRow(r); };
  const people = Object.values(st.orgPeople || {}).map((p) => ({ id: p.id, name: p.name }));
  const canSync = isDirector && source && (source.id === "epic" || source.id === "amion") && source.status && source.status.configured;
  const manualSelected = source && source.id === "manual";

  return (
    <PageWrap>
      <SectionTitle action={
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <OcSourceChip source={source} />
          {board && board.generatedAt && <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>as of {new Date(board.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          <Button size="sm" variant="outline" icon="refresh-cw" onClick={() => refresh()}>Refresh</Button>
          {canSync && <Button size="sm" icon="rotate-ccw" onClick={syncNow} disabled={busy}>{busy ? "Syncing…" : "Sync now"}</Button>}
        </div>
      }>Who's on call</SectionTitle>

      {isDirector && (
        <Card style={{ padding: 16, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 8 }}>Schedule source for {st.session && st.session.org}</div>
              <OcSourcePicker sources={sources} onPick={pick} busy={busy} />
            </div>
            <div style={{ flex: "none", alignSelf: "flex-end" }}>
              <Button size="sm" variant="ghost" icon={showManual || manualSelected ? "chevron-up" : "pencil"} onClick={() => setShowManual((v) => !v)}>{manualSelected ? "Manual slots" : (showManual ? "Hide manual slots" : "Manage manual slots")}</Button>
            </div>
          </div>
        </Card>
      )}
      {isDirector && (showManual || manualSelected) && (
        <OcManualEditor slots={st.manualOnCall || []} people={people}
          onAdd={(s) => Promise.resolve(a.addManualSlot && a.addManualSlot(s)).then(refresh)}
          onRemove={(id) => Promise.resolve(a.removeManualSlot && a.removeManualSlot(id)).then(refresh)} />
      )}

      {board && board.error && (
        <Card style={{ padding: 16, marginBottom: 18, border: "1px solid var(--destructive)", fontSize: 13 }}>Couldn't load the board: {board.error}</Card>
      )}
      {!board && <Card style={{ padding: 28, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Loading who's on call…</Card>}
      {board && !board.error && rows.length === 0 && (
        <Card style={{ padding: 28, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
          <Icon name="calendar-off" size={20} color="var(--muted-foreground)" />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--foreground)", marginTop: 8 }}>Nothing on the board yet</div>
          <div style={{ marginTop: 4 }}>{(source && source.status && source.status.message) || "The selected schedule source has no slots for today."}</div>
        </Card>
      )}
      {grouped.map(({ g, rows: rs }) => (
        <div key={g} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <Icon name={OC_GROUP_ICON[g] || "users"} size={14} color="var(--muted-foreground)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{g}</span>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>· {rs.length}</span>
          </div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {rs.map((r, i) => <OcRow key={r.id} r={r} i={i} onMessage={message} />)}
          </Card>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--muted-foreground)" }}>
        <Icon name="shield-check" size={13} color="var(--status-accepted)" />Holders resolve only to people in your organization. Do-not-disturb redirects to the covering provider; a holder on DND with no covering can't be messaged from here.
      </div>
    </PageWrap>
  );
}

// "Open in EHR" — deep-link a patient into Epic Haiku/Canto, Hyperspace or
// Cerner PowerChart. Shown only when the org has a template configured AND the
// ehr.deepLinks module is on; the MRN never reaches the browser — the server
// resolves the URL per (audited) click.
function OpenInEhrButton({ patientId, compact }) {
  const st = useStore();
  const a = useActions();
  React.useEffect(() => { if (st.ehrConfig === undefined && a.loadEhrConfig) a.loadEhrConfig(); }, []);
  const cfg = st.ehrConfig;
  if (!cfg || !cfg.configured || !ocModuleOn("ehr.deepLinks") || cfg.moduleEnabled === false) return null;
  if (patientId == null) return null;
  const label = cfg.vendor === "cerner" ? "Open in PowerChart" : "Open in Epic";
  const open = (e) => { e.stopPropagation(); if (a.openInEhr) a.openInEhr(patientId); };
  if (compact) {
    return (
      <button onClick={open} title={label}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        style={{ width: 32, height: 32, flex: "none", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
        <Icon name="external-link" size={15} />
      </button>
    );
  }
  return (
    <button onClick={open}
      style={{ flex: 1, height: 42, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: "var(--primary)", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-sans)" }}>
      <Icon name="external-link" size={16} />{label}
    </button>
  );
}

Object.assign(window, { OnCallBoard, OpenInEhrButton });
