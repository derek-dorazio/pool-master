import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanCard } from '@/features/billing/plan-card';
import {
  useBillingEnabled,
  useBillingPlan,
  usePlanTiers,
} from '@/features/billing/hooks/use-billing';
import type { BillingCycle } from '@/features/billing/hooks/use-billing';
import { cn } from '@/lib/utils';

const faqItems = [
  {
    question: 'What happens when I upgrade?',
    answer:
      'Your new plan takes effect immediately. You will be charged a prorated amount for the remainder of your current billing cycle, and your next invoice will reflect the new plan price.',
  },
  {
    question: 'Can I downgrade my plan?',
    answer:
      'Yes, you can downgrade at any time. The downgrade takes effect at the end of your current billing period. Features above your new plan limits will become read-only.',
  },
  {
    question: 'How does the free trial work?',
    answer:
      'New users start on the Free plan with access to core features. When paid plans launch, you can try any plan with a 14-day free trial. No credit card required to start.',
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Yes, cancellation takes effect at the end of your current billing period. You keep full access until then. No partial refunds are issued.',
  },
];

export function Component() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [expandedFaq, setExpandedFaq] = useState<Set<number>>(new Set());
  const { data: billingEnabled } = useBillingEnabled();
  const { data: currentPlan, isLoading: planLoading } = useBillingPlan();
  const { data: plans, isLoading: plansLoading } = usePlanTiers();

  function toggleFaq(index: number) {
    setExpandedFaq((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Choose Your Plan</h1>
        <p className="text-muted-foreground">
          Compare available plans and select the one that fits your needs.
        </p>
      </div>

      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant={billingCycle === 'monthly' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBillingCycle('monthly')}
        >
          Monthly
        </Button>
        <Button
          variant={billingCycle === 'annual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBillingCycle('annual')}
        >
          Annual
          <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Save 10%
          </span>
        </Button>
      </div>

      {/* Plan Cards Grid */}
      {plansLoading || planLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="flex flex-col">
              <CardHeader className="text-center">
                <Skeleton className="mx-auto h-6 w-24" />
                <Skeleton className="mx-auto mt-2 h-8 w-20" />
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : plans ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrentPlan={currentPlan?.tier === plan.tier}
              isBillingEnabled={billingEnabled ?? false}
              billingCycle={billingCycle}
            />
          ))}
        </div>
      ) : null}

      {/* FAQ Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Frequently Asked Questions</CardTitle>
          <CardDescription>Common questions about billing and plans</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {faqItems.map((item, index) => (
            <div key={index} className="rounded-lg border">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
                onClick={() => toggleFaq(index)}
                aria-expanded={expandedFaq.has(index)}
              >
                {item.question}
                <span
                  className={cn(
                    'text-muted-foreground transition-transform',
                    expandedFaq.has(index) && 'rotate-180',
                  )}
                >
                  &#9662;
                </span>
              </button>
              {expandedFaq.has(index) && (
                <div className="border-t px-4 py-3 text-sm text-muted-foreground">
                  {item.answer}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
