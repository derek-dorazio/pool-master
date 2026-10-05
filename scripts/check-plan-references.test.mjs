import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  collectPermanentFiles,
  findDanglingPlanReferences,
  isExemptPath,
  isReadmePath,
  presentPlanNumbers,
} from './check-plan-references.mjs';

const nothingPresent = () => false;
const only = (...numbers) => (number) => numbers.includes(number);

/** Runs `run()` with the cwd pointed at a throwaway tree built from `{ path: contents }`. */
function inFixtureTree(tree, run) {
  const root = mkdtempSync(join(tmpdir(), 'plan-refs-'));
  const previousCwd = process.cwd();
  try {
    for (const [path, contents] of Object.entries(tree)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    process.chdir(root);
    return run();
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
}

// The two citations #147 was filed for, as docs/CONTEST-RULES.md carried them.
const contestRulesBefore = [
  '## Source Files',
  '',
  '- Launch scoring rules and aggregation rules are defined in `plans/51-scoring-and-participant-data-review.md`',
  '- Later rule expansion ideas are tracked in `plans/52-potential-rules-function-expansion.md`',
  '- Participant scoring definitions — score direction, unit and the one display format per measure: `packages/shared/domain/contest-scoring.ts`',
].join('\n');

describe('check-plan-references (#147)', () => {
  it('flags both CONTEST-RULES citations of plans that are not in the tree', () => {
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/CONTEST-RULES.md', text: contestRulesBefore }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, [
      { path: 'docs/CONTEST-RULES.md', line: 3, reference: 'plans/51-scoring-and-participant-data-review.md' },
      { path: 'docs/CONTEST-RULES.md', line: 4, reference: 'plans/52-potential-rules-function-expansion.md' },
    ]);
  });

  it('passes the model citation in docs/CI-AND-QUALITY-GATES.md: absent plan, retrieval hint three lines down', () => {
    // Read from the tree, not copied, so an edit that breaks the model also breaks this test.
    const text = readFileSync('docs/CI-AND-QUALITY-GATES.md', 'utf8');
    assert.match(text, /plans\/115-rule-enforcement-hardening\.md/);
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/CI-AND-QUALITY-GATES.md', text }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, []);
  });

  it('passes a citation of a plan that is still in the tree, with no hint (latent, not broken)', () => {
    // The shape of AGENTS.md's plans/111 and workflow-rules.md's plans/142 citations when #147 was filed.
    const text = 'See `plans/111-agent-persona-layout.md` for the full layout and rationale.\n'
      + 'The relocation is tracked in plans/142.';
    const findings = findDanglingPlanReferences({
      files: [{ path: 'AGENTS.md', text }, { path: 'rules/workflow-rules.md', text }],
      planExists: only('111', '142'),
    });
    assert.deepEqual(findings, []);
  });

  it('flags the same latent citation once its plan is deleted', () => {
    const findings = findDanglingPlanReferences({
      files: [{ path: 'AGENTS.md', text: 'See `plans/111-agent-persona-layout.md`.' }],
      planExists: nothingPresent,
    });
    assert.equal(findings.length, 1);
  });

  it('does not accept a hint that retrieves a different plan', () => {
    const text = '- `plans/51-scoring.md` — deleted.\n  Retrieve via `git show abc1234^:plans/115-rule-enforcement-hardening.md`';
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/X.md', text }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings.map((f) => f.reference), ['plans/51-scoring.md']);
  });

  it('does not accept a hint further away than the window', () => {
    const text = ['plans/51-scoring.md', '', '', '', '', 'git show abc1234^:plans/51-scoring.md'].join('\n');
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/X.md', text }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings.map((f) => f.line), [1]);
  });

  it('accepts a hint on the line above the citation', () => {
    const text = 'Retrieve with `git show abc1234^:plans/117-league.md`:\n(plans/117 §7.1)';
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/X.md', text }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, []);
  });

  it('matches a bare plan number as well as a file name', () => {
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/X.md', text: 'decisions: the stage-2 outcome in plans/145.' }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings.map((f) => f.reference), ['plans/145']);
  });

  it('exempts accepted ADRs, which are immutable', () => {
    assert.equal(isExemptPath('docs/adr/0005-cross-tier-log-correlation.md'), true);
    assert.equal(isExemptPath('docs/CONTEST-RULES.md'), false);
    const findings = findDanglingPlanReferences({
      files: [{ path: 'docs/adr/0005-cross-tier-log-correlation.md', text: 'part of `plans/102-webapp-logging-observability.md`' }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, []);
  });

  it('ignores placeholders that are not plan numbers', () => {
    const findings = findDanglingPlanReferences({
      files: [{ path: 'rules/workflow-rules.md', text: '| Slice-life | `plans/NN-*.md` |' }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, []);
  });
});

describe('check-plan-references scope: package and client READMEs (#334)', () => {
  it('flags a dangling citation in a package README', () => {
    const findings = findDanglingPlanReferences({
      files: [{ path: 'packages/README.md', text: 'the object `plans/145` slice 1 was entirely about.' }],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, [{ path: 'packages/README.md', line: 1, reference: 'plans/145' }]);
  });

  it('flags a dangling citation in a nested package README and in a client README', () => {
    const findings = findDanglingPlanReferences({
      files: [
        { path: 'packages/mock-contest-feed-provider/README.md', text: 'see `plans/130-e2e-browser-suite-evaluation.md`' },
        { path: 'clients/poolmaster/README.md', text: 'see plans/126.' },
      ],
      planExists: nothingPresent,
    });
    assert.deepEqual(findings, [
      {
        path: 'packages/mock-contest-feed-provider/README.md',
        line: 1,
        reference: 'plans/130-e2e-browser-suite-evaluation.md',
      },
      { path: 'clients/poolmaster/README.md', line: 1, reference: 'plans/126' },
    ]);
  });

  it('keeps the existing semantics in the new roots: a plan still in the tree is latent, and a hint rescues an absent one', () => {
    // packages/README.md's two citations as #330 wrote them, with 142 and 145 in the tree.
    const latent = 'the object `plans/145` slice 1 was entirely about.\nPer `plans/142`, an empty README is worse than none.';
    assert.deepEqual(
      findDanglingPlanReferences({
        files: [{ path: 'packages/README.md', text: latent }],
        planExists: only('142', '145'),
      }),
      [],
    );
    // The same file on the day 145 is deleted, once the citation carries its retrieval command.
    const hinted = 'the object `plans/145` slice 1 was entirely about.\nRetrieve via `git show abc1234^:plans/145-one-object-one-operation-set.md`.';
    assert.deepEqual(
      findDanglingPlanReferences({
        files: [{ path: 'packages/README.md', text: hinted }],
        planExists: only('142'),
      }),
      [],
    );
  });

  it('scopes the new roots to READMEs by name', () => {
    assert.equal(isReadmePath('packages/README.md'), true);
    assert.equal(isReadmePath('clients/poolmaster/src/features/shared/ui/README.md'), true);
    assert.equal(isReadmePath('/abs/packages/mock-contest-feed-provider/README.md'), true);
    assert.equal(isReadmePath('packages/shared/CHANGELOG.md'), false);
    assert.equal(isReadmePath('clients/poolmaster/e2e/NOTES.md'), false);
    assert.equal(isReadmePath('packages/core-api/README.template.md'), false);
  });

  it('collects every .md under the permanent roots, but only READMEs under packages/ and clients/', () => {
    const scanned = inFixtureTree(
      {
        'AGENTS.md': 'root instructions',
        'CLAUDE.md': 'pointer',
        'docs/CI-AND-QUALITY-GATES.md': 'gates',
        'docs/adr/0002-plans.md': 'decision',
        'rules/workflow-rules.md': 'rules',
        'requirements/product-requirements/glossary.md': 'terms',
        'tech-specs/features/x/spec.md': 'spec',
        'packages/README.md': 'the packages map',
        'packages/mock-contest-feed-provider/README.md': 'provider',
        // Not READMEs: in scope only if the roots were walked wholesale.
        'packages/shared/CHANGELOG.md': 'generated changelog',
        'packages/core-api/src/notes.md': 'scratch',
        'clients/poolmaster/README.md': 'the webapp',
        'clients/poolmaster/src/features/shared/ui/README.md': 'a feature README',
        'clients/poolmaster/e2e/NOTES.md': 'scratch',
        // READMEs the walker must skip because of where they live.
        'packages/shared/node_modules/dep/README.md': 'vendored',
        'packages/core-api/dist/README.md': 'built',
        'clients/poolmaster/coverage/README.md': 'generated',
        'clients/poolmaster/generated/README.md': 'generated',
      },
      () => collectPermanentFiles().map((file) => file.path).sort(),
    );

    assert.deepEqual(scanned, [
      'AGENTS.md',
      'CLAUDE.md',
      'clients/poolmaster/README.md',
      'clients/poolmaster/src/features/shared/ui/README.md',
      'docs/CI-AND-QUALITY-GATES.md',
      'docs/adr/0002-plans.md',
      'packages/README.md',
      'packages/mock-contest-feed-provider/README.md',
      'requirements/product-requirements/glossary.md',
      'rules/workflow-rules.md',
      'tech-specs/features/x/spec.md',
    ]);
  });

  it('binds packages/README.md the way the model citation binds docs/CI-AND-QUALITY-GATES.md', () => {
    // Read from the tree against the real plans/ directory, so deleting a plan this README
    // cites without adding the retrieval command turns this test red rather than printing a
    // warning nobody reads. #330's `plans/142` and `plans/145` are latent today and pass.
    const text = readFileSync('packages/README.md', 'utf8');
    assert.match(text, /plans\/14[25]/);
    const present = presentPlanNumbers();
    const findings = findDanglingPlanReferences({
      files: [{ path: 'packages/README.md', text }],
      planExists: (number) => present.has(number),
    });
    assert.deepEqual(findings, []);
  });
});
