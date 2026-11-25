import { describe, expect, it } from 'vitest';
import type { EmailConfig } from '@/lib/api';
import { summarizeEmail } from './root-admin-settings-utils';

const templates = {} as EmailConfig['templates'];

function valueOf(config: Partial<EmailConfig>, id: string): string | undefined {
  return summarizeEmail({
    enabled: true,
    allowedRecipients: [],
    sendRatePerSecond: 10,
    entryReminderHours: [24],
    standingsBufferMinutes: 30,
    weeklyDigestHour: 3,
    templates,
    ...config,
  }).find((item) => item.id === id)?.value;
}

describe('summarizeEmail', () => {
  it('says email is off and sent to everyone when it is switched off with no recipient limit', () => {
    expect(valueOf({ enabled: false }, 'enabled')).toBe('Off');
    expect(valueOf({}, 'allowedRecipients')).toBe('Everyone');
  });

  it('lists every allowed recipient when email is limited', () => {
    expect(valueOf({ allowedRecipients: ['a@example.com', '@example.org'] }, 'allowedRecipients')).toBe('a@example.com, @example.org');
  });

  it.each([
    [0, 'Mondays at 12:00 AM Eastern'],
    [3, 'Mondays at 3:00 AM Eastern'],
    [12, 'Mondays at 12:00 PM Eastern'],
    [15, 'Mondays at 3:00 PM Eastern'],
  ])('shows digest hour %i as %s', (weeklyDigestHour, expected) => {
    expect(valueOf({ weeklyDigestHour }, 'weeklyDigestHour')).toBe(expected);
  });
});
