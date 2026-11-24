/**
 * The domain event table in docs/BACKGROUND-JOBS.md, rendered from the handler map (#1946) so
 * the inventory of what follows each change cannot drift from the code. `npm run
 * docs:domain-events` writes it; `npm run rules:check:domain-events` fails when it is stale.
 */

import type { DomainEventHandlerMap } from './domain-event-handler';
import type { DomainEventType } from './domain-event';

export const DOMAIN_EVENT_TABLE_START = '<!-- domain-event-handlers:start (generated from DOMAIN_EVENT_HANDLERS by `npm run docs:domain-events`; edit the map, not this table) -->';
export const DOMAIN_EVENT_TABLE_END = '<!-- domain-event-handlers:end -->';

/** One row per handler, in map order; an event type with no handler gets a row that says so. */
export function renderDomainEventTable(handlers: DomainEventHandlerMap): string {
  const rows = (Object.keys(handlers) as DomainEventType[]).flatMap((type) => {
    const list = handlers[type];
    if (list.length === 0) return [`| \`${type}\` | none | none |`];
    return list.map((handler) => `| \`${type}\` | \`${handler.key}\` | ${handler.queues.map((jobType) => `\`${jobType}\``).join(', ')} |`);
  });
  return [DOMAIN_EVENT_TABLE_START, '| Domain event | Handler | Queues |', '|---|---|---|', ...rows, DOMAIN_EVENT_TABLE_END].join('\n');
}

/** `document` with its generated table replaced by `table`; throws when the markers are missing. */
export function withDomainEventTable(document: string, table: string): string {
  const start = document.indexOf(DOMAIN_EVENT_TABLE_START);
  const end = document.indexOf(DOMAIN_EVENT_TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('The domain event table markers are missing from the document');
  }
  return document.slice(0, start) + table + document.slice(end + DOMAIN_EVENT_TABLE_END.length);
}
