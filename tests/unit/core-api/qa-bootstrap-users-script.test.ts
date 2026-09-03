import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// pool-master-303: the browser e2e fixture suite this test used to also
// cover (clients/poolmaster/e2e/fixture-state.ts, fixtures.ts) was deleted
// in plans/130-e2e-browser-suite-evaluation.md's phase 1 — it depended on
// pre-existing, shared, mutated-in-place QA data, which is exactly what
// that plan removed. bootstrap-users.mjs itself is unrelated and still
// live (see .github/workflows/create-test-users.yml), so this file now
// only covers that script.
const repoRoot = resolve(__dirname, '../../..');
const bootstrapUsersScript = readFileSync(
  resolve(repoRoot, 'packages/core-api/scripts/bootstrap-users.mjs'),
  'utf8',
);

describe('pool-master-xw5.2: QA fixture user bootstrap script', () => {
  it('reactivates durable fixture users when repairing deployed browser accounts', () => {
    expect(bootstrapUsersScript).toContain('isActive: true');
    expect(bootstrapUsersScript).toContain('isActive=${user.isActive}');
  });
});
