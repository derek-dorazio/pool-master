import { SPORTS_BY_POPULARITY, SUPPORTED_SPORTS, getSportDefinition, type SelectionType, type Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportLeagueDto } from '@/lib/api';

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

/** A sport league on the public How to Play page: the formats it offers, its own and its sport's. */
export interface PublicCatalogLeague {
  sportLeagueId: string;
  /** What the page calls it beside other sports' leagues: "NCAA Men's Basketball", not "NCAA Division I Men". */
  name: string;
  /** Its name in the page's link: `?sport=basketball&league=wnba`. */
  slug: string;
  groups: ContestTypeTile[];
}

export interface PublicCatalogSport extends ContestCatalogSport<ContestTypeTile> {
  leagues: PublicCatalogLeague[];
}

/** A name as the page's link spells it: `NCAA Division I Men` is `ncaa-division-i-men`, `Copa América` is `copa-america`. */
export function catalogSlug(name: string) {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * One tile per format, in the sport's format order, each led by the default of the templates
 * `preferred` puts first, with no variations.
 */
function toFormatTiles(
  key: string,
  templates: readonly ContestConfigTemplateDto[],
  selectionTypes: readonly SelectionType[],
  preferred: (template: ContestConfigTemplateDto) => boolean,
): ContestTypeTile[] {
  return groupBy(templates, (template) => template.selectionType)
    .map((group) => {
      const [featured] = [...group].sort((left, right) => Number(preferred(right)) - Number(preferred(left)) || byFeaturedOrder(left, right)) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
      return { key: `${key}/${featured.selectionType}`, selectionType: featured.selectionType, featured, variations: [] };
    })
    .sort((left, right) => selectionTypes.indexOf(left.selectionType) - selectionTypes.indexOf(right.selectionType));
}

/** Sport leagues in their display order, the NFL before the College Football Playoff; unordered ones after, by name. */
function bySportLeagueDisplayOrder(left: SportLeagueDto, right: SportLeagueDto) {
  return (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER)
    || (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name);
}

/**
 * The public How to Play page's catalog: each sport, the most popular first, with its formats,
 * one tile each, led by the format's default of the first sport league to offer it; then each of
 * its active sport leagues in display order, with the formats it offers, its own templates leading
 * its sport's. A sport league that offers none is left out, as is a sport with no templates.
 */
export function buildPublicContestCatalog(
  templates: readonly ContestConfigTemplateDto[],
  sportLeagues: readonly SportLeagueDto[],
): PublicCatalogSport[] {
  return SPORTS_BY_POPULARITY.flatMap((sport) => {
    const definition = getSportDefinition(sport);
    const sportTemplates = templates.filter((template) => template.sport === sport);
    const groups = toFormatTiles(sport, sportTemplates, definition.selectionTypes, () => false);
    const leagues = sportLeagues
      .filter((sportLeague) => sportLeague.sport === sport && sportLeague.isActive)
      .sort(bySportLeagueDisplayOrder)
      .map((sportLeague) => ({
        sportLeagueId: sportLeague.id,
        name: sportLeague.displayName ?? sportLeague.name,
        slug: catalogSlug(sportLeague.name),
        groups: toFormatTiles(
          `${sport}/${sportLeague.id}`,
          sportTemplates.filter((template) => template.sportLeagueId === null || template.sportLeagueId === sportLeague.id),
          definition.selectionTypes,
          (template) => template.sportLeagueId === sportLeague.id,
        ),
      }))
      .filter((league) => league.groups.length > 0);
    return groups.length ? [{ sport, name: definition.name, groups, leagues }] : [];
  });
}
