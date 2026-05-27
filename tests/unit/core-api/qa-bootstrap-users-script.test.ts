import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const bootstrapUsersScript = readFileSync(
  resolve(repoRoot, 'packages/core-api/scripts/bootstrap-users.mjs'),
  'utf8',
);

describe('pool-master-xw5.2: QA browser fixture user bootstrap', () => {
  it('reactivates durable fixture users when repairing deployed browser accounts', () => {
    expect(bootstrapUsersScript).toContain('isActive: true');
    expect(bootstrapUsersScript).toContain('isActive=${user.isActive}');
  });
});
