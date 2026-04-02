import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthResponse } from '@poolmaster/shared/dto';

const TOTAL_STEPS = 5;

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getPasswordStrength(password: string): 'weak' | 'fair' | 'strong' {
  if (password.length < 8) return 'weak';
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  if (password.length >= 12 && score >= 3) return 'strong';
  if (password.length >= 8 && score >= 2) return 'fair';
  return 'weak';
}

const registerSchema = z
  .object({
    email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
    displayName: z.string().min(1, 'Display name is required'),
    dobMonth: z.string().min(1, 'Required'),
    dobDay: z.string().min(1, 'Required'),
    dobYear: z.string().min(1, 'Required'),
    agreeTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Terms of Service' }),
    }),
    agreePrivacy: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Privacy Policy' }),
    }),
    plan: z.string().default('free'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

const stepFields: Record<number, (keyof RegisterForm)[]> = {
  1: ['email', 'password', 'confirmPassword'],
  2: ['displayName'],
  3: ['dobMonth', 'dobDay', 'dobYear'],
  4: ['agreeTerms', 'agreePrivacy'],
  5: ['plan'],
};

export function Component() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState('');
  const [ageError, setAgeError] = useState('');

  const methods = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      displayName: '',
      dobMonth: '',
      dobDay: '',
      dobYear: '',
      agreeTerms: false as unknown as true,
      agreePrivacy: false as unknown as true,
      plan: 'free',
    },
    mode: 'onTouched',
  });

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = methods;

  const password = watch('password');
  const displayName = watch('displayName');
  const agreeTerms = watch('agreeTerms');
  const agreePrivacy = watch('agreePrivacy');

  const strength = useMemo(
    () => (password ? getPasswordStrength(password) : null),
    [password],
  );

  const initials = useMemo(() => {
    if (!displayName) return '?';
    return displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [displayName]);

  function validateAge(): boolean {
    const m = watch('dobMonth');
    const d = watch('dobDay');
    const y = watch('dobYear');
    if (!m || !d || !y) return false;
    const dob = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    if (age < 13) {
      setAgeError(t('errors.mustBe13'));
      return false;
    }
    setAgeError('');
    return true;
  }

  async function handleNext() {
    const fields = stepFields[step];
    const valid = await trigger(fields);
    if (!valid) return;

    if (step === 3) {
      if (!validateAge()) return;
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  async function onSubmit(data: RegisterForm) {
    setServerError('');
    try {
      const res = await api.post<AuthResponse>('/v1/auth/register', {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        dateOfBirth: `${data.dobYear}-${data.dobMonth.padStart(2, '0')}-${data.dobDay.padStart(2, '0')}`,
        plan: data.plan,
      });
      localStorage.setItem('access_token', res.tokens.accessToken);
      setUser({ ...res.user, avatarUrl: res.user.avatarUrl ?? undefined });
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    }
  }

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => currentYear - i);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Logo size={48} />
          </div>
          <CardTitle className="text-2xl">{t('register.title')}</CardTitle>
          <CardDescription>
            {t('register.stepOf', { current: step, total: TOTAL_STEPS })}
          </CardDescription>
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 pt-4">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i + 1 <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <FormProvider {...methods}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {serverError && (
                <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {serverError}
                </div>
              )}

              {/* Step 1: Account */}
              {step === 1 && (
                <>
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

                  <div className="space-y-2">
                    <Label htmlFor="password">{t('fields.password')}</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Create a password"
                        {...register('password')}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-sm text-destructive">
                        {errors.password.message}
                      </p>
                    )}
                    {strength && (
                      <div className="flex items-center gap-2">
                        <div className="flex flex-1 gap-1">
                          <div
                            className={`h-1.5 flex-1 rounded-full ${
                              strength === 'weak'
                                ? 'bg-destructive'
                                : strength === 'fair'
                                  ? 'bg-yellow-500'
                                  : 'bg-green-500'
                            }`}
                          />
                          <div
                            className={`h-1.5 flex-1 rounded-full ${
                              strength === 'fair'
                                ? 'bg-yellow-500'
                                : strength === 'strong'
                                  ? 'bg-green-500'
                                  : 'bg-muted'
                            }`}
                          />
                          <div
                            className={`h-1.5 flex-1 rounded-full ${
                              strength === 'strong'
                                ? 'bg-green-500'
                                : 'bg-muted'
                            }`}
                          />
                        </div>
                        <span
                          className={`text-xs ${
                            strength === 'weak'
                              ? 'text-destructive'
                              : strength === 'fair'
                                ? 'text-yellow-600'
                                : 'text-green-600'
                          }`}
                        >
                          {t(`passwordStrength.${strength}`)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      {t('fields.confirmPassword')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showConfirm ? 'text' : 'password'}
                        placeholder="Confirm your password"
                        {...register('confirmPassword')}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowConfirm(!showConfirm)}
                        tabIndex={-1}
                      >
                        {showConfirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <p className="text-sm text-destructive">
                        {errors.confirmPassword.message}
                      </p>
                    )}
                  </div>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <Separator />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        {t('register.orSignUpWith')}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      className="w-full"
                      type="button"
                    >
                      {t('social.continueWithGoogle')}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      type="button"
                    >
                      {t('social.continueWithApple')}
                    </Button>
                  </div>
                </>
              )}

              {/* Step 2: Profile */}
              {step === 2 && (
                <>
                  <div className="flex justify-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                      {initials}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="displayName">
                      {t('fields.displayName')}
                    </Label>
                    <Input
                      id="displayName"
                      placeholder="How should we call you?"
                      {...register('displayName')}
                    />
                    {errors.displayName && (
                      <p className="text-sm text-destructive">
                        {errors.displayName.message}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Step 3: Age Verification */}
              {step === 3 && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('fields.dateOfBirth')}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="dobMonth">{t('fields.month')}</Label>
                      <select
                        id="dobMonth"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...register('dobMonth')}
                      >
                        <option value="">--</option>
                        {months.map((m, i) => (
                          <option key={m} value={String(i + 1)}>
                            {m}
                          </option>
                        ))}
                      </select>
                      {errors.dobMonth && (
                        <p className="text-sm text-destructive">
                          {errors.dobMonth.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dobDay">{t('fields.day')}</Label>
                      <select
                        id="dobDay"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...register('dobDay')}
                      >
                        <option value="">--</option>
                        {days.map((d) => (
                          <option key={d} value={String(d)}>
                            {d}
                          </option>
                        ))}
                      </select>
                      {errors.dobDay && (
                        <p className="text-sm text-destructive">
                          {errors.dobDay.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dobYear">{t('fields.year')}</Label>
                      <select
                        id="dobYear"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...register('dobYear')}
                      >
                        <option value="">--</option>
                        {years.map((y) => (
                          <option key={y} value={String(y)}>
                            {y}
                          </option>
                        ))}
                      </select>
                      {errors.dobYear && (
                        <p className="text-sm text-destructive">
                          {errors.dobYear.message}
                        </p>
                      )}
                    </div>
                  </div>
                  {ageError && (
                    <p className="text-sm text-destructive">{ageError}</p>
                  )}
                </>
              )}

              {/* Step 4: Terms */}
              {step === 4 && (
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="agreeTerms"
                      checked={agreeTerms === true}
                      onCheckedChange={(checked) =>
                        setValue('agreeTerms', checked === true ? true : (false as unknown as true), {
                          shouldValidate: true,
                        })
                      }
                    />
                    <Label htmlFor="agreeTerms" className="text-sm font-normal leading-relaxed">
                      {t('terms.agreeTerms')}{' '}
                      <Link to="/terms" className="text-primary hover:underline">
                        {t('terms.termsOfService')}
                      </Link>
                    </Label>
                  </div>
                  {errors.agreeTerms && (
                    <p className="text-sm text-destructive">
                      {errors.agreeTerms.message}
                    </p>
                  )}

                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="agreePrivacy"
                      checked={agreePrivacy === true}
                      onCheckedChange={(checked) =>
                        setValue('agreePrivacy', checked === true ? true : (false as unknown as true), {
                          shouldValidate: true,
                        })
                      }
                    />
                    <Label htmlFor="agreePrivacy" className="text-sm font-normal leading-relaxed">
                      {t('terms.agreePrivacy')}{' '}
                      <Link to="/privacy" className="text-primary hover:underline">
                        {t('terms.privacyPolicy')}
                      </Link>
                    </Label>
                  </div>
                  {errors.agreePrivacy && (
                    <p className="text-sm text-destructive">
                      {errors.agreePrivacy.message}
                    </p>
                  )}
                </div>
              )}

              {/* Step 5: Plan */}
              {step === 5 && (
                <div className="space-y-4">
                  {/* Free tier */}
                  <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{t('plans.free')}</h3>
                      <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                        {t('plans.selected')}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-2">
                      <li className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary" />
                        {t('plans.freeFeatures.unlimitedLeagues')}
                      </li>
                      <li className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary" />
                        {t('plans.freeFeatures.membersPerLeague')}
                      </li>
                      <li className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary" />
                        {t('plans.freeFeatures.allSports')}
                      </li>
                    </ul>
                  </div>

                  {/* Pro tier — Coming Soon */}
                  <div className="rounded-lg border p-4 opacity-50">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{t('plans.pro')}</h3>
                      <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-medium text-muted-foreground">
                        {t('plans.comingSoon')}
                      </span>
                    </div>
                  </div>

                  {/* League+ tier — Coming Soon */}
                  <div className="rounded-lg border p-4 opacity-50">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{t('plans.leaguePlus')}</h3>
                      <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-medium text-muted-foreground">
                        {t('plans.comingSoon')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex gap-3 pt-2">
                {step > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={handleBack}
                  >
                    {t('common:buttons.back')}
                  </Button>
                )}
                {step < TOTAL_STEPS ? (
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={handleNext}
                  >
                    {t('common:buttons.next')}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? '...' : t('register.createAccount')}
                  </Button>
                )}
              </div>
            </form>
          </FormProvider>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('register.haveAccount')}{' '}
            <Link to="/login" className="text-primary hover:underline">
              {t('register.logIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
