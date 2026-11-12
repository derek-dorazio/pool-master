import type { SelectionType } from '@poolmaster/shared/domain';
import { FormatIllustration } from '@/features/contest-types/illustrations';
import { SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';

/**
 * "Members will see": a contest drawn as its row reads to members, its name, then its event, then
 * its rules in a sentence, led by the contest type's picture, the same drawing How to Play shows. The event has a line of its own, so a long name never hides it. A
 * setup form shows it above its buttons, outside the form's card, as the commissioner's last
 * check, and it follows every change to the form.
 */
export function MemberPreview({
  eventName,
  name,
  rules,
  selectionType,
}: {
  eventName: string;
  /** The contest's name as typed; an empty one reads "Untitled contest". */
  name: string;
  /** The rules sentence members read. */
  rules: string;
  /** The contest's format, whose picture leads the row and follows a change of format. */
  selectionType: SelectionType;
}) {
  return (
    <SectionCard testId="contest-members-will-see" title="Members will see">
      <SectionRows>
        <SectionRow
          facts={<span data-testid="contest-members-will-see-event">{eventName}</span>}
          name={<span data-testid="contest-members-will-see-name">{name.trim() || 'Untitled contest'}</span>}
          note={<span data-testid="contest-members-will-see-rules">{rules}</span>}
          picture={<FormatIllustration className="h-full w-full" selectionType={selectionType} testId="contest-members-will-see-picture" />}
        />
      </SectionRows>
    </SectionCard>
  );
}
