import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const CONSENT_KEY = 'poolmaster_cookie_consent';

type ConsentLevel = 'all' | 'necessary' | null;

export function CookieBanner() {
  const [consent, setConsent] = useState<ConsentLevel>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) {
      setVisible(true);
    } else {
      setConsent(stored as ConsentLevel);
    }
  }, []);

  function accept(level: ConsentLevel) {
    if (level) {
      localStorage.setItem(CONSENT_KEY, level);
      setConsent(level);
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4">
      <Card className="mx-auto max-w-2xl shadow-lg border">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p>
              We use cookies to keep you logged in and improve your experience.{' '}
              <a href="/cookie-policy" className="text-primary hover:underline">
                Learn more
              </a>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => accept('necessary')}
            >
              Necessary Only
            </Button>
            <Button size="sm" onClick={() => accept('all')}>
              Accept All
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
