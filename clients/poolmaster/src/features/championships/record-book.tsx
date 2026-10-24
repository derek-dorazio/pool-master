import { ErrorState, Tile } from '@/features/shared/ui';
import { RECORD_WORDING, describeRecordStand } from './record-book-view';
import { useRecordsQuery } from './use-championship-query';

/**
 * The record book on All years (#873): each record somebody holds, with its holders (every one
 * on a tie) and the next best. Nothing shows until a record is held.
 */
export function RecordBook({ leagueId }: { leagueId: string }) {
  const recordsQuery = useRecordsQuery(leagueId);

  if (recordsQuery.isError) {
    return <ErrorState body="We couldn't load the record book." testId="record-book-error" />;
  }
  const records = recordsQuery.data ?? [];
  if (!records.length) {
    return null;
  }

  return (
    <Tile className="space-y-3" data-testid="record-book" padding="sm" radius="lg">
      <h2 className="text-lg font-semibold text-foreground">Record book</h2>
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
