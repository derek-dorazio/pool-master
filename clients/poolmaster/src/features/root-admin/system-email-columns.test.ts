import { describe, expect, it } from 'vitest';
import type { SystemEmailDto } from '@/lib/api';
import { systemEmailColumns } from './system-email-columns';
import { EVERY_PLAN } from './system-email-labels';

const email: SystemEmailDto = {
  templateKey: 'CONTEST_OPENED',
  planFeature: 'EMAIL_CONTEST_OPENED',
  planStartsAt: 'PRO',
  status: 'ON',
  sentLast30Days: 3,
  lastSentAt: null,
  previewSentAt: null,
};

function planValue(row: SystemEmailDto): unknown {
  const column = systemEmailColumns.find((candidate) => candidate.id === 'plan');
  return column !== undefined && 'accessorFn' in column ? column.accessorFn(row, 0) : undefined;
}

describe('the Emails grid Plan column', () => {
  it('filters an email by the lowest plan that gets it', () => {
    expect(planValue(email)).toBe('PRO');
  });

  it('files an email every plan gets under Every plan', () => {
    expect(planValue({ ...email, planStartsAt: null })).toBe(EVERY_PLAN);
  });
});
