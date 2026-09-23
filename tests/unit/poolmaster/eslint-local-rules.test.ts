import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * The RuleTester assertions live in eslint-rules/__tests__/run-rule-tests.mjs and
 * are spawned rather than imported: the rules are ESM and this suite transpiles to
 * CommonJS. Same reason frontend-rule-scanners.test.ts spawns its scripts.
 *
 * Covers #134 — the local plugin that replaces check-no-inline-query-keys and
 * check-no-mocked-api.
 */
describe('#134: local ESLint plugin rules', () => {
  it('#134: passes its RuleTester suite for no-inline-query-keys and no-mocked-api', () => {
    const repoRoot = join(__dirname, '../../..');
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'eslint-rules/__tests__/run-rule-tests.mjs')],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(`${result.stdout}${result.stderr}`).toContain('Local ESLint rule tests passed.');
    expect(result.status).toBe(0);
  });
});
