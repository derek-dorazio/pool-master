import { EmailMessageStatus, EmailSkipReason } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { emailSendResultText, emailSendResultToast } from './email-send-result';

describe('emailSendResultText', () => {
  it.each([
    [EmailMessageStatus.SENT, 'success', 'Sent. Check your inbox in a minute.'],
    [EmailMessageStatus.DELIVERED, 'success', 'Sent. Check your inbox in a minute.'],
    [EmailMessageStatus.SENDING, 'success', 'Being sent. Check your inbox in a minute.'],
    [EmailMessageStatus.QUEUED, 'success', 'Waiting to be sent. Check your inbox in a few minutes.'],
    [EmailMessageStatus.SKIPPED, 'warning', 'Not sent.'],
    [EmailMessageStatus.BOUNCED, 'danger', 'Not delivered: your mail server refused it.'],
    [EmailMessageStatus.COMPLAINED, 'warning', 'Delivered, but marked as spam.'],
    [EmailMessageStatus.FAILED, 'danger', 'Not sent.'],
  ] as const)('says a %s send with no provider error is %s: %s', (status, tone, text) => {
    expect(emailSendResultText({ status, skipReason: null })).toEqual({ tone, text });
  });

  it('says a queued send whose first try failed will be tried again, quoting the provider', () => {
    expect(emailSendResultText({ status: EmailMessageStatus.QUEUED, skipReason: null, error: 'Throttled' })).toEqual({
      tone: 'danger',
      text: 'The first try failed and it will be tried again. The email provider said: Throttled',
    });
  });

  it('quotes the provider on a failed send', () => {
    expect(emailSendResultText({ status: EmailMessageStatus.FAILED, skipReason: null, error: 'Bad address' }).text)
      .toBe('Not sent. The email provider said: Bad address');
  });

  it.each([
    [EmailSkipReason.EMAIL_DISABLED, 'Not sent: "Send system email" is off. Turn it on in Email settings first.'],
    [EmailSkipReason.TEMPLATE_DISABLED, 'Not sent: this email is switched off.'],
    [EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT, 'Not sent: the address is not in "Only send to", or is a reserved test domain.'],
    [EmailSkipReason.SUPPRESSED, 'Not sent: this address bounced or marked an email as spam before.'],
    [EmailSkipReason.OPTED_OUT, 'Not sent: the address\'s owner turned this kind of email off.'],
    [EmailSkipReason.NOT_IN_PLAN, 'Not sent: the league\'s plan doesn\'t include this email.'],
  ])('tells the admin what to do about a send skipped for %s', (skipReason, text) => {
    expect(emailSendResultText({ status: EmailMessageStatus.SKIPPED, skipReason })).toEqual({ tone: 'warning', text });
  });
});

describe('emailSendResultToast', () => {
  it('titles the toast by what was pressed and shows a warning as a plain toast', () => {
    expect(emailSendResultToast('Check delivery', { status: EmailMessageStatus.SKIPPED, skipReason: EmailSkipReason.TEMPLATE_DISABLED })).toEqual({
      title: 'Check delivery',
      description: 'Not sent: this email is switched off.',
      tone: 'default',
    });
  });
});
