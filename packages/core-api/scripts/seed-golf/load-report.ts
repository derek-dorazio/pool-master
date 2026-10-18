/**
 * What a sport data load did, or in a dry run would do: one row per sport league, player,
 * event, event field and bracket, and the markdown the workflow summary shows. No I/O.
 */

import { isTestSlate, type SportDataFile } from './sport-data-file';

export const LoadMode = {
  /** Reads the site and reports what applying would change; writes nothing. */
  DRY_RUN: 'DRY_RUN',
  APPLY: 'APPLY',
} as const;
export type LoadMode = (typeof LoadMode)[keyof typeof LoadMode];

export const LoadSubject = {
  SPORT_LEAGUE: 'SPORT_LEAGUE',
  PLAYER: 'PLAYER',
  EVENT: 'EVENT',
  /** One row per event: its field as a whole. */
  FIELD: 'FIELD',
  /** One row per event: its bracket as a whole. */
  BRACKET: 'BRACKET',
} as const;
export type LoadSubject = (typeof LoadSubject)[keyof typeof LoadSubject];

export const LoadAction = {
  ADD: 'ADD',
  UPDATE: 'UPDATE',
  /** Already as the file has it. */
  SKIP: 'SKIP',
  /** The file differs, and the loader may not change it (the event has started, say). */
  CONFLICT: 'CONFLICT',
} as const;
export type LoadAction = (typeof LoadAction)[keyof typeof LoadAction];

export interface LoadRow {
  sportLeague: string;
  subject: LoadSubject;
  action: LoadAction;
  name: string;
  /** What changes, or why it cannot; null when there is nothing to say. */
  detail: string | null;
}

const SUBJECT_LABEL: Record<LoadSubject, string> = {
  SPORT_LEAGUE: 'Sport league',
  PLAYER: 'Player',
  EVENT: 'Event',
  FIELD: 'Field',
  BRACKET: 'Bracket',
};

const ACTION_ORDER: readonly LoadAction[] = [LoadAction.ADD, LoadAction.UPDATE, LoadAction.SKIP, LoadAction.CONFLICT];

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * The run as markdown: the file's scope and provenance, a count per subject and action, then
 * every row that is not a skip. Skips are only counted; a second run of the same file is all
 * skips and reads as one table of counts.
 */
export function formatLoadReport(file: SportDataFile, mode: LoadMode, rows: readonly LoadRow[]): string {
  const lines = [
    `### Load sport data (${mode === LoadMode.APPLY ? 'apply' : 'dry run, nothing written'})`,
    '',
    `${file.scope.sport} ${file.scope.season}: ${file.scope.sportLeagues.join(', ')}. Contents: ${file.scope.contents.join(', ')}.${isTestSlate(file) ? ' Test slate.' : file.testData ? ' Test data.' : ''}`,
    `Gathered ${file.provenance.gatheredAt} by ${file.provenance.gatheredBy} from ${file.provenance.sources.map((source) => `[${source.name}](${source.url})`).join(', ')}.`,
    '',
    `| | ${ACTION_ORDER.join(' | ')} |`,
    `|---|${ACTION_ORDER.map(() => '---:').join('|')}|`,
  ];
  for (const subject of Object.values(LoadSubject)) {
    const counts = ACTION_ORDER.map((action) => rows.filter((row) => row.subject === subject && row.action === action).length);
    lines.push(`| ${SUBJECT_LABEL[subject]} | ${counts.join(' | ')} |`);
  }
  const changes = rows.filter((row) => row.action !== LoadAction.SKIP);
  if (changes.length > 0) {
    lines.push('', '| Sport league | What | Action | Name | Detail |', '|---|---|---|---|---|');
    for (const row of changes) {
      lines.push(`| ${cell(row.sportLeague)} | ${SUBJECT_LABEL[row.subject]} | ${row.action} | ${cell(row.name)} | ${cell(row.detail ?? '')} |`);
    }
  } else {
    lines.push('', 'Nothing to change: the site already matches the file.');
  }
  return `${lines.join('\n')}\n`;
}
