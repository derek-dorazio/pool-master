import { NumberedSteps } from '@/features/shared/ui';
import { StepIllustration, type StepPicture } from './illustrations';

/** How a pool runs, in three steps, each with its picture: How to Play and the sign-in page show the same ones. */
const HOW_IT_WORKS: readonly { picture: StepPicture; title: string; body: string }[] = [
  { picture: 'league', title: 'Start a league', body: 'A commissioner sets up a league for the office, the family or the group chat, and invites everyone with one link.' },
  { picture: 'contest', title: 'Pick a contest', body: 'Pick a contest type for a tournament, a race or a week of games. Members make their picks before it starts.' },
  { picture: 'live', title: 'Follow it live', body: 'The leaderboard updates as the event plays out, and the standings settle the moment it ends.' },
];

/**
 * The three steps with their pictures. How to Play shows each step's words and scrolls them on a
 * phone; `titlesOnly` sets them three across and compact, for the sign-in page.
 */
export function HowItWorksSteps({ testId, titlesOnly = false }: { testId: string; titlesOnly?: boolean }) {
  return (
    <NumberedSteps
      className={titlesOnly
        ? 'grid-cols-3 gap-3'
        : '-mx-1 auto-cols-[78%] grid-flow-col gap-3 overflow-x-auto px-1 pb-1 sm:auto-cols-[45%] md:grid-flow-row md:overflow-visible'}
      density={titlesOnly ? 'compact' : 'comfortable'}
      steps={HOW_IT_WORKS.map(({ body, picture, title }) => ({
        body: titlesOnly ? undefined : body,
        picture: <StepIllustration className="aspect-[16/10] w-full" step={picture} />,
        title,
      }))}
      testId={testId}
    />
  );
}
