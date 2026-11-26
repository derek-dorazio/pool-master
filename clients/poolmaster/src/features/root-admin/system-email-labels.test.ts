import { describe, expect, it } from 'vitest';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { EmailAudienceOrder, explicitOrderValues } from '@poolmaster/shared/domain';

describe('system email labels', () => {
  it('orders the Audience column widest group first: account holders, members, people invited, commissioners, root admins', () => {
    expect(explicitOrderValues(EmailAudienceOrder).map((audience) => enumLabel('EmailAudience', audience))).toEqual([
      'Account holders',
      'Members',
      'People invited',
      'Commissioners',
      'Root admins',
    ]);
  });
});
