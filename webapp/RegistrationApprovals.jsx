/* DocTurn web-app UI kit — self-registration approval queue.
   Directors and ER directors review accounts requested via the org code on the
   login screen and approve or deny them. Approving activates the account (a
   hospitalist also gets a rotation profile). Developers have root access. */

function RegistrationApprovals({ registrations = [], onApprove, onDeny, onRefresh }) {
  const ROLE_LABEL = { hospitalist: "Hospitalist", er_doctor: "ER physician", er_director: "ER director", director: "Hospitalist director" };
  const ROLE_ICON = { hospitalist: "stethoscope", er_doctor: "ambulance", er_director: "siren", director: "clipboard-list" };
  const pending = (registrations || []).filter((r) => r.status === "pending");
  const [busy, setBusy] = React.useState({});
  const act = (id, fn) => { setBusy((b) => ({ ...b, [id]: true })); Promise.resolve(fn(id)).finally(() => setBusy((b) => { const n = { ...b }; delete n[id]; return n; })); };

  return (
    <PageWrap>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Pending registrations</h2>
          <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "2px 0 0" }}>People who requested an account with your organization code. Approve to activate, or deny.</p>
        </div>
        <span style={{ marginLeft: "auto" }}>
          {onRefresh && <Button size="sm" variant="outline" icon="refresh-cw" onClick={onRefresh}>Refresh</Button>}
        </span>
      </div>

      {pending.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center", color: "var(--muted-foreground)" }}>
          <Icon name="user-check" size={22} color="var(--muted-foreground)" />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginTop: 8 }}>No pending requests</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>New sign-ups via the org code will appear here for approval.</div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {pending.map((r, i) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <Avatar initials={(r.displayName || r.username || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()} size={38} tint="blue" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.displayName}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>@{r.username}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: "var(--radius-full)", background: "var(--secondary)", fontWeight: 600, color: "var(--foreground)" }}>
                    <Icon name={ROLE_ICON[r.requestedRole] || "user"} size={11} /> {ROLE_LABEL[r.requestedRole] || r.requestedRole}
                  </span>
                </div>
              </div>
              <Button size="sm" variant="outline" icon="x" onClick={() => act(r.id, onDeny)} disabled={!!busy[r.id]}>Deny</Button>
              <Button size="sm" icon="check" onClick={() => act(r.id, onApprove)} disabled={!!busy[r.id]}>{busy[r.id] ? "…" : "Approve"}</Button>
            </div>
          ))}
        </Card>
      )}
    </PageWrap>
  );
}

Object.assign(window, { RegistrationApprovals });
