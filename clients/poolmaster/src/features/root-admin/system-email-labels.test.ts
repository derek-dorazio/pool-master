import { describe, expect, it } from 'vitest';
import { explicitOrderValues } from '@poolmaster/shared/domain';
import { EMAIL_AUDIENCE_LABELS, EmailAudienceOrder } from './system-email-labels';

describe('system email labels', () => {
  it('orders the Audience column widest group first: account holders, members, people invited, commissioners, root admins', () => {
    expect(explicitOrderValues(EmailAudienceOrder).map((audience) => EMAIL_AUDIENCE_LABELS[audience])).toEqual([
      'Account holders',
      'Members',
      'People invited',
      'Commissioners',
      'Root admins',
    ]);
  });
});
