import { RecordType } from '@poolmaster/shared/domain';
import type { RecordDto, RecordHolderDto, RecordStandDto } from '@/lib/api';
import { joinNames } from './cup-view';

/**
 * Each record as the record book names it and counts its value. A `Record` over the enum, so a
 * new record without wording fails the typecheck.
 */
export const RECORD_WORDING: Record<RecordType, { title: string; value: (value: number) => string }> = {
  [RecordType.MOST_CHAMPIONSHIPS]: { title: 'Most championships', value: (value) => plural(value, 'championship') },
  [RecordType.BACK_TO_BACK_CHAMPIONS]: { title: 'Most championships in a row', value: (value) => inARow(value, 'year', 'years') },
  [RecordType.MOST_WINS_IN_A_YEAR]: { title: 'Most wins in a year', value: (value) => plural(value, 'win') },
  [RecordType.MOST_WINS_ALL_TIME]: { title: 'Most wins', value: (value) => plural(value, 'win') },
  [RecordType.LONGEST_PODIUM_RUN]: { title: 'Longest podium run', value: (value) => inARow(value, 'podium', 'podiums') },
  [RecordType.BIGGEST_FIELD_WON]: { title: 'Biggest field won', value: (value) => plural(value, 'entry', 'entries') },
  [RecordType.MOST_RUNNER_UPS]: { title: 'Most runner-ups', value: (value) => plural(value, '2nd place') },
  [RecordType.MOST_FOURTHS]: { title: 'Most 4th places', value: (value) => plural(value, '4th place') },
  [RecordType.MOST_LAST_PLACES]: { title: 'Most last places', value: (value) => plural(value, 'last place') },
  [RecordType.LONGEST_DROUGHT]: { title: 'Longest drought', value: (value) => `${plural(value, 'contest')} without a win` },
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A run's length: "3 podiums in a row", but just "1 podium", since one alone is no run. */
function inARow(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many} in a row`;
}

/** A holder as a record names it: "Eagles", "Eagles (2025)", "Eagles, Masters Pick 6 (2025)". */
export function describeRecordHolder(holder: RecordHolderDto): string {
  const name = holder.contestName === null ? holder.squad.squadName : `${holder.squad.squadName}, ${holder.contestName}`;
  return holder.year === null ? name : `${name} (${holder.year})`;
}

/** A record value and its holders: "7 wins · Eagles (2025) and Birdies (2024)". */
export function describeRecordStand(type: RecordType, stand: RecordStandDto): string {
  return `${RECORD_WORDING[type].value(stand.value)} · ${joinNames(stand.holders.map(describeRecordHolder))}`;
}

/** A record one squad holds, with each time it set the best value. */
export interface HeldRecord {
  type: RecordType;
  value: number;
  holdings: RecordHolderDto[];
}

/** The records a squad holds outright or shares at the top, in the record book's order. */
export function recordsHeldBy(records: RecordDto[], squadId: string): HeldRecord[] {
  return records.flatMap((record) => {
    const holdings = record.best.holders.filter((holder) => holder.squad.squadId === squadId);
    return holdings.length ? [{ type: record.type, value: record.best.value, holdings }] : [];
  });
}

/** A held record's value and when: "4 wins · 2025", "48 entries · Masters Pick 6 (2025)", "9 wins". */
export function describeHeldRecord(record: HeldRecord): string {
  const value = RECORD_WORDING[record.type].value(record.value);
  const when = record.holdings.flatMap((holding) => {
    if (holding.contestName !== null) {
      return [holding.year === null ? holding.contestName : `${holding.contestName} (${holding.year})`];
    }
    return holding.year === null ? [] : [String(holding.year)];
  });
  return when.length ? `${value} · ${joinNames(when)}` : value;
}
