import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { findDanglingPlanReferences, isExemptPath } from './check-plan-references.mjs';

const nothingPresent = () => false;
const only = (...numbers) => (number) => numbers.includes(number);

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
