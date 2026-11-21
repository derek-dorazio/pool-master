/**
 * `npm run docs:domain-events` (#1946): writes the domain event table in docs/BACKGROUND-JOBS.md
 * from DOMAIN_EVENT_HANDLERS. With `--check` (`npm run rules:check:domain-events`) it writes
 * nothing and fails when the table in the document is not the one the map renders.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DOMAIN_EVENT_HANDLERS } from '../packages/core-api/src/modules/domain-events/domain-event-handlers';
import { renderDomainEventTable, withDomainEventTable } from '../packages/core-api/src/modules/domain-events/domain-event-table';

const DOCUMENT = path.resolve('docs/BACKGROUND-JOBS.md');

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const current = await readFile(DOCUMENT, 'utf8');
  const next = withDomainEventTable(current, renderDomainEventTable(DOMAIN_EVENT_HANDLERS));
  if (next === current) {
    console.log('docs/BACKGROUND-JOBS.md: the domain event table matches DOMAIN_EVENT_HANDLERS.');
    return;
  }
  if (check) {
    console.error('docs/BACKGROUND-JOBS.md: the domain event table is stale. Run `npm run docs:domain-events` and commit the result.');
    process.exitCode = 1;
    return;
  }
  await writeFile(DOCUMENT, next);
  console.log('docs/BACKGROUND-JOBS.md: wrote the domain event table from DOMAIN_EVENT_HANDLERS.');
}

void main();
