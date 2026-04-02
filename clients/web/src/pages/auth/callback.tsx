import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

interface CallbackResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
  };
}

export function Component() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const [error, setError] = useState('');

  const code = searchParams.get('code');
  const state = searchParams.get('state');

  useEffect(() => {
    if (!code || !state) {
      navigate('/login', { replace: true });
      return;
    }

    async function handleCallback() {
      try {
        const res = await api.post<CallbackResponse>('/auth/callback', {
          code,
          state,
        });
        localStorage.setItem('access_token', res.tokens.accessToken);
        setUser(res.user);
        navigate('/dashboard', { replace: true });
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : t('callback.error'),
        );
      }
    }

    handleCallback();
  }, [code, state, navigate, setUser, t]);

  if (error) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-6 pt-6">
            <p className="text-sm text-destructive">{error}</p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">{t('callback.backToLogin')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">{t('callback.signingIn')}</p>
      </div>
    </div>
  );
}
