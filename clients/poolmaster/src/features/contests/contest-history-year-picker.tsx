import { useSearchParams } from 'react-router';
import { YearPicker } from '@/features/shared/ui';

/**
 * The season Commissioner tools' contest History shows, kept in the link (`?year=2025`) so it
 * survives a reload or a shared link. My team's Past contests keeps its own `?pastYear=`, because
 * that page's `?year=` is its championship year (#1763).
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
