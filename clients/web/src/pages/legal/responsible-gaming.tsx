import { LegalPage, LegalSection } from '@/components/layouts/legal-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SECTIONS = [
  { id: 'commitment', title: 'Our Commitment' },
  { id: 'self-exclusion', title: 'Self-Exclusion' },
  { id: 'activity-limits', title: 'Activity Limits' },
  { id: 'session-reminders', title: 'Session Reminders' },
  { id: 'resources', title: 'Support Resources' },
  { id: 'age-policy', title: 'Age Policy' },
];

export function Component() {
  return (
    <LegalPage
      title="Responsible Gaming"
      subtitle="Information and resources for responsible gaming. Set limits, take breaks, and find support."
      lastUpdated="March 26, 2026"
      sections={SECTIONS}
    >
      <LegalSection id="commitment" title="Our Commitment">
        <p>Ultimate Pool Manager is committed to providing a safe, fun, and responsible gaming environment. While Ultimate Pool Manager does not handle real-money transactions between users, we recognise that fantasy sports engagement should be balanced and healthy.</p>
        <p>We provide tools to help you manage your activity and take breaks when needed.</p>
      </LegalSection>

      <LegalSection id="self-exclusion" title="Self-Exclusion">
        <p>If you need a break from Ultimate Pool Manager, you can use our self-exclusion tools:</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cool-Down Period</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>Take a temporary break for 24 hours, 7 days, or 30 days. During this time you can view standings but cannot draft, join contests, or create new contests. Auto-reactivates when the period ends.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Self-Exclusion</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>For a longer break: 6 months, 1 year, or indefinite. Read-only access to existing contests. To reactivate, you must contact support and wait a 7-day cooling-off period.</p>
            </CardContent>
          </Card>
        </div>

        <p className="mt-4">To activate self-exclusion, go to <strong>Settings &gt; Privacy &gt; Self-Exclusion</strong>.</p>
      </LegalSection>

      <LegalSection id="activity-limits" title="Activity Limits">
        <p>You can set personal activity limits in your account settings:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Weekly contest limit:</strong> Get an alert when you join more than your set number of contests per week.</li>
          <li><strong>These are informational alerts</strong> — they remind you of your own goals but don't block you.</li>
        </ul>
      </LegalSection>

      <LegalSection id="session-reminders" title="Session Reminders">
        <p>Enable session time reminders to be notified after spending a set amount of time in the app (e.g., 60 minutes). This helps maintain a healthy balance.</p>
        <p>Configure in <strong>Settings &gt; Privacy &gt; Session Reminders</strong>.</p>
      </LegalSection>

      <LegalSection id="resources" title="Support Resources">
        <p>If you or someone you know has a problem with gambling, these organisations can help:</p>

        <div className="mt-4 space-y-3">
          <Card>
            <CardContent className="flex items-center gap-4 py-4">
              <div>
                <p className="font-medium">National Council on Problem Gambling</p>
                <p className="text-sm text-muted-foreground">Call/Text: 1-800-522-4700 (24/7)</p>
                <p className="text-sm text-muted-foreground">Chat: ncpgambling.org/chat</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 py-4">
              <div>
                <p className="font-medium">Gamblers Anonymous</p>
                <p className="text-sm text-muted-foreground">gamblersanonymous.org</p>
                <p className="text-sm text-muted-foreground">Find local meetings and support groups</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 py-4">
              <div>
                <p className="font-medium">SAMHSA National Helpline</p>
                <p className="text-sm text-muted-foreground">1-800-662-4357 (free, confidential, 24/7)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </LegalSection>

      <LegalSection id="age-policy" title="Age Policy">
        <p>Ultimate Pool Manager requires all users to be at least 13 years old. Age is verified at registration via date of birth. Users under 13 cannot create accounts.</p>
      </LegalSection>
    </LegalPage>
  );
}
