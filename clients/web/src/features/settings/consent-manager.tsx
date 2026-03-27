import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsent, useUpdateConsent } from './hooks/use-consent';

const consentOptions = [
  {
    key: 'marketingEmails' as const,
    label: 'Marketing emails',
    description: 'Receive promotional emails about new features and contests',
  },
  {
    key: 'analytics' as const,
    label: 'Analytics',
    description: 'Allow anonymized usage data collection to improve the product',
  },
  {
    key: 'thirdPartyIntegrations' as const,
    label: 'Third-party integrations',
    description: 'Share data with connected third-party services',
  },
];

export function ConsentManager() {
  const { data: consent, isLoading } = useConsent();
  const updateConsent = useUpdateConsent();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Consent Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-6 w-11" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!consent) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent Preferences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {consentOptions.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <Switch
              checked={consent[key]}
              onCheckedChange={(checked) => updateConsent.mutate({ [key]: checked })}
              aria-label={label}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
