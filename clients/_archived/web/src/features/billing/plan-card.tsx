import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BillingPlan, BillingCycle, PlanTier } from './hooks/use-billing';

interface PlanCardProps {
  plan: BillingPlan;
  isCurrentPlan: boolean;
  isBillingEnabled: boolean;
  billingCycle: BillingCycle;
  onSelect?: (tier: PlanTier) => void;
}

const tierColors: Record<PlanTier, string> = {
  free: 'bg-gray-100 text-gray-700 border-gray-200',
  starter: 'bg-blue-100 text-blue-700 border-blue-200',
  pro: 'bg-purple-100 text-purple-700 border-purple-200',
  'league-plus': 'bg-amber-100 text-amber-700 border-amber-200',
};

const tierBorderColors: Record<PlanTier, string> = {
  free: 'border-gray-300',
  starter: 'border-blue-400',
  pro: 'border-purple-400',
  'league-plus': 'border-amber-400',
};

function formatPrice(price: number, cycle: BillingCycle): string {
  if (price === 0) return 'Free';
  return `$${price.toFixed(2)}/${cycle === 'monthly' ? 'mo' : 'yr'}`;
}

function featureValue(value: number | null): string {
  return value === null ? 'Unlimited' : String(value);
}

const featureRows: { key: keyof BillingPlan['features']; label: string }[] = [
  { key: 'leagues', label: 'Leagues' },
  { key: 'membersPerLeague', label: 'Members per league' },
  { key: 'contestsPerLeague', label: 'Contests per season' },
  { key: 'draftTypes', label: 'Draft types' },
  { key: 'scoringTemplates', label: 'Scoring templates' },
  { key: 'customScoring', label: 'Custom scoring' },
  { key: 'historyRetention', label: 'History depth' },
  { key: 'supportLevel', label: 'Support' },
];

export function PlanCard({
  plan,
  isCurrentPlan,
  isBillingEnabled,
  billingCycle,
  onSelect,
}: PlanCardProps) {
  const price = billingCycle === 'annual' ? plan.annualPrice : plan.price;

  function getCtaLabel(): string {
    if (!isBillingEnabled) return 'Coming Soon';
    if (isCurrentPlan) return 'Current Plan';
    return `Upgrade to ${plan.name}`;
  }

  function getCtaVariant(): 'default' | 'outline' | 'secondary' {
    if (isCurrentPlan || !isBillingEnabled) return 'secondary';
    return 'default';
  }

  return (
    <Card
      className={cn(
        'flex flex-col',
        isCurrentPlan && tierBorderColors[plan.tier],
        isCurrentPlan && 'border-2',
      )}
    >
      <CardHeader className="text-center">
        <div className="flex items-center justify-center gap-2">
          <CardTitle className="text-lg">{plan.name}</CardTitle>
          {isCurrentPlan && (
            <Badge
              className={tierColors[plan.tier]}
              aria-label={`Current plan: ${plan.name}`}
            >
              Current
            </Badge>
          )}
        </div>
        <p className="text-2xl font-bold">{formatPrice(price, billingCycle)}</p>
        {billingCycle === 'annual' && plan.price > 0 && (
          <p className="text-xs text-muted-foreground">
            Save 10% vs monthly
          </p>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-3 text-sm">
          {featureRows.map((row) => {
            const value = plan.features[row.key];
            const display =
              typeof value === 'boolean'
                ? value
                  ? '\u2713'
                  : '\u2717'
                : typeof value === 'number' || value === null
                  ? featureValue(value as number | null)
                  : value;
            const isCheck = typeof value === 'boolean';
            return (
              <li key={row.key} className="flex items-center justify-between">
                <span className="text-muted-foreground">{row.label}</span>
                <span
                  className={cn(
                    'font-medium',
                    isCheck && value && 'text-green-600',
                    isCheck && !value && 'text-muted-foreground',
                  )}
                >
                  {display}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          variant={getCtaVariant()}
          className="w-full"
          disabled={isCurrentPlan || !isBillingEnabled}
          onClick={() => onSelect?.(plan.tier)}
        >
          {getCtaLabel()}
        </Button>
      </CardFooter>
    </Card>
  );
}
