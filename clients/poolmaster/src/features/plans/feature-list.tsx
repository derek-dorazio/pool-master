import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Eyebrow, Icon, Text } from '@/features/shared/ui';
import { FeatureMark } from './feature-mark';

/**
 * A plan's feature list (#1590): a small-caps label, then one feature per line behind its mark.
 * The plan cards list what each plan adds with ticks; the move-down check lists what the lower
 * plan hides with dashes. Features are not data rows, so this is not a `SectionRow` list.
 */
export function FeatureList({
  features,
  label,
  labelAside,
  mark,
  testId,
}: {
  features: readonly string[];
  /** The list's small-caps label, such as "Everything in Pro, plus" or "Hidden on Free". */
  label: string;
  /** One help icon beside the label, for what the list means. */
  labelAside?: ReactNode;
  mark: FeatureMark;
  testId?: string;
}) {
  const isIncluded = mark === FeatureMark.INCLUDED;
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex items-center gap-1" data-testid={testId ? `${testId}-label` : undefined}>
        <Eyebrow tone="muted">{label}</Eyebrow>
        {labelAside}
      </div>
      <ul className="space-y-2" data-testid={testId ? `${testId}-items` : undefined}>
        {features.map((feature) => (
          <li className="flex gap-2" data-mark={mark} key={feature}>
            <Icon className="mt-0.5" data-testid={testId ? `${testId}-mark` : undefined} icon={isIncluded ? Check : Minus} size={16} tone={isIncluded ? 'primary' : 'muted'} />
            <Text tone={isIncluded ? 'default' : 'muted'}>{feature}</Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
