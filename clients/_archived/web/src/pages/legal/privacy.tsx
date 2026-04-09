import { LegalPage, LegalSection } from '@/components/layouts/legal-page';

const SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'data-collected', title: 'Data We Collect' },
  { id: 'how-we-use', title: 'How We Use Your Data' },
  { id: 'sharing', title: 'Data Sharing' },
  { id: 'storage', title: 'Data Storage & Security' },
  { id: 'retention', title: 'Data Retention' },
  { id: 'your-rights', title: 'Your Rights' },
  { id: 'children', title: 'Children\'s Privacy' },
  { id: 'cookies', title: 'Cookies' },
  { id: 'changes', title: 'Changes to This Policy' },
  { id: 'contact', title: 'Contact Us' },
];

export function Component() {
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="How Ultimate Pool Manager collects, uses, and protects your personal information."
      lastUpdated="March 26, 2026"
      sections={SECTIONS}
    >
      <LegalSection id="overview" title="Overview">
        <p>Ultimate Pool Manager ("we", "us", "our") operates a tournament pool management platform. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and related services.</p>
        <p>By using Ultimate Pool Manager, you agree to the collection and use of information in accordance with this policy.</p>
      </LegalSection>

      <LegalSection id="data-collected" title="Data We Collect">
        <h3 className="text-lg font-medium mt-4 mb-2">Information You Provide</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Account information:</strong> Email address, display name, and birth year (for age verification).</li>
          <li><strong>Profile data:</strong> Timezone, language preferences, and optional profile photo.</li>
          <li><strong>Content you create:</strong> League posts, chat messages, draft picks, and contest entries.</li>
        </ul>

        <h3 className="text-lg font-medium mt-4 mb-2">Information Collected Automatically</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Usage data:</strong> Pages visited, features used, time spent in the app.</li>
          <li><strong>Device information:</strong> Device type, operating system, browser type, and site version.</li>
          <li><strong>IP address:</strong> Used for security and approximate geographic location.</li>
        </ul>
      </LegalSection>

      <LegalSection id="how-we-use" title="How We Use Your Data">
        <ul className="list-disc pl-6 space-y-1">
          <li>To provide and maintain the Ultimate Pool Manager platform.</li>
          <li>To manage your account and league memberships.</li>
          <li>To process draft picks, scoring, and contest results.</li>
          <li>To send notifications about contests, drafts, and league activity.</li>
          <li>To improve the platform based on usage patterns.</li>
          <li>To enforce our Terms of Service and prevent abuse.</li>
        </ul>
      </LegalSection>

      <LegalSection id="sharing" title="Data Sharing">
        <p>We do not sell your personal information. We may share data with:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Other league members:</strong> Your display name, contest results, and league activity are visible to members of leagues you join.</li>
          <li><strong>Service providers:</strong> Hosting, email delivery, and analytics providers who process data on our behalf.</li>
          <li><strong>Legal obligations:</strong> When required by law, court order, or government request.</li>
        </ul>
        <p>Your email address is never shared with other league members.</p>
      </LegalSection>

      <LegalSection id="storage" title="Data Storage & Security">
        <p>Your data is stored on encrypted servers (AES-256 at rest, TLS 1.2+ in transit). We implement industry-standard security measures including access controls, audit logging, and regular security reviews.</p>
      </LegalSection>

      <LegalSection id="retention" title="Data Retention">
        <p>We retain your data for as long as your account is active. After account deletion:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Personal data (email, name, photo) is deleted immediately.</li>
          <li>Contest results and standings are anonymised ("Deleted User") to preserve league history.</li>
          <li>Notification and session logs are deleted within 90 days.</li>
          <li>Consent and audit records are retained for 7 years (legal requirement).</li>
        </ul>
      </LegalSection>

      <LegalSection id="your-rights" title="Your Rights">
        <p>Depending on your location, you may have the following rights:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Access:</strong> Request a copy of all your personal data (Settings &gt; Privacy &gt; Export Data).</li>
          <li><strong>Rectification:</strong> Update your profile information at any time.</li>
          <li><strong>Erasure:</strong> Request account deletion (Settings &gt; Privacy &gt; Delete Account). A 14-day waiting period applies.</li>
          <li><strong>Portability:</strong> Export your data in JSON format.</li>
          <li><strong>Object:</strong> Opt out of marketing communications and analytics.</li>
        </ul>
        <p>California residents: see our "Do Not Sell My Personal Information" notice. We do not sell personal data.</p>
      </LegalSection>

      <LegalSection id="children" title="Children's Privacy">
        <p>Ultimate Pool Manager requires users to be at least 13 years old (COPPA compliance). We do not knowingly collect data from children under 13. If we discover we have collected data from a child under 13, we will delete it immediately.</p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies">
        <p>We use essential cookies for authentication and security. Analytics cookies are optional and require your consent. See our <a href="/cookie-policy" className="text-primary hover:underline">Cookie Policy</a> for details.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to This Policy">
        <p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or in-app notification. Continued use of the platform after changes constitutes acceptance.</p>
      </LegalSection>

      <LegalSection id="contact" title="Contact Us">
        <p>For privacy questions or data requests, contact us at:</p>
        <p className="mt-2"><strong>Email:</strong> privacy@poolmaster.com</p>
      </LegalSection>
    </LegalPage>
  );
}
