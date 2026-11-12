import { SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';

/**
 * "Members will see": a contest drawn as its row reads to members, its name and event, then its
 * rules in a sentence. A setup form shows it above its buttons, outside the form's card, as the
 * commissioner's last check, and it follows every change to the form.
 */
export function MemberPreview({
  eventName,
  name,
  rules,
}: {
  eventName: string;
  /** The contest's name as typed; an empty one reads "Untitled contest". */
  name: string;
  /** The rules sentence members read. */
  rules: string;
}) {
  return (
    <SectionCard testId="contest-members-will-see" title="Members will see">
      <SectionRows>
        <SectionRow
          facts={<span data-testid="contest-members-will-see-rules">{rules}</span>}
          name={<span data-testid="contest-members-will-see-name">{`${name.trim() || 'Untitled contest'} · ${eventName}`}</span>}
        />
      </SectionRows>
    </SectionCard>
  );
}
