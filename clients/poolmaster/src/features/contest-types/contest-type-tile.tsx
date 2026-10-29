import type { ContestConfigTemplateDto } from '@/lib/api';
import { formatSelectionTypeName } from '@poolmaster/shared/domain';
import { SELECTION_TYPE_ICONS } from '@/features/contests/selection-type-icons';
import { Heading, LinkButton, Tile } from '@/features/shared/ui';
import type { ContestTypeTile } from './contest-catalog';

interface ContestTypeTileCardProps {
  tile: ContestTypeTile;
  /**
   * Where each template's "Create this contest" link goes, for a commissioner: null when no event
   * is coming up to create it on. Left out, the tile only shows the contest type, as members see it.
   */
  createPathFor?: (template: ContestConfigTemplateDto) => string | null;
}

/** A contest type: its format, its default template by name and description, and its variations. */
export function ContestTypeTileCard({ tile, createPathFor }: ContestTypeTileCardProps) {
  const Icon = SELECTION_TYPE_ICONS[tile.selectionType];
  const { featured, variations } = tile;
  const featuredPath = createPathFor?.(featured);
  return (
    <Tile className="flex h-full flex-col gap-3" data-testid={`contest-type-${featured.templateKey}`} padding="sm" radius="md">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        <Icon aria-hidden="true" className="h-4 w-4" />
        {formatSelectionTypeName(tile.selectionType)}
      </div>
      <div className="space-y-1">
        <Heading level={4} variant="subtitle">{featured.name}</Heading>
        <p className="text-sm text-muted-foreground">{featured.description}</p>
      </div>
      {variations.length ? (
        <div className="space-y-2 border-t border-border pt-3" data-testid={`contest-type-${featured.templateKey}-variations`}>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Also try</p>
          <ul className="space-y-2">
            {variations.map((variation) => {
              const variationPath = createPathFor?.(variation);
              return (
                <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={variation.id}>
                  <span title={variation.description}>{variation.name}</span>
                  {variationPath ? (
                    <LinkButton
                      data-testid={`contest-type-create-${variation.templateKey}`}
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
            <LinkButton data-testid={`contest-type-create-${featured.templateKey}`} size="sm" to={featuredPath}>
              Create this contest
            </LinkButton>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid={`contest-type-no-events-${featured.templateKey}`}>
              No upcoming events yet
            </p>
          )}
        </div>
      ) : null}
    </Tile>
  );
}
