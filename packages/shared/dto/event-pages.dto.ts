/**
 * Event pages (#1007, `plans/event-landing-pages.md`): public pages for one event a fan would
 * name, each with its ways to play. Public reads: nothing here is about a league or a user.
 */
import { z } from 'zod';
import { EVENT_PAGE_SLUG_PATTERN, EventPageOfferState, Sport } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { ContestConfigTemplateDtoSchema } from './contest-management.dto';
import { registerSchema } from './schema-registry';

const EventPageSlugSchema = z.string().regex(EVENT_PAGE_SLUG_PATTERN).describe(
  'The page\'s URL name within its sport, such as championship-weekend: lower case letters and digits, words joined by single dashes. Stored, never derived from a name, and evergreen (it names the page, not a year). The web address is /play/<sport path segment>/<slug>.',
);

export const EventPageEditionDtoSchema = z.object({
  sportEventId: z.uuid().describe('The edition\'s sport event: the one Create contest starts on.'),
  name: z.string().describe('The edition\'s name, such as "Conference Championships".'),
  eventYear: z.number().int().describe('The year the edition is branded with.'),
  startDate: DateTimeSchema.describe('When the edition starts. For a NOT_YET offer, when it is expected.'),
  endDate: DateTimeSchema.nullable().describe('When the edition ends, when known.'),
}).describe('The edition of its series an offer is shown with: the one under way, or else the soonest upcoming that can still take the contest.');
export type EventPageEditionDto = z.infer<typeof EventPageEditionDtoSchema>;

export const EventPageOfferDtoSchema = z.object({
  id: z.uuid(),
  sportLeagueId: z.uuid().describe('The sport league whose series the offer runs on.'),
  sportLeagueName: z.string().describe('The sport league as screens away from its sport\'s own pages name it, such as "NFL".'),
  eventSeriesName: z.string().describe('The series the offer runs on, by name in its sport league, such as "NFL Playoffs".'),
  template: ContestConfigTemplateDtoSchema.describe('The contest setup the offer starts as: Create contest\'s ?template=.'),
  startsAtRound: z.number().int().min(1).nullable().describe('For a bracket, the round it starts at: the offer\'s own, else its template\'s (1 is the whole knockout). Null for any other selection type.'),
  sortOrder: z.number().int().describe('Where the offer sits on its page, first first.'),
  isPrimary: z.boolean().describe('The offer whose edition heads the page: its dates are the page\'s. A page has one.'),
  state: z.enum(EventPageOfferState).describe('OPEN: Create contest would take the contest on the edition now. NOT_YET: the edition is still to open (not released, field not loaded, or a later-round bracket\'s teams not set); show when it is expected from its start date.'),
  edition: EventPageEditionDtoSchema,
}).describe('One way to play on an event page: a contest setup on one sport league\'s series, with that series\' next edition. An offer whose series has no edition that can still take the contest is left out.');
export type EventPageOfferDto = z.infer<typeof EventPageOfferDtoSchema>;

export const EventPageDtoSchema = z.object({
  id: z.uuid(),
  sport: z.enum(Sport).describe('The sport the page belongs to; its URL\'s first segment is this sport\'s path segment.'),
  slug: EventPageSlugSchema,
  displayOrder: z.number().int().describe('Where the page sits among its sport\'s pages, lower first.'),
  isActive: z.boolean().describe('False for a retired page: it has no offers, and its URL goes to redirectTo, or says the page has moved.'),
  redirectTo: z.object({
    sport: z.enum(Sport),
    slug: EventPageSlugSchema,
  }).nullable().describe('For a retired page with a successor, the page its URL now goes to; null otherwise.'),
  offers: z.array(EventPageOfferDtoSchema).describe('The page\'s ways to play in order, each with its next edition. Offers with no edition left to take the contest are left out, so an active page can have none: it is between seasons.'),
}).describe('A public event page, such as Championship Weekend: a curated grouping of contest setups on the series a fan would call one event.');
export type EventPageDto = z.infer<typeof EventPageDtoSchema>;

export const EventPageResponseSchema = z.object({
  eventPage: EventPageDtoSchema,
}).describe('One event page.');
export type EventPageResponse = z.infer<typeof EventPageResponseSchema>;

export const EventPageListQuerySchema = z.object({
  sport: z.enum(Sport).optional().describe('Only this sport\'s pages. Omitted: every sport\'s.'),
  upcoming: z
    .boolean()
    .optional()
    .describe('true: only the pages with an edition coming, the one their primary offer shows, soonest first (#1202). Omitted or false: every active page, by sport then display order.'),
}).describe('Filters for the event page list.');
export type EventPageListQuery = z.infer<typeof EventPageListQuerySchema>;

export const EventPageListResponseSchema = z.object({
  eventPages: z.array(EventPageDtoSchema).describe('The active pages, by sport then display order, or soonest first when only the upcoming ones are asked for. A page between seasons has no offers.'),
}).describe('The active event pages.');
export type EventPageListResponse = z.infer<typeof EventPageListResponseSchema>;

registerSchema('EventPageEditionDto', EventPageEditionDtoSchema);
registerSchema('EventPageOfferDto', EventPageOfferDtoSchema);
registerSchema('EventPageDto', EventPageDtoSchema);
registerSchema('EventPageResponse', EventPageResponseSchema);
registerSchema('EventPageListQuery', EventPageListQuerySchema);
registerSchema('EventPageListResponse', EventPageListResponseSchema);
