import { LegalPage, LegalSection } from '@/components/layouts/legal-page';

const SECTIONS = [
  { id: 'what-are-cookies', title: 'What Are Cookies' },
  { id: 'necessary', title: 'Strictly Necessary' },
  { id: 'functional', title: 'Functional Cookies' },
  { id: 'analytics', title: 'Analytics Cookies' },
  { id: 'manage', title: 'Managing Cookies' },
  { id: 'contact', title: 'Contact' },
];

export function Component() {
  return (
    <LegalPage
      title="Cookie Policy"
      subtitle="How PoolMaster uses cookies and similar technologies."
      lastUpdated="March 26, 2026"
      sections={SECTIONS}
    >
      <LegalSection id="what-are-cookies" title="What Are Cookies">
        <p>Cookies are small text files stored on your device when you visit a website. They help the site remember your preferences and improve your experience.</p>
      </LegalSection>

      <LegalSection id="necessary" title="Strictly Necessary Cookies">
        <p>These cookies are required for the platform to function. They cannot be disabled.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Cookie</th>
                <th className="px-4 py-2 text-left font-medium">Purpose</th>
                <th className="px-4 py-2 text-left font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="px-4 py-2">session_id</td><td className="px-4 py-2">Authentication</td><td className="px-4 py-2">Session</td></tr>
              <tr className="border-b"><td className="px-4 py-2">csrf_token</td><td className="px-4 py-2">Security (CSRF protection)</td><td className="px-4 py-2">Session</td></tr>
              <tr className="border-b"><td className="px-4 py-2">cookie_consent</td><td className="px-4 py-2">Stores your cookie preferences</td><td className="px-4 py-2">1 year</td></tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="functional" title="Functional Cookies">
        <p>These cookies remember your preferences to enhance your experience.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Cookie</th>
                <th className="px-4 py-2 text-left font-medium">Purpose</th>
                <th className="px-4 py-2 text-left font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="px-4 py-2">timezone</td><td className="px-4 py-2">Display times in your local zone</td><td className="px-4 py-2">1 year</td></tr>
              <tr className="border-b"><td className="px-4 py-2">theme</td><td className="px-4 py-2">Dark/light mode preference</td><td className="px-4 py-2">1 year</td></tr>
              <tr className="border-b"><td className="px-4 py-2">locale</td><td className="px-4 py-2">Language preference</td><td className="px-4 py-2">1 year</td></tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="analytics" title="Analytics Cookies">
        <p>These cookies help us understand how the platform is used so we can improve it. They are optional and require your consent.</p>
        <p>We use privacy-focused analytics that do not track individual users across sites. No personal data is shared with third parties for advertising.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Cookie</th>
                <th className="px-4 py-2 text-left font-medium">Purpose</th>
                <th className="px-4 py-2 text-left font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="px-4 py-2">_analytics</td><td className="px-4 py-2">Page views and feature usage</td><td className="px-4 py-2">1 year</td></tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="manage" title="Managing Cookies">
        <p>You can manage your cookie preferences at any time:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Click the cookie icon in the footer to open the cookie preferences dialog.</li>
          <li>Use your browser settings to block or delete cookies.</li>
          <li>Note: blocking necessary cookies may prevent the platform from functioning.</li>
        </ul>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>Questions about our cookie practices? Contact us at <strong>privacy@poolmaster.com</strong>.</p>
      </LegalSection>
    </LegalPage>
  );
}
