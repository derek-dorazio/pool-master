import type { ContestStatus } from '@poolmaster/shared/domain';
import { useId, type ReactNode } from 'react';
import { Heading, HelpTip, StageTrack, Text, Tile } from '@/features/shared/ui';
import { CONTEST_LIFECYCLE_STAGES, contestLifecycleStage } from './contest-lifecycle';

/** One of the panel's numbers: the figure over its small-caps label. */
export type LifecycleStat = { label: string; testId: string; value: ReactNode };

/**
 * Manage contest's navy panel, the same for every stage: the lifecycle track with the contest's
 * stage current, one line on where things stand with the rule behind its (?), up to three numbers
 * (or, while it is set up, its checks as `children`), then the stage's actions: gold for the one
 * that moves the contest on, plain inverse for the rest.
 */
export function LifecyclePanel({
  actions,
  children,
  help,
  stats,
  status,
  title,
}: {
  actions?: ReactNode;
  /** What a stage shows in place of numbers, such as its readiness checks. */
  children?: ReactNode;
  /** The stage's rule, behind the title's (?). */
  help?: ReactNode;
  stats?: readonly LifecycleStat[];
  status: ContestStatus;
  title: ReactNode;
}) {
  const titleId = useId();
  return (
    <Tile
      as="section"
      aria-labelledby={titleId}
      className="grid gap-4 px-5 py-5"
      data-testid="contest-status-card"
      padding="none"
      radius="md"
      variant="inverse"
    >
      <StageTrack
        currentIndex={contestLifecycleStage(status).index}
        stages={CONTEST_LIFECYCLE_STAGES}
        surface="inverse"
        testId="contest-stage-track"
      />
      <div className="flex items-center gap-2">
        <Heading data-testid="contest-status-card-title" id={titleId} level={2} size="xl" tone="inherit" variant="card">
          {title}
        </Heading>
        {help ? (
          <HelpTip className="-my-2 shrink-0" label="How this stage works" surface="inverse" testId="contest-status-card-help">
            {help}
          </HelpTip>
        ) : null}
      </div>
      {stats?.length ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {stats.map((stat) => (
            <div className="flex flex-col-reverse" data-testid={stat.testId} key={stat.testId}>
              <dt><Text tone="onInverseLabel" variant="label">{stat.label}</Text></dt>
              <dd><Text size="xl" tone="onInverse" variant="value" weight="bold">{stat.value}</Text></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </Tile>
  );
}
