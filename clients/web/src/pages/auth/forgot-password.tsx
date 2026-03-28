import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { api } from '@/lib/api-client';

const forgotSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
});

type ForgotForm = z.infer<typeof forgotSchema>;

export function Component() {
  const { t } = useTranslation('auth');
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(data: ForgotForm) {
    try {
      await api.post('/auth/forgot-password', { email: data.email });
    } catch {
      // Intentionally swallow — prevent enumeration
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">
              {t('forgotPassword.sentTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {t('forgotPassword.sentMessage')}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Logo size={48} />
          </div>
          <CardTitle className="text-2xl">
            {t('forgotPassword.title')}
          </CardTitle>
          <CardDescription>{t('forgotPassword.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('fields.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? '...' : t('forgotPassword.sendResetLink')}
            </Button>
          </form>

          <p className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-primary hover:underline"
            >
              {t('forgotPassword.backToLogin')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
