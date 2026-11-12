import { useSearchParams } from 'react-router';
import { YearPicker } from '@/features/shared/ui';

/**
 * The season a contest history shows, kept in the link (`?year=2025`) so it survives a reload or
 * a shared link. Both histories, the league's Past contests and Commissioner tools' History, pick
 * their year with it.
 */
export function ContestHistoryYearPicker({ testId, year, years }: { testId: string; year: number; years: number[] }) {
  const [, setSearchParams] = useSearchParams();
  return (
    <YearPicker
      onChange={(next) => setSearchParams({ year: String(next) }, { replace: true })}
      testId={testId}
      value={year}
      years={years}
    />
  );
}
