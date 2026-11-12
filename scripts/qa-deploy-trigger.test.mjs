import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

// QA is deployed on demand: a push to main tests the code and stops there, and "Run workflow" on
// main runs the same tests and then deploys. docs/CI-AND-QUALITY-GATES.md, *Deploying QA*.
const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const DEPLOY_JOBS = ['deploy-publish-images', 'deploy-migrate-qa', 'deploy-qa', 'poolmaster-browser-e2e', 'deploy-health-issue'];

describe('QA deploy trigger', () => {
  it('can be started by hand, so a batch of merges reaches QA once when someone is ready to test', () => {
    assert.ok('workflow_dispatch' in workflow.on, 'ci.yml has no workflow_dispatch trigger');
  });

  for (const job of DEPLOY_JOBS) {
    it(`${job} runs only on a manual run on main, never on a push, so a merge does not deploy QA`, () => {
      const condition = String(workflow.jobs[job].if);
      assert.match(condition, /github\.event_name == 'workflow_dispatch'/);
      assert.match(condition, /github\.ref == 'refs\/heads\/main'/);
      assert.doesNotMatch(condition, /'push'/);
    });
  }

  it('publishes images only after every test and build job passes, so a deploy never ships untested code', () => {
    const needs = workflow.jobs['deploy-publish-images'].needs;
    for (const job of ['all-contract-gates', 'schema-migration-drift', 'service-unit-tests', 'service-integration-tests', 'service-functional-api-tests', 'service-lint-typecheck', 'poolmaster-unit-tests', 'service-build', 'service-image-smoke', 'service-mock-provider-build', 'poolmaster-build', 'poolmaster-browser-e2e-local']) {
      assert.ok(needs.includes(job), `deploy-publish-images does not wait for ${job}`);
    }
  });

  it('keeps the local browser e2e on every push to main, so two merges that clash still turn main red', () => {
    const condition = String(workflow.jobs['poolmaster-browser-e2e-local'].if);
    assert.doesNotMatch(condition, /event_name/);
  });

  it('reports a manual run\'s failed tests on the main build issue, as a push run\'s are', () => {
    const condition = String(workflow.jobs['main-ci-health-issue'].if);
    assert.match(condition, /github\.event_name != 'pull_request'/);
  });

  it('gives a manual deploy its own concurrency group, so a merge pushed meanwhile cannot replace a pending deploy', () => {
    assert.match(workflow.concurrency.group, /workflow_dispatch/);
  });
});
