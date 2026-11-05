/* DocTurn web-app UI kit — Billing (REAL, server-backed).

   Two screens, one file:

     BillingSettings  the HOSPITAL's own Settings → Billing (directors only,
                      module `billing`, default OFF). Plan, seats in use vs
                      committed WITH the snapshot date, invoices + download,
                      and the billing contact.
     DevBilling       the DocTurn OPERATOR's console → Billing. Every tenant,
                      its seats, contract status and what it is worth; issue /
                      void / mark paid; change a plan or a contract.

   Nothing on either screen is decided or remembered in the browser. Every
   number comes from GET /api/billing or /api/dev/billing/*, every button is a
   server write, and "Paid" is only ever shown from a record whose source the
   server states — the operator's own action (their user id + timestamp,
   audited) or a Stripe webhook event id. There are no mock invoices.

   While Stripe is not configured the screen says, in plain words, that the
   DocTurn operator issues invoices and marks them paid BY HAND, because that
   is what happens.

   Money is INTEGER CENTS on the wire; the formatting below is presentation
   only (shared/billing.ts formatCents is the same rule server-side — the
   no-build client cannot import it). */

const BILL_STATUS = {
  trial:     { label: "Trial",     bg: "var(--status-pending-bg)",  fg: "var(--status-pending-fg)",  icon: "hourglass" },
  active:    { label: "Active",    bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)", icon: "circle-check-big" },
  past_due:  { label: "Past due",  bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)", icon: "triangle-alert" },
  cancelled: { label: "Cancelled", bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  icon: "circle-pause" },
  expired:   { label: "Expired",   bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)", icon: "calendar-x" },
  unbilled:  { label: "Unbilled",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  icon: "circle-dashed" },
};
const INV_STATUS = {
  draft:  { label: "Draft",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  icon: "file-pen" },
  issued: { label: "Issued", bg: "var(--status-pending-bg)",  fg: "var(--status-pending-fg)",  icon: "send" },
  paid:   { label: "Paid",   bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)", icon: "circle-check-big" },
  void:   { label: "Void",   bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  icon: "ban" },
};

function billMoney(cents, currency) {
  if (cents === null || cents === undefined) return "—";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  const cur = currency || "USD";
  const sym = cur === "USD" || cur === "CAD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : "";
  const body = sym + whole + "." + frac;
  return (neg ? "-" : "") + body + (sym ? (cur === "USD" ? "" : " " + cur) : " " + cur);
}

function BillBadge({ status, map, attr }) {
  const m = (map || BILL_STATUS)[status] || (map || BILL_STATUS).unbilled || { label: status, bg: "var(--secondary)", fg: "var(--muted-foreground)", icon: "circle" };
  const props = attr ? { [attr]: status } : {};
  return (
    <span {...props} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 700, lineHeight: 1.6, background: m.bg, color: m.fg, whiteSpace: "nowrap" }}>
      <Icon name={m.icon} size={12} />{m.label}
    </span>
  );
}

function BillButton({ children, icon, onClick, disabled, primary, danger, dataAttr, title }) {
  const props = dataAttr ? { [dataAttr]: "" } : {};
  return (
    <button type="button" onClick={() => { if (!disabled && onClick) onClick(); }} disabled={disabled} title={title} {...props}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, padding: "0 14px", borderRadius: "var(--radius-md)", fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", maxWidth: "100%",
        border: primary ? "1px solid var(--primary)" : danger ? "1px solid var(--destructive)" : "1px solid var(--border)",
        background: primary ? "var(--primary)" : "var(--card)", color: primary ? "var(--primary-foreground)" : danger ? "var(--destructive)" : "var(--foreground)" }}>
      {icon && <Icon name={icon} size={15} />}{children}
    </button>
  );
}

// ≥16px so iOS Safari never zooms the page when the field is focused.
const BILL_INPUT = { width: "100%", minHeight: 44, fontSize: 16, padding: "0 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", boxSizing: "border-box" };

function BillField({ label, children, hint }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted-foreground)", marginBottom: 4 }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

function BillNote({ tone, icon, children, attr }) {
  const bg = tone === "warn" ? "var(--status-rejected-bg)" : tone === "info" ? "var(--status-pending-bg)" : "var(--secondary)";
  const fg = tone === "warn" ? "var(--status-rejected-fg)" : tone === "info" ? "var(--status-pending-fg)" : "var(--muted-foreground)";
  const props = attr ? { [attr]: "" } : {};
  return (
    <div {...props} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5, padding: "9px 11px", borderRadius: "var(--radius-md)", background: bg, color: fg, minWidth: 0 }}>
      <Icon name={icon || "info"} size={14} style={{ flex: "none", marginTop: 2 }} />
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

/* ── the hospital's own screen ──────────────────────────────────────────── */

function SeatsCard({ seats, entitlement, committed }) {
  const live = (seats && seats.live) || { total: 0, byRole: {} };
  const snap = seats && seats.snapshot;
  const roles = Object.keys(live.byRole || {}).sort();
  return (
    <div data-billing-seats style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 14, background: "var(--card)", minWidth: 0 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 8 }}>Accounts</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span data-seats-live style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>{live.total}</span>
        <span style={{ fontSize: 13.5, color: "var(--muted-foreground)" }}>
          {committed === null || committed === undefined ? "in use" : "in use of " + committed + " in your contract"}
        </span>
      </div>
      {roles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {roles.map((r) => (
            <span key={r} style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-full)", background: "var(--secondary)", color: "var(--muted-foreground)" }}>
              {r.replace(/_/g, " ")} {live.byRole[r]}
            </span>
          ))}
        </div>
      )}
      <div data-seats-snapshot style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
        {snap
          ? "Last daily snapshot: " + snap.seatCount + " account" + (snap.seatCount === 1 ? "" : "s") + " on " + snap.snapshotDate + " (" + snap.timezone + "). An invoice line cites this date."
          : "No daily snapshot has been taken yet. An invoice line always cites the snapshot date it counted."}
      </div>
      {entitlement && entitlement.overageSeats > 0 && (
        <div style={{ marginTop: 10 }}>
          <BillNote tone="info" icon="plus" attr="data-seats-overage">
            {entitlement.overageSeats} account{entitlement.overageSeats === 1 ? "" : "s"} above your contract. These appear as a line on your next invoice — they never stop anyone working.
          </BillNote>
        </div>
      )}
      {entitlement && entitlement.refused && (
        <div style={{ marginTop: 10 }}>
          <BillNote tone="warn" icon="user-x" attr="data-seats-refused">{entitlement.message}</BillNote>
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, contract, view }) {
  return (
    <div data-billing-plan style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 14, background: "var(--card)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{plan ? plan.name : "No plan"}</span>
        <BillBadge status={(view && view.status) || "unbilled"} attr="data-contract-status" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <div><div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>Per account</div><div style={{ fontSize: 14 }}>{plan ? billMoney(plan.perSeatPriceCents, plan.currency) : "—"}</div></div>
        <div><div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>Term</div><div style={{ fontSize: 14 }}>{contract ? contract.term : "—"}</div></div>
        <div><div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>Started</div><div style={{ fontSize: 14 }}>{contract ? contract.startDate : "—"}</div></div>
        <div><div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>Ends</div><div style={{ fontSize: 14 }}>{(contract && contract.endDate) || "No end date"}</div></div>
        <div><div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>PO number</div><div style={{ fontSize: 14, overflowWrap: "anywhere" }}>{(contract && contract.poNumber) || "—"}</div></div>
        <div><div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 700 }}>Payment terms</div><div style={{ fontSize: 14 }}>{contract ? "Net " + contract.daysUntilDue : "—"}</div></div>
      </div>
      {plan && plan.moduleIds && plan.moduleIds.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
          Your plan includes {plan.moduleIds.length} optional feature{plan.moduleIds.length === 1 ? "" : "s"}. Anything already switched on for you stays on — a plan only ever adds.
        </div>
      )}
    </div>
  );
}

function InvoiceRows({ invoices, currency, onDownload, busyId }) {
  if (!invoices || invoices.length === 0) {
    return <div data-billing-no-invoices style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>No invoice has been issued yet.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {invoices.map((inv) => (
        <div key={inv.id} data-invoice={inv.number} data-invoice-status={inv.status}
          style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 11, background: "var(--card)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", minWidth: 0 }}>
          <div style={{ flex: "1 1 190px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{inv.number}</span>
              <BillBadge status={inv.status} map={INV_STATUS} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
              {inv.periodStart} to {inv.periodEnd}{inv.dueOn ? " · due " + inv.dueOn : ""}
            </div>
            {inv.status === "paid" && (
              <div data-invoice-paid-source style={{ fontSize: 12, color: "var(--status-accepted-fg)", marginTop: 2, overflowWrap: "anywhere" }}>
                {inv.paidSource === "stripe" ? "Paid — recorded by Stripe" : "Paid — recorded by DocTurn"}
                {inv.paidAt ? " on " + String(inv.paidAt).slice(0, 10) : ""}
              </div>
            )}
            {inv.status === "void" && inv.voidReason && (
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, overflowWrap: "anywhere" }}>Void — {inv.voidReason}</div>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, flex: "none" }}>{billMoney(inv.totalCents, inv.currency || currency)}</div>
          {onDownload && (
            <BillButton icon="download" dataAttr="data-invoice-download" disabled={busyId === inv.id}
              onClick={() => onDownload(inv)}>CSV</BillButton>
          )}
        </div>
      ))}
    </div>
  );
}

function BillingSettings() {
  const st = useStore();
  const a = useActions();
  const b = st.billing;
  const on = !window.DT || !window.DT.moduleOn || window.DT.moduleOn("billing");
  // The SERVER's rule (server/routes/billing.ts BILLING_ROLES): a hospitalist
  // director or the DocTurn operator, nobody else. An ER director can reach
  // this nav id, so the screen says so in the same words instead of waiting
  // forever for a read the server answers 403.
  const role = st.session && st.session.role;
  const maySee = role === "director" || role === "developer";
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [dl, setDl] = React.useState(0);

  React.useEffect(() => { if (on && maySee && a.loadBilling) a.loadBilling(); }, [on, maySee]);
  React.useEffect(() => {
    if (!b || !b.contract || touched) return;
    setName(b.contract.billingContactName || "");
    setEmail(b.contract.billingContactEmail || "");
  }, [b && b.contract && b.contract.id, b && b.contract && b.contract.billingContactEmail]);

  if (!on) {
    return (
      <>
      <SettingsTabs />
      <Card>
        <SectionTitle icon="receipt" title="Billing" sub="Switched off for your organization" />
        <BillNote tone="plain" icon="circle-pause" attr="data-billing-module-off">
          Billing is not switched on for this organization. Nothing is billed and nothing here is served — ask DocTurn if you expected to see it.
        </BillNote>
      </Card>
      </>
    );
  }
  if (!maySee) {
    return (
      <>
      <SettingsTabs />
      <Card>
        <SectionTitle icon="receipt" title="Billing" sub="Not your role" />
        <BillNote tone="plain" icon="lock" attr="data-billing-role-refused">
          Only a hospitalist director sees this organization's billing. The server refuses it for every other role.
        </BillNote>
      </Card>
      </>
    );
  }
  if (!b) {
    return (
      <>
      <SettingsTabs />
      <Card>
        <SectionTitle icon="receipt" title="Billing" sub="Loading from the server…" />
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Reading your organization's billing from the server.</div>
      </Card>
      </>
    );
  }

  const committed = b.contract ? b.contract.committedSeats : null;
  const dirty = !!b.contract && (name !== (b.contract.billingContactName || "") || email !== (b.contract.billingContactEmail || ""));

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      {/* The same Settings sub-nav every other Settings screen renders, so
          Billing is reachable from Organization / Appearance / Compliance and
          back (webapp/AppShell.jsx SettingsTabs). */}
      <SettingsTabs />
      <Card>
        <SectionTitle icon="receipt" title="Billing" sub={b.billed ? "Your DocTurn plan, accounts and invoices — from the server" : "What DocTurn holds for your organization"} />
        {b.notice && <BillNote tone="plain" icon="circle-dashed" attr="data-billing-no-contract">{b.notice}</BillNote>}
        {b.view && b.view.warning && (
          <div style={{ marginTop: b.notice ? 10 : 0 }}>
            <BillNote tone="warn" icon="triangle-alert" attr="data-billing-warning">{b.view.warning}</BillNote>
          </div>
        )}
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <SeatsCard seats={b.seats} entitlement={b.entitlement} committed={committed} />
          {b.billed && <PlanCard plan={b.plan} contract={b.contract} view={b.view} />}
        </div>
      </Card>

      {b.billed && (
        <Card>
          <SectionTitle icon="file-text" title="Invoices" sub="Issued by DocTurn — download any of them" />
          <InvoiceRows invoices={b.invoices} currency={b.currency} busyId={dl}
            onDownload={(inv) => { setDl(inv.id); Promise.resolve(a.downloadInvoice && a.downloadInvoice(inv.id)).then(() => setDl(0), () => setDl(0)); }} />
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {b.collection && (
              <BillNote tone="plain" icon={b.collection.via === "stripe" ? "credit-card" : "pen-line"} attr="data-billing-collection">
                {b.collection.note}
              </BillNote>
            )}
            {b.prorationNote && <BillNote tone="plain" icon="calendar-clock" attr="data-billing-proration">{b.prorationNote}</BillNote>}
          </div>
        </Card>
      )}

      {b.billed && (
        <Card>
          <SectionTitle icon="mail" title="Billing contact" sub="Who DocTurn sends the invoice to" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <BillField label="Name">
              <input data-billing-contact-name style={BILL_INPUT} value={name} onChange={(e) => { setTouched(true); setName(e.target.value); }} placeholder="Accounts payable contact" />
            </BillField>
            <BillField label="Email" hint="DocTurn only uses this for billing.">
              <input data-billing-contact-email type="email" style={BILL_INPUT} value={email} onChange={(e) => { setTouched(true); setEmail(e.target.value); }} placeholder="billing@hospital.example" />
            </BillField>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <BillButton primary icon="save" dataAttr="data-billing-contact-save" disabled={!dirty || b.contactSaving}
              onClick={() => a.saveBillingContact && a.saveBillingContact({ billingContactName: name.trim() || null, billingContactEmail: email.trim() || null })}>
              {b.contactSaving ? "Saving…" : "Save contact"}
            </BillButton>
            {dirty && <BillButton icon="undo-2" onClick={() => { setTouched(false); setName(b.contract.billingContactName || ""); setEmail(b.contract.billingContactEmail || ""); }}>Discard</BillButton>}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── the operator's console (appended to webapp/Billing.jsx) ─────────────── */

function ContractForm({ row, plans, onSave, onClear, busy }) {
  const c = row.contract;
  const [f, setF] = React.useState(() => ({
    planId: c ? String(c.planId) : plans[0] ? String(plans[0].id) : "",
    term: c ? c.term : "monthly",
    startDate: c ? c.startDate : new Date().toISOString().slice(0, 10),
    endDate: (c && c.endDate) || "",
    committedSeats: c ? String(c.committedSeats) : String(Math.max(1, (row.seats && row.seats.live && row.seats.live.total) || 1)),
    priceOverrideCents: c && c.priceOverrideCents != null ? String(c.priceOverrideCents) : "",
    poNumber: (c && c.poNumber) || "",
    billingContactName: (c && c.billingContactName) || "",
    billingContactEmail: (c && c.billingContactEmail) || "",
    status: c ? c.status : "trial",
    daysUntilDue: c ? String(c.daysUntilDue) : "30",
  }));
  const up = (k) => (e) => setF(Object.assign({}, f, { [k]: e.target.value }));
  const sel = Object.assign({}, BILL_INPUT, { appearance: "auto" });
  return (
    <div data-contract-form={row.orgCode} style={{ borderTop: "1px solid var(--border)", marginTop: 11, paddingTop: 11, display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <BillField label="Plan">
          <select data-contract-plan style={sel} value={f.planId} onChange={up("planId")}>
            {plans.length === 0 && <option value="">No plan exists yet</option>}
            {plans.map((p) => <option key={p.id} value={String(p.id)}>{p.name} · {billMoney(p.perSeatPriceCents, p.currency)}/account</option>)}
          </select>
        </BillField>
        <BillField label="Term">
          <select data-contract-term style={sel} value={f.term} onChange={up("term")}>
            <option value="monthly">monthly</option><option value="annual">annual</option>
          </select>
        </BillField>
        <BillField label="Status" hint="A trial is a plan with an end date.">
          <select data-contract-status-input style={sel} value={f.status} onChange={up("status")}>
            {["trial", "active", "past_due", "cancelled", "expired"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </BillField>
        <BillField label="Committed accounts">
          <input data-contract-seats style={BILL_INPUT} inputMode="numeric" value={f.committedSeats} onChange={up("committedSeats")} />
        </BillField>
        <BillField label="Start (YYYY-MM-DD)">
          <input data-contract-start style={BILL_INPUT} value={f.startDate} onChange={up("startDate")} placeholder="2026-01-01" />
        </BillField>
        <BillField label="End (blank = open-ended)">
          <input data-contract-end style={BILL_INPUT} value={f.endDate} onChange={up("endDate")} placeholder="" />
        </BillField>
        <BillField label="Price override (cents/account)" hint="Blank uses the plan's price.">
          <input data-contract-override style={BILL_INPUT} inputMode="numeric" value={f.priceOverrideCents} onChange={up("priceOverrideCents")} />
        </BillField>
        <BillField label="Net terms (days)">
          <input data-contract-net style={BILL_INPUT} inputMode="numeric" value={f.daysUntilDue} onChange={up("daysUntilDue")} />
        </BillField>
        <BillField label="PO number">
          <input data-contract-po style={BILL_INPUT} value={f.poNumber} onChange={up("poNumber")} />
        </BillField>
        <BillField label="Billing contact">
          <input data-contract-contact style={BILL_INPUT} value={f.billingContactName} onChange={up("billingContactName")} />
        </BillField>
        <BillField label="Billing email">
          <input data-contract-email type="email" style={BILL_INPUT} value={f.billingContactEmail} onChange={up("billingContactEmail")} />
        </BillField>
      </div>
      <BillNote tone="plain" icon="calendar-clock">
        A mid-term plan change is prorated on the hospital's NEXT invoice. An invoice already issued is never recomputed — void and reissue it instead.
      </BillNote>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <BillButton primary icon="save" dataAttr="data-contract-save" disabled={busy || !f.planId}
          onClick={() => onSave({
            planId: Number(f.planId),
            term: f.term,
            startDate: f.startDate.trim(),
            endDate: f.endDate.trim() || null,
            committedSeats: Number(f.committedSeats),
            priceOverrideCents: f.priceOverrideCents.trim() === "" ? null : Number(f.priceOverrideCents),
            poNumber: f.poNumber.trim() || null,
            billingContactName: f.billingContactName.trim() || null,
            billingContactEmail: f.billingContactEmail.trim() || null,
            status: f.status,
            daysUntilDue: Number(f.daysUntilDue),
          })}>{busy ? "Saving…" : c ? "Save contract" : "Put on contract"}</BillButton>
        {c && <BillButton danger icon="trash-2" dataAttr="data-contract-clear" disabled={busy} onClick={onClear}>Take off contract</BillButton>}
      </div>
    </div>
  );
}

function InvoiceActions({ inv, onIssue, onVoid, onPaid, onStripe, stripeOn, busy }) {
  const [reason, setReason] = React.useState("");
  const [ref, setRef] = React.useState("");
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {inv.status === "draft" && <BillButton primary icon="send" dataAttr="data-invoice-issue" disabled={busy} onClick={onIssue}>Issue</BillButton>}
        {(inv.status === "issued") && (
          <BillButton primary icon="circle-check-big" dataAttr="data-invoice-paid" disabled={busy} onClick={() => onPaid(ref.trim() || null)}>Mark paid</BillButton>
        )}
        {/* Stripe is the COLLECTION rail, so this only appears for an invoice
            that has been issued, when Stripe is configured and this hospital's
            billing.stripe is on, and only until it has been sent once. */}
        {inv.status === "issued" && stripeOn && !inv.stripeInvoiceId && (
          <BillButton icon="credit-card" dataAttr="data-invoice-stripe" disabled={busy} onClick={onStripe}>Send to Stripe</BillButton>
        )}
        {inv.stripeInvoiceId && (
          <span data-invoice-stripe-id style={{ fontSize: 12, color: "var(--muted-foreground)", alignSelf: "center", overflowWrap: "anywhere" }}>
            Stripe {inv.stripeInvoiceId}
          </span>
        )}
        {(inv.status === "draft" || inv.status === "issued") && (
          <BillButton danger icon="ban" dataAttr="data-invoice-void" disabled={busy || reason.trim().length < 3} onClick={() => onVoid(reason.trim())}
            title={reason.trim().length < 3 ? "Give a reason first" : undefined}>Void</BillButton>
        )}
      </div>
      {inv.status === "issued" && (
        <BillField label="Payment reference (cheque / ACH / wire)" hint="Recorded with your user id and the time. This is the only way an invoice becomes Paid by hand.">
          <input data-invoice-ref style={BILL_INPUT} value={ref} onChange={(e) => setRef(e.target.value)} />
        </BillField>
      )}
      {(inv.status === "draft" || inv.status === "issued") && (
        <BillField label="Void reason">
          <input data-invoice-void-reason style={BILL_INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this invoice is void" />
        </BillField>
      )}
    </div>
  );
}

function TenantRow({ row, plans, invoices, actions, busy, stripeOn }) {
  const [open, setOpen] = React.useState(false);
  const [gen, setGen] = React.useState({ periodStart: "", periodEnd: "" });
  const ent = row.view || {};
  return (
    <div data-tenant={row.orgCode} data-tenant-status={ent.status || "unbilled"}
      style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 12, background: "var(--card)", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{row.orgName}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted-foreground)" }}>{row.orgCode}</span>
            <BillBadge status={row.contract ? (ent.status || "active") : "unbilled"} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 3 }}>
            <span data-tenant-seats>{(row.seats && row.seats.live && row.seats.live.total) || 0}</span>
            {row.contract ? " of " + row.contract.committedSeats + " accounts" : " accounts · unlimited and unbilled"}
            {row.overageSeats > 0 ? " · " + row.overageSeats + " over" : ""}
            {row.seats && row.seats.snapshot ? " · snapshot " + row.seats.snapshot.snapshotDate : " · no snapshot yet"}
          </div>
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{row.monthlyCents == null ? "—" : billMoney(row.monthlyCents, row.plan && row.plan.currency)}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{row.contract ? "per " + row.contract.term.replace("ly", "") : "not billed"}</div>
        </div>
        <BillButton icon={open ? "chevron-up" : "pencil"} dataAttr="data-tenant-open" onClick={() => setOpen(!open)}>
          {open ? "Close" : row.contract ? "Contract" : "Set up"}
        </BillButton>
      </div>
      {ent.warning && <div style={{ marginTop: 10 }}><BillNote tone="warn" icon="triangle-alert">{ent.warning}</BillNote></div>}
      {open && (
        <>
          <ContractForm row={row} plans={plans} busy={busy}
            onSave={(body) => actions.saveContract(row.orgId, body)}
            onClear={() => actions.clearContract(row.orgId)} />
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12, display: "grid", gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Invoices</div>
            {!row.contract && <BillNote tone="plain" icon="info">Put this hospital on a contract before generating an invoice.</BillNote>}
            {row.contract && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "end" }}>
                <BillField label="Period start"><input data-gen-start style={BILL_INPUT} value={gen.periodStart} onChange={(e) => setGen({ periodStart: e.target.value, periodEnd: gen.periodEnd })} placeholder="2026-03-01" /></BillField>
                <BillField label="Period end"><input data-gen-end style={BILL_INPUT} value={gen.periodEnd} onChange={(e) => setGen({ periodStart: gen.periodStart, periodEnd: e.target.value })} placeholder="2026-03-31" /></BillField>
                <BillButton primary icon="file-plus" dataAttr="data-gen-invoice" disabled={busy || !gen.periodStart || !gen.periodEnd}
                  onClick={() => actions.generateInvoice(row.orgId, gen.periodStart.trim(), gen.periodEnd.trim())}>Generate draft</BillButton>
              </div>
            )}
            {(invoices || []).map((inv) => (
              <div key={inv.id} data-dev-invoice={inv.number} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 11, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{inv.number}</span>
                  <BillBadge status={inv.status} map={INV_STATUS} />
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{inv.periodStart} → {inv.periodEnd}</span>
                  <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700 }}>{billMoney(inv.totalCents, inv.currency)}</span>
                </div>
                {inv.lines && inv.lines.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                    {l.quantity} × {billMoney(l.unitCents, inv.currency)} — {l.description}
                    {l.citedDates && l.citedDates.length > 0 ? " [snapshots: " + l.citedDates.join(", ") + "]" : ""}
                  </div>
                ))}
                {inv.status === "paid" && (
                  <div style={{ fontSize: 12, color: "var(--status-accepted-fg)", marginTop: 4, overflowWrap: "anywhere" }}>
                    Paid — {inv.paidSource === "stripe" ? "Stripe event " + (inv.paidReference || "") : "recorded by the operator" + (inv.paidReference ? " (" + inv.paidReference + ")" : "")}
                  </div>
                )}
                {(inv.status === "draft" || inv.status === "issued") && (
                  <InvoiceActions inv={inv} busy={busy} stripeOn={stripeOn}
                    onIssue={() => actions.issueInvoice(inv.id)}
                    onVoid={(reason) => actions.voidInvoice(inv.id, reason)}
                    onPaid={(ref) => actions.markInvoicePaid(inv.id, ref)}
                    onStripe={() => actions.pushInvoiceToStripe(inv.id)} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PlansCard({ plans, onCreate, busy }) {
  const [f, setF] = React.useState({ code: "", name: "", perSeatPriceCents: "", currency: "USD", moduleIds: [] });
  const up = (k) => (e) => setF(Object.assign({}, f, { [k]: e.target.value }));
  const registry = (window.DT && window.DT.getState && window.DT.getState().modules) || {};
  const ids = Object.keys(registry).sort();
  return (
    <Card>
      <SectionTitle icon="tags" title="Plans" sub="The catalogue you sell. Nothing is seeded — create the first plan here." />
      {plans.length === 0
        ? <BillNote tone="plain" icon="circle-dashed" attr="data-no-plans">No plan exists yet. A price nobody typed would be demo data, so DocTurn ships none.</BillNote>
        : (
          <div style={{ display: "grid", gap: 8 }}>
            {plans.map((p) => (
              <div key={p.id} data-plan={p.code} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 11, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, overflowWrap: "anywhere" }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{p.code} · {p.moduleIds.length} feature{p.moduleIds.length === 1 ? "" : "s"} · {p.contracts} contract{p.contracts === 1 ? "" : "s"}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{billMoney(p.perSeatPriceCents, p.currency)}<span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>/account</span></div>
              </div>
            ))}
          </div>
        )}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12, display: "grid", gap: 12, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <BillField label="Code" hint="lower-case, e.g. enterprise"><input data-plan-code style={BILL_INPUT} value={f.code} onChange={up("code")} /></BillField>
          <BillField label="Name"><input data-plan-name style={BILL_INPUT} value={f.name} onChange={up("name")} /></BillField>
          <BillField label="Price per account (cents)" hint="Integer cents. Never a float."><input data-plan-price style={BILL_INPUT} inputMode="numeric" value={f.perSeatPriceCents} onChange={up("perSeatPriceCents")} /></BillField>
          <BillField label="Currency">
            <select data-plan-currency style={BILL_INPUT} value={f.currency} onChange={up("currency")}>
              {["USD", "CAD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </BillField>
        </div>
        <BillField label="Features this plan GRANTS" hint="A plan only ever adds. Nothing here switches a hospital's module off.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto", padding: 2 }}>
            {ids.map((id) => {
              const on = f.moduleIds.indexOf(id) >= 0;
              return (
                <button key={id} type="button" data-plan-module={id}
                  onClick={() => setF(Object.assign({}, f, { moduleIds: on ? f.moduleIds.filter((x) => x !== id) : f.moduleIds.concat([id]) }))}
                  style={{ minHeight: 44, padding: "0 11px", borderRadius: "var(--radius-full)", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer", whiteSpace: "nowrap",
                    border: "1px solid " + (on ? "var(--primary)" : "var(--border)"), background: on ? "var(--primary)" : "var(--card)", color: on ? "var(--primary-foreground)" : "var(--foreground)" }}>
                  {id}
                </button>
              );
            })}
          </div>
        </BillField>
        <div>
          <BillButton primary icon="plus" dataAttr="data-plan-create" disabled={busy || !f.code.trim() || !f.name.trim() || !String(f.perSeatPriceCents).trim()}
            onClick={() => onCreate({ code: f.code.trim().toLowerCase(), name: f.name.trim(), perSeatPriceCents: Number(f.perSeatPriceCents), currency: f.currency, moduleIds: f.moduleIds })
              .then((ok) => { if (ok) setF({ code: "", name: "", perSeatPriceCents: "", currency: "USD", moduleIds: [] }); })}>
            {busy ? "Saving…" : "Create plan"}
          </BillButton>
        </div>
      </div>
    </Card>
  );
}

function DevBilling() {
  const st = useStore();
  const a = useActions();
  const d = st.devBilling;
  React.useEffect(() => { if (a.loadDevBilling) a.loadDevBilling(); }, []);
  if (!d) {
    return (
      <Card>
        <SectionTitle icon="receipt" title="Billing" sub="Reading every tenant's contract from the server…" />
      </Card>
    );
  }
  const plans = d.plans || [];
  const byOrg = {};
  (d.invoices || []).forEach((i) => { (byOrg[i.orgId] = byOrg[i.orgId] || []).push(i); });
  const overdue = (d.tenants || []).filter((t) => t.view && (t.view.status === "past_due" || t.view.status === "expired"));
  // Money is summed PER CURRENCY. A contract's currency is fixed per contract,
  // so one number across currencies would be meaningless.
  const byCurrency = (rows, pick) => {
    const out = {};
    (rows || []).forEach(function (r) { const c = pick(r); if (c) out[c.cur] = (out[c.cur] || 0) + c.cents; });
    return out;
  };
  const committed = (d.totals && d.totals.committedByCurrency) || {};
  const unpaidByCurrency = byCurrency((d.invoices || []).filter((i) => i.status === "issued"), (i) => ({ cur: i.currency, cents: i.totalCents }));
  const moneyLines = (map) => {
    const keys = Object.keys(map).sort();
    return keys.length === 0 ? "—" : keys.map((c) => billMoney(map[c], c)).join(" · ");
  };
  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <Card>
        <SectionTitle icon="receipt" title="Billing" sub="Every hospital, its accounts and its contract — from the server" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10 }}>
          {[
            ["Tenants", String((d.totals && d.totals.tenants) || 0), "building-2"],
            ["Committed / month", moneyLines(committed), "banknote"],
            ["Issued, unpaid", moneyLines(unpaidByCurrency), "clock"],
            ["Past due / expired", String(overdue.length), "triangle-alert"],
          ].map((t) => (
            <div key={t[0]} data-dev-billing-kpi={t[0]} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 11, background: "var(--card)", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "var(--muted-foreground)" }}>
                <Icon name={t[2]} size={13} />{t[0]}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, overflowWrap: "anywhere" }}>{t[1]}</div>
            </div>
          ))}
        </div>
        {d.stripe && !d.stripe.configured && (
          <div style={{ marginTop: 12 }}>
            <BillNote tone="plain" icon="pen-line" attr="data-dev-billing-manual">
              Stripe is not configured{d.stripe.missing && d.stripe.missing.length ? " (" + d.stripe.missing.join(", ") + " missing on the server)" : ""}.
              You issue invoices and mark them paid here, by hand; every action is recorded with your user id in the hospital's own audit trail.
            </BillNote>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle icon="building-2" title="Hospitals" sub="Accounts in use, the contract, and the invoices" />
        <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
          {(d.tenants || []).map((row) => (
            <TenantRow key={row.orgId} row={row} plans={plans} invoices={byOrg[row.orgId]} busy={!!d.busy}
              stripeOn={!!(d.stripe && d.stripe.configured)}
              actions={{
                saveContract: a.saveDevContract, clearContract: a.clearDevContract,
                generateInvoice: a.generateInvoice, issueInvoice: a.issueInvoice,
                voidInvoice: a.voidInvoice, markInvoicePaid: a.markInvoicePaid,
                pushInvoiceToStripe: a.pushInvoiceToStripe,
              }} />
          ))}
        </div>
      </Card>

      <PlansCard plans={plans} busy={!!d.busy} onCreate={(body) => Promise.resolve(a.createBillingPlan && a.createBillingPlan(body))} />
    </div>
  );
}


Object.assign(window, { BillingSettings, DevBilling, billMoney, BillBadge, BILL_STATUS, INV_STATUS });
