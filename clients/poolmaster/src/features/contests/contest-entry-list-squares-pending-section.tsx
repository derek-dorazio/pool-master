import { SectionCard, SectionEmpty } from '@/features/shared/ui';

/** A squares contest's board while it is still being set up (#1768): nothing to show until it opens. */
export function ContestEntryListSquaresPendingSection() {
  return (
    <SectionCard testId="contest-board-squares-pending" title="Squares board">
      <SectionEmpty testId="contest-board-squares-pending-note">The board appears when the contest opens.</SectionEmpty>
    </SectionCard>
  );
}
