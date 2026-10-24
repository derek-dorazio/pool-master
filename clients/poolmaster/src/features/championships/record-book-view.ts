import { RecordType } from '@poolmaster/shared/domain';
import type { RecordHolderDto, RecordStandDto } from '@/lib/api';
import { joinNames } from './cup-view';

/**
 * Each record as the record book names it and counts its value. A `Record` over the enum, so a
 * new record without wording fails the typecheck.
 */
export const RECORD_WORDING: Record<RecordType, { title: string; value: (value: number) => string }> = {
  [RecordType.MOST_CHAMPIONSHIPS]: { title: 'Most championships', value: (value) => plural(value, 'championship') },
  [RecordType.BACK_TO_BACK_CHAMPIONS]: { title: 'Most championships in a row', value: (value) => `${value} years in a row` },
  [RecordType.MOST_WINS_IN_A_YEAR]: { title: 'Most wins in a year', value: (value) => plural(value, 'win') },
  [RecordType.MOST_WINS_ALL_TIME]: { title: 'Most wins', value: (value) => plural(value, 'win') },
  [RecordType.LONGEST_PODIUM_RUN]: { title: 'Longest podium run', value: (value) => `${plural(value, 'contest')} in a row in the top 3` },
  [RecordType.BIGGEST_FIELD_WON]: { title: 'Biggest field won', value: (value) => plural(value, 'entry', 'entries') },
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
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
