import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CareTeam, Candidate, FeatureFlag, Suggestion } from "@/lib/types";
import { Button, Card, CardHeader, EmptyState, Input } from "@/components/ui";

interface SettingsResponse {
  org: {
    assignmentTimeoutMin?: number;
    roundRobinShiftTypes?: string[];
    rotationMode?: string;
  };
}

export function Settings() {
  const { user } = useAuth();
  const { data } = useQuery<SettingsResponse>({ queryKey: ["/api/settings"] });
  const isDirector = user?.role === "director" || user?.role === "developer";

  return (
    <div className="space-y-6" style={{ padding: 28, maxWidth: 1040, margin: "0 auto" }}>
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader title="My account" />
        <dl className="divide-y divide-border">
          <Row label="Name" value={user?.displayName} />
          <Row label="Username" value={user?.username} />
          <Row label="Role" value={user?.role?.replace("_", " ")} />
        </dl>
      </Card>

      <MfaSection />
      <CareTeamSection />

      <Card>
        <CardHeader
          title="Organization policy"
          subtitle={
            isDirector ? "Editable on the director dashboard" : "Read-only"
          }
        />
        <dl className="divide-y divide-border">
          <Row
            label="Assignment timeout"
            value={
              data?.org.assignmentTimeoutMin
                ? `${data.org.assignmentTimeoutMin} min`
                : "—"
            }
          />
          <Row label="Rotation mode" value={data?.org.rotationMode ?? "—"} />
          <Row
            label="Round-robin shifts"
            value={data?.org.roundRobinShiftTypes?.join(", ") ?? "—"}
          />
        </dl>
      </Card>

      {isDirector && <SuggestionsSection />}
      {isDirector && <FeatureFlagsSection />}
    </div>
  );
}

function MfaSection() {
  const [enroll, setEnroll] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>("/api/mfa/enroll"),
    onSuccess: (d) => setEnroll(d),
  });
  const verify = useMutation({
    mutationFn: () => api.post<{ backupCodes: string[] }>("/api/mfa/verify", { code }),
    onSuccess: (d) => {
      setCodes(d.backupCodes);
      setEnroll(null);
      setError(null);
    },
    onError: () => setError("Invalid code. Try the current 6-digit code."),
  });

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        subtitle="TOTP authenticator app"
      />
      <div className="space-y-3 p-6">
        {!enroll && !codes && (
          <Button variant="secondary" onClick={() => begin.mutate()}>
            Set up 2FA
          </Button>
        )}
        {enroll && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add this secret to your authenticator app, then enter the current
              code:
            </p>
            <code className="block rounded bg-secondary p-2 text-xs">
              {enroll.secret}
            </code>
            <div className="flex gap-2">
              <Input
                className="max-w-[160px]"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button onClick={() => verify.mutate()} disabled={!code}>
                Verify & enable
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        {codes && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-status-accepted">
              2FA enabled. Save these one-time backup codes:
            </p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm">
              {codes.map((c) => (
                <span key={c} className="rounded bg-secondary px-2 py-1">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function CareTeamSection() {
  const qc = useQueryClient();
  const { data: team } = useQuery<CareTeam>({ queryKey: ["/api/care-team"] });
  const { data: candidates = [] } = useQuery<Candidate[]>({
    queryKey: ["/api/care-team/candidates"],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/care-team"] });
    qc.invalidateQueries({ queryKey: ["/api/care-team/candidates"] });
  };
  const add = useMutation({
    mutationFn: (memberUserId: number) =>
      api.post("/api/care-team/members", { memberUserId }),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: ({ id, onCall }: { id: number; onCall: boolean }) =>
      api.patch(`/api/care-team/members/${id}`, { onCall }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/care-team/members/${id}`),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader
        title="My care team"
        subtitle="On-call unit — assignments fan out to on-call members"
        action={
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value=""
            onChange={(e) => e.target.value && add.mutate(Number(e.target.value))}
          >
            <option value="">+ Add member…</option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.displayName} {c.credential ? `(${c.credential})` : ""}
              </option>
            ))}
          </select>
        }
      />
      {!team?.members.length ? (
        <EmptyState message="No unit members yet." />
      ) : (
        <ul className="divide-y divide-border">
          {team.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-6 py-3">
              <span className="font-medium">{m.displayName}</span>
              {m.credential && (
                <span className="text-xs text-muted-foreground">
                  {m.credential}
                </span>
              )}
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={m.onCall}
                  onChange={(e) =>
                    toggle.mutate({ id: m.userId, onCall: e.target.checked })
                  }
                />
                On call
              </label>
              <Button
                variant="ghost"
                onClick={() => remove.mutate(m.userId)}
                className="h-7 px-2 text-destructive"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SuggestionsSection() {
  const qc = useQueryClient();
  const { data: suggestions = [] } = useQuery<Suggestion[]>({
    queryKey: ["/api/suggestions"],
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "accept" | "dismiss" }) =>
      api.post(`/api/suggestions/${id}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/suggestions"] });
      qc.invalidateQueries({ queryKey: ["/api/org/config"] });
    },
  });
  const pending = suggestions.filter((s) => s.status === "pending");

  return (
    <Card>
      <CardHeader title="Adaptive suggestions" subtitle="Proposals with evidence" />
      {pending.length === 0 ? (
        <EmptyState message="No suggestions right now." />
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-6 py-3">
              <div className="flex-1">
                <div className="text-sm font-semibold">
                  {s.key} → {JSON.stringify(s.proposedValue)}
                </div>
                <div className="text-xs text-muted-foreground">{s.evidence}</div>
              </div>
              <Button onClick={() => act.mutate({ id: s.id, action: "accept" })}>
                Accept
              </Button>
              <Button
                variant="secondary"
                onClick={() => act.mutate({ id: s.id, action: "dismiss" })}
              >
                Dismiss
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FeatureFlagsSection() {
  const qc = useQueryClient();
  const { data: flags = [] } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/feature-flags"],
  });
  const [name, setName] = useState("");
  const set = useMutation({
    mutationFn: ({ flag, enabled }: { flag: string; enabled: boolean }) =>
      api.patch("/api/feature-flags", { flag, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/feature-flags"] }),
  });

  return (
    <Card>
      <CardHeader
        title="Feature flags"
        action={
          <div className="flex gap-2">
            <Input
              className="max-w-[160px]"
              placeholder="flag_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              disabled={!name}
              onClick={() => {
                set.mutate({ flag: name, enabled: true });
                setName("");
              }}
            >
              Add
            </Button>
          </div>
        }
      />
      {flags.length === 0 ? (
        <EmptyState message="No flags." />
      ) : (
        <ul className="divide-y divide-border">
          {flags.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-6 py-3">
              <span className="font-mono text-sm">{f.flag}</span>
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={(e) =>
                    set.mutate({ flag: f.flag, enabled: e.target.checked })
                  }
                />
                Enabled
              </label>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium capitalize">{value ?? "—"}</dd>
    </div>
  );
}
