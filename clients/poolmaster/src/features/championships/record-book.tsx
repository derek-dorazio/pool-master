import { isHallOfLameRecord } from '@poolmaster/shared/domain';
import type { RecordDto } from '@/lib/api';
import { ErrorState, Tile } from '@/features/shared/ui';
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
    <Tile className="space-y-3" data-testid={testId} padding="sm" radius="lg">
      <h2 className="title-card text-lg text-foreground">{title}</h2>
      <ul className="space-y-3 text-sm">
        {records.map((record) => (
          <li className="space-y-0.5" data-testid={`record-${record.type}`} key={record.type}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium text-foreground">{RECORD_WORDING[record.type].title}</span>
              <span className="text-foreground">{describeRecordStand(record.type, record.best)}</span>
            </div>
            {record.nextBest ? (
              <p className="text-muted-foreground" data-testid={`record-${record.type}-next`}>
                {`Next best: ${describeRecordStand(record.type, record.nextBest)}`}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Tile>
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
    return <ErrorState body="We couldn't load this squad's records." testId="squad-records-error" />;
  }
  const held = recordsHeldBy(recordsQuery.data ?? [], squadId);
  if (!held.length) {
    return null;
  }

  return (
    <Tile className="space-y-3" data-testid="squad-records" padding="sm" radius="lg">
      <h2 className="title-card text-lg text-foreground">Records</h2>
      <ul className="space-y-2 text-sm">
        {held.map((record) => (
          <li className="flex flex-wrap justify-between gap-2" data-testid={`squad-record-${record.type}`} key={record.type}>
            <span className="font-medium text-foreground">{RECORD_WORDING[record.type].title}</span>
            <span className="text-foreground">{describeHeldRecord(record)}</span>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
