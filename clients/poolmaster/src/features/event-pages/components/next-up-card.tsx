import { Eyebrow, LinkButton, Tile } from '@/features/shared/ui';

/** What comes next on the calendar: its name and a link to its own page. */
export function NextUpCard({ actionLabel, name, testId, to }: {
  actionLabel: string;
  name: string;
  testId: string;
  to: string;
}) {
  return (
    <Tile className="flex flex-wrap items-center justify-between gap-4" data-testid={testId} padding="md" radius="md">
      <div>
        <Eyebrow>Next up</Eyebrow>
        <h2 className="title-card text-xl text-foreground">{name}</h2>
      </div>
      <LinkButton to={to} variant="secondary">{actionLabel}</LinkButton>
    </Tile>
  );
}
