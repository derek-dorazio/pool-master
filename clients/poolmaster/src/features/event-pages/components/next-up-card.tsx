import { Eyebrow, Heading, LinkButton, Tile } from '@/features/shared/ui';

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
        <Heading level={2} variant="card" size="xl">{name}</Heading>
      </div>
      <LinkButton to={to} variant="secondary">{actionLabel}</LinkButton>
    </Tile>
  );
}
