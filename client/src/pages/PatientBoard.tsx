import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BoardRow } from "@/lib/types";
import { Avatar, Badge, Card, EmptyCard, PageWrap } from "@/components/kit";

const DEPARTMENTS = ["ALL", "ER", "ICU", "MED", "TELE"];

export function PatientBoard() {
  const [dept, setDept] = useState("ALL");
  const path = dept === "ALL" ? "/api/patient-board" : `/api/patient-board?department=${dept}`;
  const { data: rows = [] } = useQuery<BoardRow[]>({ queryKey: [path] });

  return (
    <PageWrap>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 2, padding: 3, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
          {DEPARTMENTS.map((d) => (
            <button key={d} onClick={() => setDept(d)}
              style={{ padding: "6px 12px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 500,
                background: dept === d ? "#fff" : "transparent", color: dept === d ? "var(--primary)" : "var(--muted-foreground)",
                boxShadow: dept === d ? "var(--shadow-sm)" : "none" }}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyCard icon="layout-list" title="No distributed patients" />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr 1fr", gap: 0, padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>
            <span>Patient</span><span>Responsible</span><span>Consultants</span><span>Admitted by</span><span>Status</span>
          </div>
          {rows.map((r) => (
            <div key={r.patient.id} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr 1fr", gap: 0, padding: "12px 16px", borderTop: "1px solid var(--border)", alignItems: "center", fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {r.patient.initials}
                  {r.patient.room && <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}> · {r.patient.room}</span>}
                  {r.patient.department && <span style={{ marginLeft: 6, background: "var(--secondary)", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>{r.patient.department}</span>}
                </div>
                <div style={{ color: "var(--muted-foreground)", fontSize: 12.5 }}>{r.patient.issue}</div>
              </div>
              <div>
                {r.responsible?.attending ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "flex" }}>
                      <Avatar initials={initialsOf(r.responsible.attending.displayName)} size={26} tint="blue" />
                      {r.responsible.unit.map((u) => (
                        <span key={u.userId} style={{ marginLeft: -8 }}><Avatar initials={initialsOf(u.displayName)} size={26} tint="slate" /></span>
                      ))}
                    </span>
                    <span style={{ fontSize: 12.5 }}>{r.responsible.attending.displayName}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--muted-foreground)" }}>Routing…</span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {r.consultants.length ? r.consultants.map((c, i) => (
                  <span key={i} style={{ background: "var(--status-active-bg)", color: "var(--status-active)", borderRadius: "var(--radius-full)", padding: "1px 8px", fontSize: 11.5, fontWeight: 600 }}>{c}</span>
                )) : <span style={{ color: "var(--muted-foreground)" }}>—</span>}
              </div>
              <div style={{ color: "var(--muted-foreground)", fontSize: 12.5 }}>{r.admittedBy?.displayName ?? "—"}</div>
              <div><Badge status={r.status}>{r.status}</Badge></div>
            </div>
          ))}
        </Card>
      )}
    </PageWrap>
  );
}

function initialsOf(name: string): string {
  return name.replace(/,.*$/, "").replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
