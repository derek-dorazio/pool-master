import type { ReactNode } from 'react';
import { Eyebrow, Heading } from '@/features/shared/ui';

/** A landing page section: its eyebrow, display title and intro over its content, and the address a menu link jumps to. */
export function LandingSection({ children, eyebrow, id, intro, testId, title }: {
  children: ReactNode;
  eyebrow?: string;
  id?: string;
  intro?: string;
  testId: string;
  title: string;
}) {
  return (
    <section className="scroll-mt-6 space-y-4" data-testid={testId} id={id}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <div className="space-y-2">
        <Heading level={2} variant="display">{title}</Heading>
        {intro ? <p className="max-w-2xl text-base text-muted-foreground">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}
