/**
 * `npm run email:preview` (#844): renders every system email with the example data in
 * tests/support/email-template-fixtures.ts into tmp/email-preview/<KEY>.html and .txt, so copy
 * can be checked without running a flow. `-- --send` also sends each one to local Mailpit
 * (http://localhost:8025) through the SMTP transport.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EMAIL_TEMPLATES,
  SmtpMailDeliveryProvider,
  renderSystemEmailTemplate,
  type SystemEmailTemplateKey,
} from '../packages/core-api/src/modules/email';
import { EMAIL_TEMPLATE_FIXTURES } from '../tests/support/email-template-fixtures';

const OUTPUT_DIR = path.resolve('tmp/email-preview');
const PREVIEW_TIME_ZONE = 'America/New_York';

async function main(): Promise<void> {
  const send = process.argv.includes('--send');
  const mailpit = send
    ? new SmtpMailDeliveryProvider({
        provider: 'smtp',
        fromEmail: 'noreply@poolmaster.local',
        smtp: { host: 'localhost', port: 1025, secure: false },
      })
    : undefined;
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const templateKey of Object.keys(EMAIL_TEMPLATES) as SystemEmailTemplateKey[]) {
    const message = renderSystemEmailTemplate(templateKey, EMAIL_TEMPLATE_FIXTURES[templateKey], {
      timeZone: PREVIEW_TIME_ZONE,
    });
    await writeFile(path.join(OUTPUT_DIR, `${templateKey}.html`), message.html);
    await writeFile(path.join(OUTPUT_DIR, `${templateKey}.txt`), `${message.subject}\n\n${message.text}\n`);
    await mailpit?.send({
      from: { name: 'Email preview', address: 'noreply@poolmaster.local' },
      to: 'preview@poolmaster.local',
      subject: `[${templateKey}] ${message.subject}`,
      text: message.text,
      html: message.html,
      metadata: { templateKey },
    });
    console.log(`${templateKey}: ${message.subject}`);
  }
  console.log(`Wrote ${OUTPUT_DIR}${send ? ' and sent each email to Mailpit' : ''}`);
}

void main();
