/* DocTurn web-app UI kit — Reports.
   Team census, pending admits, provider load and saved custom reports
   (server/routes/reporting.ts). Every row comes from the server on each run:
   DocTurn's own records, or — when the hospital's Epic app is connected in
   Settings → Integrations — a patient list read live from Epic. Rows live in
   this component's state only: never in the store, never on the device.
   A report that could not be read says so; it is never shown as empty. */

const RP_OPS = {
  eq: "is", neq: "is not", contains: "contains", gte: "at least", lte: "at most", empty: "is blank", notEmpty: "is not blank",
};
const rpSel = {
  height: 36, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
  background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 13, maxWidth: "100%",
};
const rpLabel = { fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6 };

function rpCell(v, type) {
  if (v == null || v === "") return "—";
  if (type === "datetime") {
    const t = Date.parse(v);
    if (!isFinite(t)) return String(v);
    return window.dtFmt && window.dtFmt.stamp ? window.dtFmt.stamp(t) : new Date(t).toLocaleString();
  }
  return String(v);
}

// What a failed run means, in the reader's terms.
function rpProblem(e) {
  const code = String((e && e.message) || "");
  const detail = e && e.body && e.body.detail ? String(e.body.detail) : "";
  if (code === "ehr_not_connected") return { title: "Epic is not connected", text: "This report reads a patient list from Epic. A director connects the hospital's Epic app in Settings → Integrations → Epic; until then there is nothing to read." };
  if (code === "ehr_failed") {
    const why = /_40[13]$/.test(detail) ? "Epic refused the request. The hospital's Epic app needs read access to patient lists, patients and encounters."
      : /_404$/.test(detail) ? "Epic has no patient list with that ID, or the Epic app cannot see it."
      : /timeout/.test(detail) ? "Epic did not answer in time."
      : "Epic could not be read.";
    return { title: "Couldn't read from Epic", text: why + (detail ? " (" + detail + ")" : "") };
  }
  if (code === "module_disabled" || (e && e.status === 404 && code === "not_found")) return { title: "Report not available", text: "This report no longer exists, or Reports is switched off for this organization." };
  if (code === "ehr_list_required") return { title: "Choose an Epic patient list", text: "An Epic report needs the patient list to read." };
  return { title: "Couldn't run the report", text: "The server did not return this report. Nothing is shown rather than something out of date." };
}

function ReportBuilder({ catalog, initial, onClose, onSaved, onPreview }) {
  const act = window.DT.actions.reporting;
  const dsById = Object.fromEntries(catalog.datasets.map((d) => [d.id, d]));
  const start = initial || { id: null, name: "", dataset: "team_census", shared: false, config: null };
  const cfg0 = start.config || Object.assign({}, dsById[start.dataset].defaults, { filters: [], ehrListId: null });
  const [name, setName] = React.useState(start.name);
  const [dataset, setDataset] = React.useState(start.dataset);
  const [columns, setColumns] = React.useState(cfg0.columns.slice());
  const [filters, setFilters] = React.useState((cfg0.filters || []).map((f) => Object.assign({}, f)));
  const [groupBy, setGroupBy] = React.useState(cfg0.groupBy || "");
  const [sort, setSort] = React.useState(cfg0.sort ? Object.assign({}, cfg0.sort) : { column: "", dir: "asc" });
  const [ehrListId, setEhrListId] = React.useState(cfg0.ehrListId || "");
  const [shared, setShared] = React.useState(!!start.shared);
  const [lists, setLists] = React.useState(null); // null = not asked; { items } | { error }
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const ds = dsById[dataset];
  const isEhr = ds.source === "ehr";
  const blocked = isEhr && !catalog.ehrConnected;

  const pickDataset = (id) => {
    const d = dsById[id];
    setDataset(id); setColumns(d.defaults.columns.slice()); setFilters([]);
    setGroupBy(d.defaults.groupBy || ""); setSort(Object.assign({}, d.defaults.sort)); setError("");
  };
  const toggleCol = (id) => setColumns(columns.includes(id) ? columns.filter((c) => c !== id) : ds.columns.filter((c) => columns.includes(c.id) || c.id === id).map((c) => c.id));
  const findLists = () => {
    setLists({ loading: true });
    act.ehrLists().then((items) => setLists({ items })).catch((e) => setLists({ error: rpProblem(e).text }));
  };

  const input = () => ({
    name: name.trim(), dataset, shared,
    config: {
      columns, groupBy: groupBy || null,
      filters: filters.filter((f) => f.column).map((f) => ({ column: f.column, op: f.op, value: f.op === "empty" || f.op === "notEmpty" ? "" : f.value })),
      sort: sort.column ? sort : null,
      ehrListId: isEhr ? ehrListId.trim() || null : null,
    },
  });
  const problem = !columns.length ? "Choose at least one column."
    : isEhr && !/^[A-Za-z0-9\-.]{1,200}$/.test(ehrListId.trim()) ? "Enter the Epic patient list ID, or find the list."
    : "";
  const save = () => {
    if (!name.trim()) { setError("Give the report a name."); return; }
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    act.save(start.id, input()).then((saved) => { setBusy(false); onSaved(saved); }).catch((e) => {
      setBusy(false);
      const code = String(e.message);
      setError(code === "cannot_share" ? "Only a director can share a report with the organization."
        : code === "too_many_reports" ? "You have reached the limit of 50 saved reports. Delete one first."
        : "The server did not save this report.");
    });
  };
  const preview = () => {
    if (problem) { setError(problem); return; }
    onPreview(Object.assign(input(), { name: name.trim() || "Unsaved report" }));
  };

  return (
    <Modal title={start.id ? "Edit report" : "New report"} subtitle="Choose what to read and how to lay it out" icon="table-2" onClose={onClose} width={620}>
      <div data-report-builder style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Name" value={name} onChange={setName} placeholder="e.g. Team A census" inputProps={{ maxLength: 80, "data-report-name": true }} />

        <div>
          <div style={rpLabel}>Data</div>
          <select data-report-dataset style={Object.assign({}, rpSel, { width: "100%" })} value={dataset} onChange={(e) => pickDataset(e.target.value)}>
            {catalog.datasets.map((d) => <option key={d.id} value={d.id}>{d.label}{d.source === "ehr" ? " (from Epic)" : ""}</option>)}
          </select>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.45 }}>{ds.blurb}</div>
        </div>

        {isEhr && (
          <div data-report-ehr style={{ padding: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--secondary)" }}>
            {blocked ? (
              <div data-report-ehr-off style={{ fontSize: 13, lineHeight: 1.5 }}>
                <strong>Epic is not connected for this hospital.</strong> A director connects the hospital's Epic app in Settings → Integrations → Epic. Until then this report cannot be run or saved.
              </div>
            ) : (
              <React.Fragment>
                <div style={rpLabel}>Epic patient list</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input data-report-list-id value={ehrListId} onChange={(e) => setEhrListId(e.target.value)} placeholder="Patient list ID" aria-label="Epic patient list ID"
                    style={Object.assign({}, rpSel, { flex: "1 1 200px", minWidth: 0 })} />
                  <Button size="sm" variant="outline" icon="search" onClick={findLists} disabled={!!(lists && lists.loading)}>Find lists</Button>
                </div>
                {lists && lists.loading && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>Asking Epic for its patient lists…</div>}
                {lists && lists.error && <div style={{ fontSize: 12.5, color: "var(--destructive)", marginTop: 8 }}>{lists.error}</div>}
                {lists && lists.items && (lists.items.length ? (
                  <select data-report-list-pick style={Object.assign({}, rpSel, { width: "100%", marginTop: 8 })} value={lists.items.some((l) => l.id === ehrListId) ? ehrListId : ""} onChange={(e) => setEhrListId(e.target.value)}>
                    <option value="">Choose a list…</option>
                    {lists.items.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                ) : <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>Epic returned no patient lists for this app. Ask the Epic team for the list's ID and enter it above.</div>)}
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.45 }}>Read live from Epic on every run, up to 150 patients. Patients appear as initials; nothing read from Epic is stored in DocTurn.</div>
              </React.Fragment>
            )}
          </div>
        )}

        <div>
          <div style={rpLabel}>Columns</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
            {ds.columns.map((c) => (
              <label key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", minHeight: 28 }}>
                <input type="checkbox" data-report-col={c.id} checked={columns.includes(c.id)} onChange={() => toggleCol(c.id)} />{c.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={rpLabel}>Group by</div>
            <select data-report-group style={Object.assign({}, rpSel, { width: "100%" })} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="">No grouping</option>
              {ds.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={rpLabel}>Sort by</div>
            <div style={{ display: "flex", gap: 8 }}>
              <select data-report-sort style={Object.assign({}, rpSel, { flex: 1, minWidth: 0 })} value={sort.column} onChange={(e) => setSort({ column: e.target.value, dir: sort.dir })}>
                <option value="">As recorded</option>
                {ds.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select aria-label="Sort direction" style={rpSel} value={sort.dir} onChange={(e) => setSort({ column: sort.column, dir: e.target.value })}>
                <option value="asc">A → Z, low → high</option>
                <option value="desc">Z → A, high → low</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <div style={rpLabel}>Only show rows where</div>
          {filters.map((f, i) => (
            <div key={i} data-report-filter style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
              <select aria-label="Filter column" style={Object.assign({}, rpSel, { flex: "1 1 130px", minWidth: 0 })} value={f.column} onChange={(e) => setFilters(filters.map((x, j) => j === i ? Object.assign({}, x, { column: e.target.value }) : x))}>
                {ds.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select aria-label="Filter rule" style={rpSel} value={f.op} onChange={(e) => setFilters(filters.map((x, j) => j === i ? Object.assign({}, x, { op: e.target.value }) : x))}>
                {catalog.filterOps.map((o) => <option key={o} value={o}>{RP_OPS[o] || o}</option>)}
              </select>
              {f.op !== "empty" && f.op !== "notEmpty" && (
                <input aria-label="Filter value" value={f.value} maxLength={120} onChange={(e) => setFilters(filters.map((x, j) => j === i ? Object.assign({}, x, { value: e.target.value }) : x))}
                  style={Object.assign({}, rpSel, { flex: "1 1 120px", minWidth: 0 })} />
              )}
              <Button size="sm" variant="ghost" icon="x" aria-label="Remove filter" onClick={() => setFilters(filters.filter((_, j) => j !== i))} />
            </div>
          ))}
          {filters.length < 8 && <Button size="sm" variant="outline" icon="plus" onClick={() => setFilters(filters.concat([{ column: ds.columns[0].id, op: "contains", value: "" }]))}>Add a filter</Button>}
        </div>

        {catalog.canShare && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" data-report-shared checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with everyone in this organization
          </label>
        )}

        {error && <div data-report-builder-error role="alert" style={{ fontSize: 13, color: "var(--destructive)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" icon="play" onClick={preview} disabled={busy || blocked}>Run without saving</Button>
          <Button icon="save" onClick={save} disabled={busy || blocked}>{start.id ? "Save changes" : "Save report"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Reports() {
  const act = window.DT.actions.reporting;
  const mobile = useIsMobile();
  const [catalog, setCatalog] = React.useState(null);
  const [reports, setReports] = React.useState(null);
  const [loadError, setLoadError] = React.useState(false);
  const [current, setCurrent] = React.useState(null); // { ref } | { draft }
  const [view, setView] = React.useState({ state: "idle" }); // loading | ready | error
  const [builder, setBuilder] = React.useState(null); // null | { initial }
  const seq = React.useRef(0);

  const target = (c) => (c.draft ? { name: c.draft.name, dataset: c.draft.dataset, config: c.draft.config } : { ref: c.ref });
  const run = (c) => {
    const mine = ++seq.current;
    setCurrent(c); setView({ state: "loading" });
    act.run(target(c)).then((r) => { if (seq.current === mine) setView({ state: "ready", result: r }); })
      .catch((e) => { if (seq.current === mine) setView({ state: "error", problem: rpProblem(e) }); });
  };
  const load = (selectRef) => Promise.all([act.catalog(), act.list()]).then(([cat, list]) => {
    setCatalog(cat); setReports(list); setLoadError(false);
    const pick = list.find((r) => r.id === selectRef) || list[0];
    if (pick) run({ ref: pick.id });
  }).catch(() => setLoadError(true));
  React.useEffect(() => { load(); return () => { seq.current++; }; }, []);

  if (loadError) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}><div data-report-unavailable>Reports could not be loaded from the server.</div></Card></PageWrap>;
  if (!catalog || !reports) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading reports…</Card></PageWrap>;

  const def = current && current.ref ? reports.find((r) => r.id === current.ref) : null;
  const title = current && current.draft ? current.draft.name : def ? def.name : "";
  const editable = def && !def.builtin && (def.mine || catalog.canShare);
  const result = view.state === "ready" ? view.result : null;
  const dsLabel = (id) => (catalog.datasets.find((d) => d.id === id) || {}).label || id;

  const remove = () => {
    if (!def || !window.confirm("Delete the report “" + def.name + "”? This removes the saved layout, not any patient data.")) return;
    act.remove(def.id).then(() => load()).catch(() => window.DT.set((s) => { s.__toast = { tone: "rejected", title: "Couldn't delete", msg: "The server did not delete this report." }; return s; }));
  };
  const print = () => {
    document.body.classList.add("dt-print-report");
    const done = () => { document.body.classList.remove("dt-print-report"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };
  const exportCsv = () => act.exportCsv(target(current), title).catch(() => window.DT.set((s) => { s.__toast = { tone: "rejected", title: "Download failed", msg: "The server did not return this report. Nothing was saved." }; return s; }));

  // Rows under their group heading, in the order the server sorted them.
  let groups = null;
  if (result && result.groupBy) {
    groups = [];
    result.rows.forEach((r) => {
      const key = r[result.groupBy] == null || r[result.groupBy] === "" ? "—" : String(r[result.groupBy]);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(r); else groups.push({ key, rows: [r] });
    });
  }
  const shown = result ? result.columns.filter((c) => !result.groupBy || c.id !== result.groupBy) : [];
  const groupCol = result && result.groupBy ? result.columns.find((c) => c.id === result.groupBy) : null;
  const th = { textAlign: "left", padding: "9px 14px", fontSize: 11.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
  const td = { padding: "9px 14px", fontSize: 13, borderBottom: "1px solid var(--border)", verticalAlign: "top" };
  const renderRows = (rows) => rows.map((r, i) => (
    <tr key={i} data-report-row>
      {shown.map((c) => <td key={c.id} style={Object.assign({}, td, c.type === "number" ? { fontVariantNumeric: "tabular-nums" } : null, c.id === "summary" || c.id === "reason" ? { minWidth: 180 } : { whiteSpace: "nowrap" })}>{rpCell(r[c.id], c.type)}</td>)}
    </tr>
  ));

  return (
    <PageWrap>
      <div data-report-picker style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {reports.map((r) => {
          const on = current && current.ref === r.id;
          return (
            <button key={r.id} type="button" data-report-tab={r.id} aria-pressed={on} onClick={() => run({ ref: r.id })}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", minHeight: 36, borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
                border: "1px solid " + (on ? "var(--primary)" : "var(--border)"), background: on ? "var(--status-active-bg)" : "var(--card)", color: on ? "var(--primary-ink)" : "var(--foreground)" }}>
              {!r.builtin && <Icon name={r.shared ? "users" : "lock"} size={13} />}{r.name}
            </button>
          );
        })}
        <Button size="sm" icon="plus" onClick={() => setBuilder({ initial: null })} style={{ marginLeft: mobile ? 0 : "auto" }}>New report</Button>
      </div>

      <div data-report-print>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 10, rowGap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <Icon name="table-2" size={17} color="var(--primary-ink)" />
            <h3 data-report-title style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
            {current && current.draft && <Badge variant="secondary">Not saved</Badge>}
            {result && <Badge variant="secondary">{String(result.total)}</Badge>}
            {result && <span data-report-source style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{result.source === "ehr" ? "Read live from Epic" : "From DocTurn records"} · {rpCell(result.generatedAt, "datetime")}</span>}
            <span className="dt-no-print" style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Button size="sm" variant="outline" icon="refresh-cw" onClick={() => current && run(current)} disabled={view.state === "loading"}>Refresh</Button>
              <Button size="sm" variant="outline" icon="download" onClick={exportCsv} disabled={!result}>CSV</Button>
              <Button size="sm" variant="outline" icon="printer" onClick={print} disabled={!result}>Print</Button>
              {current && current.draft && <Button size="sm" icon="save" onClick={() => setBuilder({ initial: Object.assign({ id: null, shared: false }, current.draft) })}>Save…</Button>}
              {editable && <Button size="sm" variant="outline" icon="pencil" onClick={() => setBuilder({ initial: def })}>Edit</Button>}
              {editable && <Button size="sm" variant="outline" icon="trash-2" onClick={remove}>Delete</Button>}
            </span>
          </div>
          {def && !def.builtin && <div style={{ padding: "8px 18px", fontSize: 12, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
            {dsLabel(def.dataset)} · {def.shared ? "Shared with the organization" : "Only you can see this"}{def.ownerName && !def.mine ? " · by " + def.ownerName : ""}
          </div>}
          {result && result.notes.map((n, i) => <div key={i} data-report-note style={{ padding: "8px 18px", fontSize: 12.5, background: "var(--status-pending-bg, var(--secondary))", borderBottom: "1px solid var(--border)" }}>{n}</div>)}

          {view.state === "loading" ? (
            <div data-report-state="loading" style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Running the report…</div>
          ) : view.state === "error" ? (
            <div data-report-state="error" role="alert" style={{ padding: 32, textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{view.problem.title}</div>
              <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6, maxWidth: 520, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>{view.problem.text}</div>
            </div>
          ) : result && !result.rows.length ? (
            <div data-report-state="empty" style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No rows match this report right now.</div>
          ) : result ? (
            <div style={{ overflowX: "auto" }}>
              <table data-report-table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{shown.map((c) => <th key={c.id} style={th}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {groups ? groups.map((g) => (
                    <React.Fragment key={g.key}>
                      <tr data-report-group-row><td colSpan={shown.length} style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
                        {groupCol ? groupCol.label + ": " : ""}{g.key} <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}>· {g.rows.length}</span>
                      </td></tr>
                      {renderRows(g.rows)}
                    </React.Fragment>
                  )) : renderRows(result.rows)}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      {builder && (
        <ReportBuilder catalog={catalog} initial={builder.initial} onClose={() => setBuilder(null)}
          onSaved={(saved) => { setBuilder(null); load(saved && saved.id); }}
          onPreview={(draft) => { setBuilder(null); run({ draft }); }} />
      )}
    </PageWrap>
  );
}

window.Reports = Reports;
