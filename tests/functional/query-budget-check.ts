import fs from 'node:fs';
import { readFunctionalServerState } from './state';
import { describeQueryBudgetViolations, type QueryBudgetViolation } from '../support/query-budget';

// #1244 — fails the test whose requests went over the per-request query budget, naming each
// route and its count. The server records them on send (tests/functional/server.ts); this takes
// what it recorded since the last check.

function takeViolations(): QueryBudgetViolation[] {
  const { queryBudgetViolationsPath } = readFunctionalServerState();
  if (!queryBudgetViolationsPath) {
    throw new Error(
      'The functional server state has no queryBudgetViolationsPath: a daemon started by older code is still '
        + 'running. Stop it and run the suite again.',
    );
  }
  // Renamed before reading, so a line the server appends meanwhile lands in a fresh file.
  const taken = `${queryBudgetViolationsPath}.${process.pid}`;
  try {
    fs.renameSync(queryBudgetViolationsPath, taken);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const lines = fs.readFileSync(taken, 'utf8').split('\n').filter((line) => line.length > 0);
  fs.rmSync(taken, { force: true });
  return lines.map((line) => JSON.parse(line) as QueryBudgetViolation);
}

function failOnViolations(): void {
  const violations = takeViolations();
  if (violations.length > 0) {
    throw new Error(describeQueryBudgetViolations(violations));
  }
}

afterEach(failOnViolations);
afterAll(failOnViolations);
