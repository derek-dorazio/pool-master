import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { UsageMeter } from '@/features/billing/usage-meter';
import {
  useBillingEnabled,
  useBillingPlan,
  useBillingUsage,
  useBillingSubscription,
} from '@/features/billing/hooks/use-billing';
import type { PlanTier } from '@/features/billing/hooks/use-billing';

const tierBadgeColors: Record<PlanTier, string> = {
  free: 'bg-gray-100 text-gray-700',
  starter: 'bg-blue-100 text-blue-700',
  pro: 'bg-purple-100 text-purple-700',
  'league-plus': 'bg-amber-100 text-amber-700',
};

export function Component() {
  const { data: billingEnabled, isLoading: enabledLoading } = useBillingEnabled();
  const { data: plan, isLoading: planLoading } = useBillingPlan();
  const { data: usage, isLoading: usageLoading } = useBillingUsage();
  const { data: subscription } = useBillingSubscription();

  const isFree = !subscription || plan?.tier === 'free';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground">
          Your current plan, usage summary, and subscription details.
        </p>
      </div>

      {!enabledLoading && !billingEnabled && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-medium text-blue-900">
                Ultimate Pool Manager is currently free for all users.
              </p>
              <p className="text-sm text-blue-700">
                Paid plans coming soon!
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/billing/plans">View Plans</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Plan</CardTitle>
            <CardDescription>Your active subscription tier</CardDescription>
          </CardHeader>
          <CardContent>
            {planLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            ) : plan ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold">{plan.name} Plan</span>
                  <Badge
                    className={tierBadgeColors[plan.tier]}
                    aria-label={`Current plan: ${plan.name}`}
                  >
                    {plan.name}
                  </Badge>
                </div>
                {isFree ? (
                  <p className="text-sm text-muted-foreground">
                    All features included during the free period.
                  </p>
                ) : (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      ${subscription!.price.toFixed(2)}/{subscription!.cycle === 'monthly' ? 'mo' : 'yr'}
                    </p>
                    {subscription!.renewalDate && (
                      <p>Renews {subscription!.renewalDate}</p>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button variant={isFree ? 'default' : 'outline'} asChild>
              <Link to="/billing/plans">
                {isFree ? 'Upgrade' : 'Change Plan'}
              </Link>
            </Button>
          </CardFooter>
        </Card>

        {/* Payment Method Card — hidden when billing disabled or free */}
        {billingEnabled && !isFree && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Method</CardTitle>
              <CardDescription>Card on file for your subscription</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-14 items-center justify-center rounded border bg-muted text-xs font-mono">
                  VISA
                </div>
                <div>
                  <p className="font-medium">Visa ending in 4242</p>
                  <p className="text-sm text-muted-foreground">Expires 12/2027</p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline">Update</Button>
            </CardFooter>
          </Card>
        )}
      </div>

      {/* Usage Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Usage Summary</CardTitle>
          <CardDescription>
            {billingEnabled
              ? 'Resource usage against your plan limits'
              : 'Your current resource usage'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usageLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : usage ? (
            <div className="grid gap-6 md:grid-cols-3">
              <UsageMeter
                label="Leagues"
                current={usage.leagues.current}
                limit={billingEnabled ? usage.leagues.limit : null}
              />
              <UsageMeter
                label="Contests"
                current={usage.contests.current}
                limit={billingEnabled ? usage.contests.limit : null}
              />
              <UsageMeter
                label="Members"
                current={usage.members.current}
                limit={billingEnabled ? usage.members.limit : null}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Next Invoice Preview — hidden when free or billing disabled */}
      {billingEnabled && !isFree && subscription && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Next Invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  ${subscription.price.toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {subscription.renewalDate} &middot; {plan?.name} Plan
                </p>
              </div>
              <Button variant="link" asChild>
                <Link to="/billing/invoices">View invoice history</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
