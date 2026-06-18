import { useState } from "react";
import { Activity } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Input } from "@/components/ui";

export function Login() {
  const { refresh } = useAuth();
  const [orgCode, setOrgCode] = useState("MERCY");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/login", { orgCode, username, password });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Invalid organization, username, or password.");
      } else if (err instanceof ApiError && err.status === 202) {
        setError("Two-factor authentication required (not yet wired in UI).");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity size={20} />
          </div>
          <div>
            <div className="text-xl font-bold">DocTurn</div>
            <div className="text-xs text-muted-foreground">
              Hospital coordination
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Organization code">
            <Input
              value={orgCode}
              onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              required
            />
          </Field>
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Demo: org <span className="font-mono">MERCY</span>, e.g.{" "}
          <span className="font-mono">director</span> /{" "}
          <span className="font-mono">docturn</span>
        </p>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
