import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConsent, useUpdateConsent } from './hooks/use-consent';

export function CCPAToggle() {
  const { data: consent } = useConsent();
  const updateConsent = useUpdateConsent();

  // Only show for US locale users or those who have previously interacted
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  const isUSLocale = locale.startsWith('en-US');
  const hasInteracted = consent?.doNotSell === true;

  if (!isUSLocale && !hasInteracted) return null;
  if (!consent) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>California Consumer Privacy Act (CCPA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          If you are a California resident, you have the right to opt out of the sale of your
          personal information.{' '}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Learn More
          </a>
        </p>

        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">Do Not Sell My Personal Information</p>
          <Switch
            checked={consent.doNotSell}
            onCheckedChange={(checked) => updateConsent.mutate({ doNotSell: checked })}
            aria-label="Do Not Sell My Personal Information"
          />
        </div>

        {consent.doNotSell && (
          <p className="text-xs text-muted-foreground">
            Your preference has been recorded. We do not sell your personal information.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
