import { NumberedSteps, StepStrip } from '@/features/shared/ui';
import { StepIllustration, type StepPicture } from './illustrations';

/** How a pool runs, in three steps, each with its picture: How to Play and the sign-in page show the same ones. */
const HOW_IT_WORKS: readonly { picture: StepPicture; title: string }[] = [
  { picture: 'league', title: 'Start a league' },
  { picture: 'contest', title: 'Pick a contest' },
  { picture: 'live', title: 'Follow it live' },
];

/** The three steps as How to Play's slim strip (#1701). */
export function HowItWorksStrip({ className, testId }: { className?: string; testId: string }) {
  return (
    <StepStrip
      className={className}
      steps={HOW_IT_WORKS.map(({ picture, title }) => ({
        picture: <StepIllustration className="aspect-[16/10] w-full" step={picture} />,
        title,
      }))}
      testId={testId}
    />
  );
}

/** The three steps with their pictures, three across and compact, for the sign-in page. */
export function HowItWorksSteps({ testId }: { testId: string }) {
  return (
    <NumberedSteps
      className="grid-cols-3 gap-3"
      density="compact"
      steps={HOW_IT_WORKS.map(({ picture, title }) => ({
        picture: <StepIllustration className="aspect-[16/10] w-full" step={picture} />,
        title,
      }))}
      testId={testId}
    />
  );
}
