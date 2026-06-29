import { useState } from 'react';
import { useLocation } from 'wouter';
import { Stethoscope } from 'lucide-react';
import { useLogin } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

export function LoginPage() {
  const [, navigate] = useLocation();
  const login = useLogin();
  const [orgCode, setOrgCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username, password });
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid username or password.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to sign in. Please try again.');
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#2563EB] text-white">
            <Stethoscope className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Doc<span className="text-[#2563EB]">Turn</span>
          </h1>
          <p className="text-sm text-slate-500">Sign in to your hospital workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="orgCode">Organization code</Label>
            <Input
              id="orgCode"
              value={orgCode}
              onChange={(e) => setOrgCode(e.target.value)}
              placeholder="e.g. MERCY-GEN"
              autoComplete="organization"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={login.isPending}
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
