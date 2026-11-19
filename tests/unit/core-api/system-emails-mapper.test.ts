import {
  SystemEmailDtoSchema,
  SystemEmailLatestSendResponseSchema,
  SystemEmailResendResponseSchema,
} from '@poolmaster/shared/dto';
import { EmailMessageStatus, type EmailMessage } from '@poolmaster/shared/domain';
import {
  maskEmailAddress,
  toSystemEmailDto,
  toSystemEmailLatestSendDto,
  toSystemEmailResendDto,
} from '../../../packages/core-api/src/mappers/system-emails.mapper';

const SENT_AT = new Date('2026-11-17T15:30:00.000Z');

describe('system emails mapper', () => {
  it('maps an email with sends to its DTO, dates as ISO strings and the count as sentLast30Days', () => {
    const dto = toSystemEmailDto({
      templateKey: 'CONTEST_STANDINGS',
      planFeature: 'EMAIL_CONTEST_STANDINGS',
      planStartsAt: 'PRO',
      status: 'ON',
      sentCount: 12,
      lastSentAt: SENT_AT,
      previewSentAt: SENT_AT,
    });

    expect(SystemEmailDtoSchema.parse(dto)).toEqual({
      templateKey: 'CONTEST_STANDINGS',
      planFeature: 'EMAIL_CONTEST_STANDINGS',
      planStartsAt: 'PRO',
      status: 'ON',
      sentLast30Days: 12,
      lastSentAt: '2026-11-17T15:30:00.000Z',
      previewSentAt: '2026-11-17T15:30:00.000Z',
    });
  });

  it('maps an email never sent with null dates', () => {
    const dto = toSystemEmailDto({ templateKey: 'PASSWORD_RESET', planFeature: null, planStartsAt: null, status: 'ALWAYS_ON', sentCount: 0 });

    expect(dto).toMatchObject({ sentLast30Days: 0, lastSentAt: null, previewSentAt: null });
  });

  it('maps the latest send with its HTML as sent and its recipient masked', () => {
    const dto = toSystemEmailLatestSendDto({
      id: 'sent-1',
      templateKey: 'CONTEST_RESULTS',
      recipientEmail: 'derek@example.com',
      fromName: 'Office League',
      fromAddress: 'office24@qa.example.com',
      subject: 'Final results',
      textBody: 'You won.',
      htmlBody: '<html><body>You won.</body></html>',
      sentAt: SENT_AT,
    });

    expect(SystemEmailLatestSendResponseSchema.parse(dto)).toEqual({
      templateKey: 'CONTEST_RESULTS',
      subject: 'Final results',
      htmlBody: '<html><body>You won.</body></html>',
      sentAt: '2026-11-17T15:30:00.000Z',
      recipient: 'd•••@example.com',
    });
  });

  it('maps where a copy stands, with a null skip reason when it was queued', () => {
    const queued = { status: EmailMessageStatus.QUEUED } as Pick<EmailMessage, 'status' | 'skipReason'>;
    const skipped = { status: EmailMessageStatus.SKIPPED, skipReason: 'TEMPLATE_DISABLED' } as Pick<EmailMessage, 'status' | 'skipReason'>;

    expect(SystemEmailResendResponseSchema.parse(toSystemEmailResendDto(queued as EmailMessage))).toEqual({ status: 'QUEUED', skipReason: null });
    expect(toSystemEmailResendDto(skipped as EmailMessage)).toEqual({ status: 'SKIPPED', skipReason: 'TEMPLATE_DISABLED' });
  });

  it.each([
    ['member@gmail.com', 'm•••@gmail.com'],
    ['a@b.co', 'a•••@b.co'],
    ['odd"local@part"@example.com', 'o•••@example.com'],
    ['no-at-sign', '•••'],
    ['@example.com', '•••'],
  ])('masks %s as %s', (address, masked) => {
    expect(maskEmailAddress(address)).toBe(masked);
  });
});
