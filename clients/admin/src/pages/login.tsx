import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, LogIn } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/ui/logo';
import { useAdminAuthStore, type AdminUser } from '@/stores/admin-auth-store';
import { client, loginUser } from '@/lib/api';

export function Component() {
  const navigate = useNavigate();
  const { isAuthenticated, setAdminUser, setLoading } = useAdminAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSso() {
    setLoading(true);
    // Redirect to SSO endpoint; the callback will set the admin user
    window.location.href = '/api/v1/auth/sso/admin';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await loginUser({
        client,
        body: { email, password },
      });

      if (data?.tokens?.accessToken) {
        localStorage.setItem('admin_access_token', data.tokens.accessToken);
      }

      const adminUser: AdminUser = {
        id: data?.user?.id ?? '',
        email: data?.user?.email ?? email,
        name: data?.user?.displayName ?? email,
        role: 'Admin',
        permissions: [],
      };
      setAdminUser(adminUser);
      navigate('/');
    } catch {
      setError('Invalid email or password');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Logo size={48} />
          </div>
          <CardTitle className="text-2xl">Ultimate Pool Manager Admin</CardTitle>
          <CardDescription>Sign in to access the admin dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button className="w-full" size="lg" onClick={handleSso}>
            <KeyRound className="mr-2 h-4 w-4" />
            Sign in with SSO
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="admin@poolmaster.io"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" variant="secondary" className="w-full" disabled={submitting}>
              <LogIn className="mr-2 h-4 w-4" />
              {submitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
