import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Trophy,
  Zap,
  Users,
  Smartphone,
  Settings,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth-store';

const features = [
  {
    icon: Trophy,
    title: 'Run Any Pool Type',
    description: 'Snake drafts, pick\'em, brackets, survivor, and more',
  },
  {
    icon: Zap,
    title: 'Live Scoring',
    description: 'Real-time scoring from official data providers',
  },
  {
    icon: Users,
    title: 'Invite Friends',
    description: 'Share a link and get your league going in minutes',
  },
  {
    icon: Smartphone,
    title: 'Mobile Ready',
    description: 'Full experience on any device, anywhere',
  },
  {
    icon: Settings,
    title: 'Commissioner Tools',
    description: 'Full control over rules, scoring, and league management',
  },
  {
    icon: BarChart3,
    title: 'League History',
    description: 'Track records, rivalries, and season-by-season stats',
  },
];

const sports = [
  'NFL',
  'NBA',
  'NCAA',
  'Golf',
  'F1',
  'Tennis',
  'Soccer',
  'NASCAR',
  'Horse Racing',
];

const stats = [
  { label: '10,000+ pools created' },
  { label: '9 sports supported' },
  { label: 'Free to start' },
];

export function Component() {
  useTranslation('common');
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background px-4 pb-20 pt-24 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 data-testid="hero-heading" className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Run Your Pool{' '}
            <span className="text-primary">Like a Pro</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            The all-in-one platform for sports pools, brackets, and fantasy
            competitions.
          </p>
          <div className="mt-10">
            <Button asChild size="lg" className="text-base px-8 py-6">
              <Link to="/register" data-testid="hero-cta">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 data-testid="features-heading" className="mb-12 text-center text-3xl font-bold tracking-tight">
            Everything you need to run your pool
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="transition-shadow hover:shadow-md">
                <CardContent className="flex flex-col items-start gap-3 p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Sport Carousel */}
      <section className="border-y bg-muted/50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-xl font-semibold text-muted-foreground">
            Supported Sports
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {sports.map((sport) => (
              <span
                key={sport}
                className="inline-flex items-center rounded-full border bg-background px-4 py-1.5 text-sm font-medium text-foreground shadow-sm"
              >
                {sport}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col items-center justify-center gap-8 sm:flex-row sm:gap-16">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className="flex items-center gap-8"
              >
                {i > 0 && (
                  <div className="hidden h-8 w-px bg-border sm:block" />
                )}
                <p className="text-center text-lg font-semibold text-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Secondary CTA */}
      <section className="bg-primary/5 px-4 py-20 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Ready to start your pool?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Create your first league in minutes. No credit card required.
          </p>
          <div className="mt-8">
            <Button asChild size="lg" className="text-base px-8">
              <Link to="/register">Sign Up</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
