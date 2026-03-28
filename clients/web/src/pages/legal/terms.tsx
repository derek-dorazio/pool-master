import { LegalPage, LegalSection } from '@/components/layouts/legal-page';

const SECTIONS = [
  { id: 'acceptance', title: 'Acceptance of Terms' },
  { id: 'eligibility', title: 'Eligibility' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'platform-use', title: 'Platform Use' },
  { id: 'no-real-money', title: 'No Real-Money Transactions' },
  { id: 'content', title: 'User Content' },
  { id: 'conduct', title: 'Prohibited Conduct' },
  { id: 'ip', title: 'Intellectual Property' },
  { id: 'termination', title: 'Termination' },
  { id: 'disclaimers', title: 'Disclaimers' },
  { id: 'liability', title: 'Limitation of Liability' },
  { id: 'changes', title: 'Changes to Terms' },
  { id: 'contact', title: 'Contact' },
];

export function Component() {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="The terms and conditions governing your use of the Ultimate Pool Manager platform."
      lastUpdated="March 26, 2026"
      sections={SECTIONS}
    >
      <LegalSection id="acceptance" title="1. Acceptance of Terms">
        <p>By accessing or using Ultimate Pool Manager, you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.</p>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility">
        <p>You must be at least 13 years old to create an Ultimate Pool Manager account. By registering, you represent that you meet this age requirement. Users under 18 may have restricted access to certain features.</p>
      </LegalSection>

      <LegalSection id="accounts" title="3. Accounts">
        <p>You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use. One account per person; sharing accounts is prohibited.</p>
      </LegalSection>

      <LegalSection id="platform-use" title="4. Platform Use">
        <p>Ultimate Pool Manager is a fantasy sports pool management platform. You may create and join leagues, participate in contests, draft participants, and track results. The platform is provided for entertainment and social purposes.</p>
      </LegalSection>

      <LegalSection id="no-real-money" title="5. No Real-Money Transactions">
        <p>Ultimate Pool Manager does not collect, hold, or distribute real money between users. Entry fees and prize pools displayed in the app are for tracking purposes only. Actual money exchanges between league members happen outside the platform (e.g., Venmo, PayPal, cash).</p>
        <p>Ultimate Pool Manager is not responsible for any financial disputes between league members.</p>
      </LegalSection>

      <LegalSection id="content" title="6. User Content">
        <p>You retain ownership of content you post (league feed posts, chat messages, etc.). By posting, you grant Ultimate Pool Manager a non-exclusive licence to display your content within the platform. You are responsible for the content you post.</p>
      </LegalSection>

      <LegalSection id="conduct" title="7. Prohibited Conduct">
        <ul className="list-disc pl-6 space-y-1">
          <li>Harassment, hate speech, or threatening behaviour.</li>
          <li>Impersonating other users or public figures.</li>
          <li>Attempting to manipulate scores, standings, or draft outcomes.</li>
          <li>Creating spam leagues or flooding feeds with unsolicited content.</li>
          <li>Accessing the platform if you are under the minimum age.</li>
          <li>Using automated tools to access the platform (bots, scrapers).</li>
        </ul>
        <p className="mt-2">Violations may result in warnings, temporary suspension, or permanent bans. See our enforcement policy for details.</p>
      </LegalSection>

      <LegalSection id="ip" title="8. Intellectual Property">
        <p>Ultimate Pool Manager and its original content, features, and functionality are owned by Ultimate Pool Manager and protected by copyright, trademark, and other intellectual property laws.</p>
      </LegalSection>

      <LegalSection id="termination" title="9. Termination">
        <p>We may suspend or terminate your account for violations of these terms. You may delete your account at any time through Settings &gt; Privacy &gt; Delete Account. A 14-day waiting period applies, during which you can cancel the deletion.</p>
      </LegalSection>

      <LegalSection id="disclaimers" title="10. Disclaimers">
        <p>Ultimate Pool Manager is provided "as is" without warranties of any kind. We do not guarantee the accuracy of sports data, scores, or standings. Real-world sports data is provided by third-party sources and may contain errors or delays.</p>
      </LegalSection>

      <LegalSection id="liability" title="11. Limitation of Liability">
        <p>To the maximum extent permitted by law, Ultimate Pool Manager shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the platform.</p>
      </LegalSection>

      <LegalSection id="changes" title="12. Changes to Terms">
        <p>We may update these terms from time to time. Material changes will be communicated via email or in-app notification at least 30 days before taking effect.</p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact">
        <p>Questions about these terms? Contact us at:</p>
        <p className="mt-2"><strong>Email:</strong> legal@poolmaster.com</p>
      </LegalSection>
    </LegalPage>
  );
}
