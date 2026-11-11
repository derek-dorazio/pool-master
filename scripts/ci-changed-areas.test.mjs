import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyChanges, uiBatchViolations } from './ci-changed-areas.mjs';

// #300 — the cases that matter are the ones where skipping would be wrong, so most of these assert
// that something runs rather than that it is skipped.
describe('ci-changed-areas (#300)', () => {
  it('skips every code job for a documentation-only change', () => {
    const r = classifyChanges([
      'docs/CI-AND-QUALITY-GATES.md',
      'plans/146-ci-path-filtered-jobs.md',
      'rules/workflow-rules.md',
      'AGENTS.md',
    ]);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: false, service: false, client: false });
  });

  it('runs the service suites for a core-api change, and not the client ones', () => {
    const r = classifyChanges(['packages/core-api/src/modules/contests/service.ts']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: false });
  });

  it('runs the client suites for a clients/ change, and not the service ones', () => {
    const r = classifyChanges(['clients/poolmaster/src/features/leagues/league-detail-page.tsx']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: false, client: true });
  });

  it('runs everything when a dependency changes, because a bump can break any suite', () => {
    for (const file of ['package.json', 'package-lock.json']) {
      const r = classifyChanges([file]);
      assert.deepEqual({ code: r.code, service: r.service, client: r.client },
        { code: true, service: true, client: true }, file);
    }
  });

  it('runs everything when the workflow itself changes, so a CI edit proves itself', () => {
    const r = classifyChanges(['.github/workflows/ci.yml']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: true });
  });

  it('runs everything when a script changes, since the suites execute them', () => {
    const r = classifyChanges(['scripts/merge-service-coverage.mjs']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: true });
  });

  it('runs everything for an unclassified path, so a new directory cannot skip the suites', () => {
    const r = classifyChanges(['infrastructure/terraform/main.tf']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: true });
    assert.match(r.reason, /unclassified/);
  });

  it('runs everything when the file list is empty or missing, since that is not "nothing changed"', () => {
    for (const files of [[], null, undefined]) {
      const r = classifyChanges(files);
      assert.deepEqual({ code: r.code, service: r.service, client: r.client },
        { code: true, service: true, client: true });
    }
  });

  it('does not let one doc file in a code PR suppress the code jobs', () => {
    const r = classifyChanges([
      'docs/CI-AND-QUALITY-GATES.md',
      'packages/core-api/src/modules/leagues/permissions.ts',
    ]);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: false });
  });

  it('treats a tests/ change as a service change', () => {
    const r = classifyChanges(['tests/integration/core-api/events.integration.ts']);
    assert.equal(r.service, true);
  });

  it('treats packages/shared as BOTH a service and a client change', () => {
    // shared feeds both tiers: the service imports it directly and the client consumes it through
    // the generated SDK, so a shared change can break either. It was service-only until #303 --
    // a packages/shared/domain change whose run skipped poolmaster-unit-tests. The first
    // qualifying PR found the gap, so this is the regression test for widening it.
    const r = classifyChanges(['packages/shared/domain/contest-scoring.ts']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: true });
  });

  it('runs both tiers for a lint or tsconfig change', () => {
    for (const file of ['eslint.config.js', 'tsconfig.json', 'turbo.json']) {
      const r = classifyChanges([file]);
      assert.deepEqual({ code: r.code, service: r.service, client: r.client },
        { code: true, service: true, client: true }, file);
    }
  });
});

// #778 — a push to main is all-or-nothing: only a documentation-only push skips anything.
describe('ci-changed-areas on a push to main (#778)', () => {
  const areas = (r) => ({ code: r.code, service: r.service, client: r.client });

  it('skips every code job, and so the deploy, for a documentation-only push', () => {
    const r = classifyChanges(['plans/super-bowl-squares.md', 'docs/CI-AND-QUALITY-GATES.md'],
      { allOrNothing: true });
    assert.deepEqual(areas(r), { code: false, service: false, client: false });
  });

  it('runs the client suites too for a service-only push, because main never runs part of the suites', () => {
    const r = classifyChanges(['packages/core-api/src/modules/contests/service.ts'],
      { allOrNothing: true });
    assert.deepEqual(areas(r), { code: true, service: true, client: true });
  });

  it('runs the service suites too for a client-only push', () => {
    const r = classifyChanges(['clients/poolmaster/src/main.tsx'], { allOrNothing: true });
    assert.deepEqual(areas(r), { code: true, service: true, client: true });
  });

  it('runs everything when a docs push also carries code from an earlier, untested commit', () => {
    const r = classifyChanges(['plans/super-bowl-squares.md', 'tests/integration/helpers.ts'],
      { allOrNothing: true });
    assert.deepEqual(areas(r), { code: true, service: true, client: true });
  });

  it('runs everything when the file list could not be built', () => {
    assert.deepEqual(areas(classifyChanges([], { allOrNothing: true })),
      { code: true, service: true, client: true });
  });
});

describe('ci-changed-areas: rule-scanner baselines', () => {
  it('runs only the client suites when a web-app sweep also shrinks a rule baseline', () => {
    const r = classifyChanges([
      'clients/poolmaster/src/features/leagues/league-detail-page.tsx',
      'scripts/text-style-baseline.json',
      'scripts/duplicate-baseline.json',
    ]);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: false, client: true });
  });

  it('still runs everything when the scanner script beside a baseline changes', () => {
    const r = classifyChanges(['scripts/text-style-baseline.json', 'scripts/check-text-styles.mjs']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: true });
  });

  it('still runs everything when the coverage floors change, since the suites read them', () => {
    const r = classifyChanges(['scripts/coverage-floors.json']);
    assert.deepEqual({ code: r.code, service: r.service, client: r.client },
      { code: true, service: true, client: true });
  });
});

describe('ci-changed-areas: UI batch pull requests', () => {
  it('accepts web-app files, docs and rule baselines', () => {
    assert.deepEqual(uiBatchViolations([
      'clients/poolmaster/src/features/shared/ui/text.tsx',
      'scripts/text-style-baseline.json',
      'rules/ux-rules.md',
    ]), []);
  });

  it('refuses shared, service, test, script and dependency changes (the web app\'s package.json too), which need the full suites', () => {
    const refused = [
      'packages/shared/domain/brand.ts',
      'packages/core-api/src/index.ts',
      'tests/integration/helpers.ts',
      'scripts/check-text-styles.mjs',
      'package-lock.json',
      '.github/workflows/ci.yml',
      'infrastructure/terraform/main.tf',
      'clients/poolmaster/package.json',
    ];
    assert.deepEqual(uiBatchViolations(['clients/poolmaster/src/main.tsx', ...refused]), refused);
  });

  it('refuses a pull request whose file list could not be built', () => {
    assert.deepEqual(uiBatchViolations([]), ['(no file list)']);
  });
});
