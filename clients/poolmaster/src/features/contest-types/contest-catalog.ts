import { SUPPORTED_SPORTS, getSportDefinition, type SelectionType, type Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto } from '@/lib/api';

/**
 * One contest type on the contest types pages (#803): a format as one sport league offers it, on
 * one kind of event. It leads with its default template and lists the league's other templates of
 * that format as variations.
 */
export interface ContestTypeTile {
  key: string;
  selectionType: SelectionType;
  featured: ContestConfigTemplateDto;
  variations: ContestConfigTemplateDto[];
}

/** A sport league's contest types; a null id holds the templates offered on every event of the sport. */
export interface ContestCatalogLeague {
  sportLeagueId: string | null;
  name: string;
  tiles: ContestTypeTile[];
}

export interface ContestCatalogSport<Group> {
  sport: Sport;
  name: string;
  groups: Group[];
}

/** The default first, then by sort order, then by key, so a page reads the same on every load. */
function byFeaturedOrder(left: ContestConfigTemplateDto, right: ContestConfigTemplateDto) {
  return Number(right.isDefault) - Number(left.isDefault)
    || left.sortOrder - right.sortOrder
    || left.templateKey.localeCompare(right.templateKey);
}

function groupBy<Item>(items: readonly Item[], keyOf: (item: Item) => string) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function toTiles(templates: readonly ContestConfigTemplateDto[]): ContestTypeTile[] {
  return groupBy(templates, (template) => `${template.eventType ?? 'any'}/${template.selectionType}`)
    .map((group) => {
      const [featured, ...variations] = [...group].sort(byFeaturedOrder) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
      return {
        key: `${featured.sportLeagueId ?? 'any'}/${featured.eventType ?? 'any'}/${featured.selectionType}`,
        selectionType: featured.selectionType,
        featured,
        variations,
      };
    })
    .sort((left, right) => byFeaturedOrder(left.featured, right.featured));
}

/**
 * The league contest types page's catalog: each sport in the platform's order, its templates for
 * every event first and then each sport league's by name, one tile per format and kind of event.
 * `leagueNames` names each sport league; a sport league it does not name is left out, as is a
 * sport with no templates.
 */
export function buildLeagueContestCatalog(
  templates: readonly ContestConfigTemplateDto[],
  leagueNames: ReadonlyMap<string, string>,
): ContestCatalogSport<ContestCatalogLeague>[] {
  return SUPPORTED_SPORTS.flatMap((sport) => {
    const definition = getSportDefinition(sport);
    const groups = groupBy(templates.filter((template) => template.sport === sport), (template) => template.sportLeagueId ?? '')
      .flatMap((group): ContestCatalogLeague[] => {
        const sportLeagueId = group[0]?.sportLeagueId ?? null;
        const name = sportLeagueId === null ? `Every ${definition.vocabulary.event.one}` : leagueNames.get(sportLeagueId);
        return name === undefined ? [] : [{ sportLeagueId, name, tiles: toTiles(group) }];
      })
      .sort((left, right) => Number(left.sportLeagueId !== null) - Number(right.sportLeagueId !== null)
        || left.name.localeCompare(right.name));
    return groups.length ? [{ sport, name: definition.name, groups }] : [];
  });
}

/**
 * The public How to Play page's catalog: each sport's formats, one tile each, led by the format's
 * default of the first sport league to offer it, with no variations. Sport leagues go unnamed, so
 * the page needs no sign-in to read them.
 */
export function buildPublicContestCatalog(templates: readonly ContestConfigTemplateDto[]): ContestCatalogSport<ContestTypeTile>[] {
  return SUPPORTED_SPORTS.flatMap((sport) => {
    const definition = getSportDefinition(sport);
    const groups = groupBy(templates.filter((template) => template.sport === sport), (template) => template.selectionType)
      .map((group) => {
        const [featured] = [...group].sort(byFeaturedOrder) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
        return { key: `${sport}/${featured.selectionType}`, selectionType: featured.selectionType, featured, variations: [] };
      })
      .sort((left, right) => definition.selectionTypes.indexOf(left.selectionType) - definition.selectionTypes.indexOf(right.selectionType));
    return groups.length ? [{ sport, name: definition.name, groups }] : [];
  });
}
