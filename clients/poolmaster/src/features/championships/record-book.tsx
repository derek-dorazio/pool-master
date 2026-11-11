import { isHallOfLameRecord } from '@poolmaster/shared/domain';
import type { RecordDto } from '@/lib/api';
import { ErrorState, SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';
import { RECORD_WORDING, describeHeldRecord, describeRecordStand, recordsHeldBy } from './record-book-view';
import { useRecordsQuery } from './use-championship-query';

/**
 * The record book on All years (#873): each record somebody holds, with its holders (every one
 * on a tie) and the next best; then the Hall of Lame, unless the league hides it (the server
 * leaves its rows out). Nothing shows until a record is held.
 */
export function RecordBook({ leagueId }: { leagueId: string }) {
  const recordsQuery = useRecordsQuery(leagueId);

  if (recordsQuery.isError) {
    return <ErrorState body="We couldn't load the record book." testId="record-book-error" />;
  }
  const records = recordsQuery.data ?? [];
  const book = records.filter((record) => !isHallOfLameRecord(record.type));
  const hallOfLame = records.filter((record) => isHallOfLameRecord(record.type));

  return (
    <>
      {book.length ? <RecordList records={book} testId="record-book" title="Record book" /> : null}
      {hallOfLame.length ? <RecordList records={hallOfLame} testId="hall-of-lame" title="Hall of Lame" /> : null}
    </>
  );
}

function RecordList({ records, testId, title }: { records: RecordDto[]; testId: string; title: string }) {
  return (
    <SectionCard testId={testId} title={title}>
      <SectionRows>
        {records.map((record) => (
          <SectionRow
            facts={record.nextBest ? `Next best: ${describeRecordStand(record.type, record.nextBest)}` : undefined}
            key={record.type}
            name={RECORD_WORDING[record.type].title}
            testId={`record-${record.type}`}
            value={describeRecordStand(record.type, record.best)}
          />
        ))}
      </SectionRows>
    </SectionCard>
  );
}

/**
 * The records a squad holds, on its squad page (#872): the record book's rows where it has the
 * best value, read from the same record book so the two always agree. Nothing shows until it
 * holds one.
 */
export function SquadRecords({ leagueId, squadId }: { leagueId: string; squadId: string }) {
  const recordsQuery = useRecordsQuery(leagueId);

  if (recordsQuery.isError) {
    return <ErrorState body="We couldn't load this team's records." testId="squad-records-error" />;
  }
  const held = recordsHeldBy(recordsQuery.data ?? [], squadId);
  if (!held.length) {
    return null;
  }

  return (
    <SectionCard testId="squad-records" title="Records">
      <SectionRows>
        {held.map((record) => (
          <SectionRow
            key={record.type}
            name={RECORD_WORDING[record.type].title}
            testId={`squad-record-${record.type}`}
            value={describeHeldRecord(record)}
          />
        ))}
      </SectionRows>
    </SectionCard>
  );
}
