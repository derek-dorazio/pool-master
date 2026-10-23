/**
 * `npm run email:preview` (#844, #910): renders every system email with the example data in
 * tests/support/email-template-fixtures.ts into tmp/email-preview/<KEY>.html and .txt, so copy
 * can be checked without running a flow.
 *
 * - `-- --send` also sends each one to local Mailpit (http://localhost:8025) through SMTP.
 * - `-- --to you@example.com` sends each one to that address through the mail provider the
 *   environment configures (`EMAIL_PROVIDER`, `SES_*`, `AWS_*`; see readMailDeliveryConfig).
 *   The "Send email previews" workflow uses it to send through QA's SES.
 * - `-- --category RESULTS` keeps only that category's emails.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { EmailCategory } from '@poolmaster/shared/domain';
import {
  EMAIL_TEMPLATES,
  SmtpMailDeliveryProvider,
  createMailDeliveryProvider,
  readMailDeliveryConfig,
  renderSystemEmailTemplate,
  type MailDeliveryProvider,
  type SystemEmailTemplateKey,
} from '../packages/core-api/src/modules/email';
import { EMAIL_TEMPLATE_FIXTURES } from '../tests/support/email-template-fixtures';

const OUTPUT_DIR = path.resolve('tmp/email-preview');
const PREVIEW_TIME_ZONE = 'America/New_York';
const CATEGORIES = Object.values(EmailCategory);

interface PreviewTarget {
  transport: MailDeliveryProvider;
  fromAddress: string;
  to: string;
  label: string;
}

function parseCategory(value: string | undefined): EmailCategory | undefined {
  if (value === undefined || value === '' || value === 'ALL') return undefined;
  const category = CATEGORIES.find((candidate) => candidate === value);
  if (!category) {
    throw new Error(`Unknown --category ${value}. Use ALL or one of: ${CATEGORIES.join(', ')}`);
  }
  return category;
}

function previewTarget(options: { send: boolean; to: string | undefined }): PreviewTarget | undefined {
  if (options.to) {
    const config = readMailDeliveryConfig();
    return {
      transport: createMailDeliveryProvider(config),
      fromAddress: config.fromEmail,
      to: options.to,
      label: `${options.to} through ${config.provider}`,
    };
  }
  if (!options.send) return undefined;
  return {
    transport: new SmtpMailDeliveryProvider({
      provider: 'smtp',
      fromEmail: 'noreply@poolmaster.local',
      smtp: { host: 'localhost', port: 1025, secure: false },
    }),
    fromAddress: 'noreply@poolmaster.local',
    to: 'preview@poolmaster.local',
    label: 'Mailpit',
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      send: { type: 'boolean', default: false },
      to: { type: 'string' },
      category: { type: 'string' },
    },
  });
  const category = parseCategory(values.category);
  const target = previewTarget({ send: values.send, to: values.to?.trim() || undefined });
  const templateKeys = (Object.keys(EMAIL_TEMPLATES) as SystemEmailTemplateKey[])
    .filter((templateKey) => category === undefined || EMAIL_TEMPLATES[templateKey].category === category);
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const templateKey of templateKeys) {
    const message = renderSystemEmailTemplate(templateKey, EMAIL_TEMPLATE_FIXTURES[templateKey], {
      timeZone: PREVIEW_TIME_ZONE,
    });
    await writeFile(path.join(OUTPUT_DIR, `${templateKey}.html`), message.html);
    await writeFile(path.join(OUTPUT_DIR, `${templateKey}.txt`), `${message.subject}\n\n${message.text}\n`);
    await target?.transport.send({
      from: { name: 'Email preview', address: target.fromAddress },
      to: target.to,
      subject: `[${templateKey}] ${message.subject}`,
      text: message.text,
      html: message.html,
      metadata: { templateKey },
    });
    console.log(`${templateKey}: ${message.subject}`);
  }
  console.log(`Wrote ${String(templateKeys.length)} emails to ${OUTPUT_DIR}${target ? ` and sent each to ${target.label}` : ''}`);
}

void main();
