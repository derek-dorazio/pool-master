import { readFunctionalServerState } from './state';
import { describeQueryBudgetViolations, type QueryBudgetViolation } from '../support/query-budget';

// #1244 — fails the test whose requests went over the per-request query budget, naming each
// route and its count. The server records them on send (tests/functional/server.ts); this takes
// what it recorded since the last check.

async function takeViolations(): Promise<QueryBudgetViolation[]> {
  const { queryBudgetUrl } = readFunctionalServerState();
  if (!queryBudgetUrl) {
    throw new Error(
      'The functional server state has no queryBudgetUrl: a daemon started by older code is still '
        + 'running. Stop it (coverage/service-functional-api/daemon/server-state.json has its pid) and re-run.',
    );
  }
  const response = await fetch(`${queryBudgetUrl}/take`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Query budget recorder returned ${response.status}`);
  }
  return (await response.json()) as QueryBudgetViolation[];
}

async function failOnViolations(): Promise<void> {
  const violations = await takeViolations();
  if (violations.length > 0) {
    throw new Error(describeQueryBudgetViolations(violations));
  }
}

afterEach(failOnViolations);
afterAll(failOnViolations);
