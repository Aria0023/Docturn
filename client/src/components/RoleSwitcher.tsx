import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

// Demo convenience (mirrors the kit's topbar role switcher): re-logs in as the
// representative seed account for the chosen role. All seed passwords are "docturn".
const DEMO_ACCOUNT: Record<Role, string> = {
  hospitalist: "chen",
  er_doctor: "er.doc",
  er_director: "er.director",
  director: "director",
  developer: "dev",
};

const ROLES: Array<[Role, string]> = [
  ["hospitalist", "Hospitalist"],
  ["er_doctor", "ER physician"],
  ["er_director", "ER director"],
  ["director", "Hosp. director"],
  ["developer", "Developer"],
];

export function RoleSwitcher({ current }: { current: Role }) {
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  async function switchTo(role: Role) {
    if (role === current) return;
    try {
      await api.post("/api/login", {
        orgCode: "MERCY",
        username: DEMO_ACCOUNT[role],
        password: "docturn",
      });
      qc.clear();
      await refresh();
      setLocation("/");
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`No "${DEMO_ACCOUNT[role]}" demo account — reseed to add it.`);
        setTimeout(() => setError(null), 4000);
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 2, padding: 3, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
        {ROLES.map(([id, label]) => (
          <button key={id} onClick={() => switchTo(id)}
            style={{ padding: "6px 11px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 500,
              background: current === id ? "#fff" : "transparent",
              color: current === id ? "var(--primary)" : "var(--muted-foreground)",
              boxShadow: current === id ? "var(--shadow-sm)" : "none" }}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div style={{ position: "absolute", top: 44, right: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", padding: "8px 12px", fontSize: 12, color: "var(--destructive)", whiteSpace: "nowrap", zIndex: 30 }}>
          {error}
        </div>
      )}
    </div>
  );
}
