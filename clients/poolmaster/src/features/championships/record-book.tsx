import { isHallOfLameRecord } from '@poolmaster/shared/domain';
import type { RecordDto } from '@/lib/api';
import { ErrorState, Tile } from '@/features/shared/ui';
import { RECORD_WORDING, describeRecordStand } from './record-book-view';
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
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
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
