/**
 * Event pages (#1007) against Postgres: the pages and offers the migrations seed, the Season slots
 * of a slot definition the pages read (#2010), and whether a squares offer still has a game to be
 * played on. No mocks.
 */
import { randomUUID } from 'node:crypto';
import {
  SelectionType,
  Sport,
  SportEventStatus,
  isUrlSegment,
} from '@poolmaster/shared/domain';
import { PrismaEventPageRepository } from '../../../packages/core-api/src/adapters';
import { createContestOpeningReader } from '../../../packages/core-api/src/modules/contest-management/wiring';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition, putEventInSlot, keyedSlotDefinitionId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const NOW = new Date('2030-01-10T12:00:00.000Z');

describe('Seeded event pages', () => {
  it('seeds Championship Weekend with the NFL bracket from the conference round first and primary, then NFL Squares, both shown with the conference championships slot', async () => {
    const pages = new PrismaEventPageRepository(getAppPrisma());

    const page = await pages.findByUrlSegments('football', 'championship-weekend');
    const offers = await pages.findOffers([page?.id ?? '']);
    const definitions = await getPrisma().sportLeagueCompetitionSlot.findMany({ where: { id: { in: offers.map((offer) => offer.sportLeagueCompetitionSlotId) } } });
    const keyOf = (id: string) => definitions.find((definition) => definition.id === id)?.key;

    expect(page).toMatchObject({ isActive: true, redirectTo: null });
    expect(offers.map((offer) => [offer.sportLeagueName, keyOf(offer.sportLeagueCompetitionSlotId), offer.template.templateKey, offer.bracketStartRound, offer.isPrimary])).toEqual([
      ['NFL', 'SEMIFINAL', 'nfl-bracket-doubling', 3, true],
      ['NFL', 'SEMIFINAL', 'nfl-squares', null, false],
    ]);
  });

  it('gives every page a valid URL segment and exactly one primary offer, and every offer an active template its sport league can use', async () => {
    const rows = await getPrisma().eventPage.findMany({
      include: { offers: { include: { template: true, sportLeague: { include: { sport: true } } } } },
    });

    expect(rows.length).toBeGreaterThan(0);
    const problems = rows.flatMap((page) => [
      ...(isUrlSegment(page.urlSegment) ? [] : [`${page.urlSegment}: not a valid URL segment`]),
      ...(page.offers.filter((offer) => offer.isPrimary).length === 1 ? [] : [`${page.urlSegment}: not exactly one primary offer`]),
      ...page.offers.flatMap((offer) => [
        ...(offer.template.active ? [] : [`${page.urlSegment}: ${offer.template.templateKey} is inactive`]),
        ...(offer.sportLeague.sport.sport === page.sport ? [] : [`${page.urlSegment}: ${offer.template.templateKey} is another sport's`]),
        ...(offer.template.sportLeagueId === offer.sportLeagueId ? [] : [`${page.urlSegment}: ${offer.template.templateKey} is another sport league's`]),
        ...(offer.bracketStartRound === null || offer.template.selectionType === SelectionType.BRACKET ? [] : [`${page.urlSegment}: a starting round on ${offer.template.templateKey}, not a bracket`]),
      ]),
    ]);
    expect(problems).toEqual([]);
  });

  it('refuses a URL segment that is not lower case words joined by single dashes', async () => {
    const prisma = getPrisma();

    await expect(prisma.eventPage.create({ data: { sport: Sport.GOLF, urlSegment: 'The-Masters', displayOrder: 1 } })).rejects.toThrow();
    await expect(prisma.eventPage.create({ data: { sport: Sport.GOLF, urlSegment: 'the--masters', displayOrder: 1 } })).rejects.toThrow();
  });
});

describe('PrismaEventPageRepository page reads', () => {
  it('reads a retired page with the address it redirects to, and null for an address with no page', async () => {
    const prisma = getPrisma();
    const pages = new PrismaEventPageRepository(getAppPrisma());
    const target = await prisma.eventPage.create({ data: { sport: Sport.GOLF, urlSegment: `target-${randomUUID()}`, displayOrder: 998 } });
    const retired = await prisma.eventPage.create({
      data: { sport: Sport.GOLF, urlSegment: `retired-${randomUUID()}`, displayOrder: 999, isActive: false, redirectToPageId: target.id },
    });
    try {
      await expect(pages.findByUrlSegments('golf', retired.urlSegment)).resolves.toMatchObject({
        isActive: false,
        redirectTo: { sport: Sport.GOLF, sportUrlSegment: 'golf', urlSegment: target.urlSegment },
      });
      await expect(pages.findByUrlSegments('golf', `missing-${randomUUID()}`)).resolves.toBeNull();
    } finally {
      await prisma.eventPage.delete({ where: { id: retired.id } });
      await prisma.eventPage.delete({ where: { id: target.id } });
    }
  });

  it('reads no offers for no pages and no Season slots for no slot definitions', async () => {
    const pages = new PrismaEventPageRepository(getAppPrisma());

    await expect(pages.findOffers([])).resolves.toEqual([]);
    await expect(pages.findSlotsNotOver([])).resolves.toEqual([]);
  });
});

describe('Event page offers', () => {
  /** A throwaway golf page with the seeded primary offer's league and a copy of its template, removed after. */
  async function scratchPage(templateActive: boolean) {
    const prisma = getPrisma();
    const seeded = await prisma.eventPageOffer.findFirstOrThrow({ where: { isPrimary: true, eventPage: { urlSegment: 'championship-weekend' } }, include: { template: true } });
    const template = seeded.template;
    const copy = await prisma.contestConfigTemplate.create({
      data: {
        sportLeagueId: template.sportLeagueId,
        contestFormat: template.contestFormat,
        selectionType: template.selectionType,
        templateKey: `event-page-${randomUUID()}`,
        name: template.name,
        description: template.description,
        sortOrder: template.sortOrder,
        coverageMode: template.coverageMode,
        active: templateActive,
        configJson: template.configJson ?? {},
      },
    });
    const page = await prisma.eventPage.create({ data: { sport: Sport.GOLF, urlSegment: `scratch-${randomUUID()}`, displayOrder: 999 } });
    const offer = (sortOrder: number, isPrimary: boolean) => prisma.eventPageOffer.create({
      data: { eventPageId: page.id, sportLeagueId: seeded.sportLeagueId, sportLeagueCompetitionSlotId: seeded.sportLeagueCompetitionSlotId, templateId: copy.id, sortOrder, isPrimary },
    });
    const remove = async () => {
      await prisma.eventPage.delete({ where: { id: page.id } });
      await prisma.contestConfigTemplate.delete({ where: { id: copy.id } });
    };
    return { page, offer, remove };
  }

  it('refuses a second primary offer on one page, so one event alone heads it', async () => {
    const { offer, remove } = await scratchPage(true);
    try {
      await offer(1, true);
      await offer(2, false);

      await expect(offer(3, true)).rejects.toThrow();
    } finally {
      await remove();
    }
  });

  it('leaves out an offer whose setup is inactive, as Create contest refuses it', async () => {
    const { page, offer, remove } = await scratchPage(false);
    try {
      await offer(1, true);

      expect(await new PrismaEventPageRepository(getAppPrisma()).findOffers([page.id])).toEqual([]);
    } finally {
      await remove();
    }
  });

  it('leaves out an offer in a switched-off sport league, so no page or start link offers a league no provider syncs', async () => {
    const prisma = getPrisma();
    const { page, remove } = await scratchPage(true);
    const golf = await prisma.sport.findFirstOrThrow({ where: { sport: Sport.GOLF } });
    const switchedOff = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), sportId: golf.id, name: `Switched off ${randomUUID()}`, isActive: false } });
    const template = await prisma.contestConfigTemplate.findFirstOrThrow({ where: { active: true, sportLeague: { sport: { sport: Sport.GOLF } } } });
    const definitionId = await keyedSlotDefinitionId(prisma, switchedOff.id, 'SCRATCH');
    try {
      await prisma.eventPageOffer.create({
        data: { eventPageId: page.id, sportLeagueId: switchedOff.id, sportLeagueCompetitionSlotId: definitionId, templateId: template.id, sortOrder: 1, isPrimary: true },
      });

      expect(await new PrismaEventPageRepository(getAppPrisma()).findOffers([page.id])).toEqual([]);
    } finally {
      await remove();
      await prisma.sportLeagueCompetitionSlot.deleteMany({ where: { sportLeagueId: switchedOff.id } });
      await prisma.sportLeaguePhase.deleteMany({ where: { sportLeagueId: switchedOff.id } });
      await prisma.sportLeague.delete({ where: { id: switchedOff.id } });
    }
  });
});

describe('PrismaEventPageRepository.findSlotsNotOver', () => {
  it('reads each slot definition asked for in one read, in the order asked: the event under way first, then the rest soonest first, leaving out finished ones and other definitions', async () => {
    const prisma = getPrisma();
    const { sportLeagueId } = await freshEventEdition(prisma);
    const key = `EVENT_PAGE_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
    const asked = await keyedSlotDefinitionId(prisma, sportLeagueId, key);
    const other = await keyedSlotDefinitionId(prisma, sportLeagueId, `${key}_OTHER`);
    const make = async (definitionId: string, name: string, championshipYear: number, status: SportEventStatus, startDate: string) => {
      const event = await prisma.sportEvent.create({
        data: { ...(await freshEventEdition(prisma, { championshipYear })), status, startDate: new Date(startDate), name },
      });
      await putEventInSlot(prisma, event.id, definitionId);
    };
    await make(asked, `${key} 2025`, 2025, SportEventStatus.COMPLETED, '2025-04-10T12:00:00.000Z');
    await make(asked, `${key} 2028`, 2028, SportEventStatus.DRAFT, '2028-04-10T12:00:00.000Z');
    await make(asked, `${key} 2027`, 2027, SportEventStatus.SCHEDULED, '2027-04-10T12:00:00.000Z');
    await make(asked, `${key} 2026`, 2026, SportEventStatus.IN_PROGRESS, '2026-04-10T12:00:00.000Z');
    await make(asked, `${key} 2029`, 2029, SportEventStatus.CANCELLED, '2029-04-10T12:00:00.000Z');
    await make(other, `${key} other 2027`, 2027, SportEventStatus.SCHEDULED, '2027-01-10T12:00:00.000Z');
    const unasked = await keyedSlotDefinitionId(prisma, sportLeagueId, `${key}_EMPTY`);

    const slots = await new PrismaEventPageRepository(getAppPrisma()).findSlotsNotOver([other, asked, unasked]);

    expect(slots.map((each) => each.map((slot) => [slot.name, slot.championshipYear]))).toEqual([
      [[`${key} other 2027`, 2027]],
      [[`${key} 2026`, 2026], [`${key} 2027`, 2027], [`${key} 2028`, 2028]],
      [],
    ]);
  });
});

describe('createContestOpeningReader.nextSquaresKickoff', () => {
  it('gives the kickoff of the next game a squares contest could still be played on, and none once the last is cancelled', async () => {
    const prisma = getPrisma();
    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma, { sport: Sport.FOOTBALL })),
        name: 'Event page squares', startDate: new Date('2030-01-09T18:00:00.000Z'), status: SportEventStatus.IN_PROGRESS,
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: sportEvent.id, roundNumber: 1, scheduledDate: sportEvent.startDate } });
    await prisma.sportEventRoundMatch.create({
      data: { sportEventId: sportEvent.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: false, status: 'COMPLETED', scheduledDate: sportEvent.startDate },
    });
    const ahead = await prisma.sportEventRoundMatch.create({
      data: { sportEventId: sportEvent.id, sportEventRoundId: round.id, matchNumber: 2, isNeutralSite: false, scheduledDate: new Date('2030-01-24T20:00:00.000Z') },
    });
    const reader = createContestOpeningReader(getAppPrisma());
    const state = await reader.findById(sportEvent.id);
    if (state === null) throw new Error('The event was not read back.');

    expect(await reader.nextSquaresKickoff(state, NOW)).toEqual(new Date('2030-01-24T20:00:00.000Z'));
    await prisma.sportEventRoundMatch.update({ where: { id: ahead.id }, data: { status: 'CANCELLED' } });
    expect(await reader.nextSquaresKickoff(state, NOW)).toBeNull();
  });
});
