import type { ContestConfigTemplateDto } from '@/lib/api';
import { ContestTemplateEventType, formatSelectionTypeName } from '@poolmaster/shared/domain';
import { SELECTION_TYPE_ICONS } from '@/features/contests/selection-type-icons';
import { Eyebrow, Heading, HelpTip, LinkButton, Text, Tile } from '@/features/shared/ui';
import type { ContestTypeTile } from './contest-catalog';

/** A kind of event as a tile names it beside its format, when its section offers the format on both. */
const EVENT_KIND_NAMES: Record<ContestTemplateEventType, string> = {
  [ContestTemplateEventType.WEEK]: 'Weekly',
  [ContestTemplateEventType.KNOCKOUT]: 'Playoffs',
};

interface ContestTypeTileCardProps {
  tile: ContestTypeTile;
  /** Names the sport league whose section holds it, so a sport-wide type under two leagues has two ids. */
  testId: string;
  /**
   * Where each template's "Create this contest" link goes, for a commissioner: null when no event
   * is coming up to create it on. Left out, the tile only shows the contest type, as members see it.
   */
  createPathFor?: (template: ContestConfigTemplateDto) => string | null;
}

/** A contest type: its format, its default template by name and description, and its variations. */
export function ContestTypeTileCard({ tile, createPathFor, testId }: ContestTypeTileCardProps) {
  const Icon = SELECTION_TYPE_ICONS[tile.selectionType];
  const { featured, variations } = tile;
  const featuredPath = createPathFor?.(featured);
  return (
    <Tile className="flex h-full flex-col gap-3" data-testid={`${testId}-${featured.templateKey}`} padding="sm">
      <Eyebrow className="flex items-center gap-2" tone="muted">
        <Icon aria-hidden="true" className="h-4 w-4" />
        {tile.sharesFormat && featured.eventType
          ? `${formatSelectionTypeName(tile.selectionType)} · ${EVENT_KIND_NAMES[featured.eventType]}`
          : formatSelectionTypeName(tile.selectionType)}
      </Eyebrow>
      <div className="space-y-1">
        <Heading level={4} variant="subtitle">{featured.name}</Heading>
        <Text as="p" variant="meta">{featured.description}</Text>
      </div>
      {variations.length ? (
        <div className="space-y-2 border-t border-border pt-3" data-testid={`${testId}-${featured.templateKey}-variations`}>
          <Eyebrow tone="muted">Also try</Eyebrow>
          <ul className="space-y-2">
            {variations.map((variation) => {
              const variationPath = createPathFor?.(variation);
              return (
                <li className="flex flex-wrap items-center justify-between gap-2" key={variation.id}>
                  <span className="flex items-center">
                    <Text>{variation.name}</Text>
                    <HelpTip className="-my-2" label={`How ${variation.name} works`} testId={`${testId}-${variation.templateKey}-help`}>
                      {variation.description}
                    </HelpTip>
                  </span>
                  {variationPath ? (
                    <LinkButton
                      data-testid={`${testId}-create-${variation.templateKey}`}
                      size="sm"
                      to={variationPath}
                      variant="subtle"
                    >
                      Create
                    </LinkButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {createPathFor ? (
        <div className="mt-auto pt-1">
          {featuredPath ? (
            <LinkButton data-testid={`${testId}-create-${featured.templateKey}`} size="sm" to={featuredPath}>
              Create this contest
            </LinkButton>
          ) : (
            <Text as="p" data-testid={`${testId}-no-events-${featured.templateKey}`} variant="meta">
              No upcoming events yet
            </Text>
          )}
        </div>
      ) : null}
    </Tile>
  );
}
