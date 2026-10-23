/**
 * The year in review (#872 slice 4, plan Q6): once a year is over, the league's commissioner
 * sends each squad's owners that squad's year, from a "Send the 2026 year in review" button on
 * Championships. Nothing runs on a timer: from 1 January the year before is ready to send, worked
 * out on read (its championship has a counted contest and nothing is recorded for it), and the
 * banner and button show until it is sent.
 *
 * The emails go first and the record after, so a send that fails partway can be pressed again:
 * each email's outbox key is the league, the year and the person, so nobody gets two.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ChampionshipRepository, LeagueRepository, LeagueYearReviewRepository, SquadMembershipRepository, UserRepository } from '@poolmaster/shared/db';
import { CupWeight, YearReviewStatus, championshipYear, trophyForPlace, type User } from '@poolmaster/shared/domain';
import { championshipName } from '../../mappers/championship.mapper';
import { cupName } from '../../mappers/cups.mapper';
import {
  buildSquadYearUrl,
  formatStandingPlace,
  formatTenthsOfPoints,
  formatUserName,
  type EmailService,
  type YearInReviewEmailData,
  type YearInReviewPlace,
} from '../email';
import { activeLeagueMembers, type LeagueMemberDeps } from '../notifications/league-members';
import type { HistoryService, SquadYearView } from './service';

export class YearReviewNotOpenError extends Error {
  readonly code = 'YEAR_REVIEW_NOT_OPEN';
}

export class YearReviewNothingToSendError extends Error {
  readonly code = 'YEAR_REVIEW_NOTHING_TO_SEND';
}

export class YearReviewAlreadySentError extends Error {
  readonly code = 'YEAR_REVIEW_ALREADY_SENT';
}

/** Where last year's review stands for the league. */
export interface YearReviewView {
  year: number;
  status: YearReviewStatus;
  sentAt: Date | null;
  /** Who sent it; null before it is sent, or once their account is gone. */
  sentBy: User | null;
}

export interface YearReviewServiceDeps extends LeagueMemberDeps {
  reviews: LeagueYearReviewRepository;
  finishes: Pick<ChampionshipRepository, 'findByLeagueYear'>;
  history: Pick<HistoryService, 'getLeagueSquadYears'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  users: LeagueMemberDeps['users'] & Pick<UserRepository, 'findById'>;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class YearReviewService {
  private readonly now: () => Date;

  constructor(private readonly deps: YearReviewServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Last year's review: nothing to send, ready, or sent and by whom. */
  async getLastYear(leagueId: string): Promise<YearReviewView> {
    const year = championshipYear(this.now()) - 1;
    const review = await this.deps.reviews.findByLeagueYear(leagueId, year);
    if (review !== null) {
      const sentBy = review.sentByUserId === null ? null : await this.deps.users.findById(review.sentByUserId);
      return { year, status: YearReviewStatus.SENT, sentAt: review.sentAt, sentBy };
    }
    const status = await this.hasCountedContest(leagueId, year) ? YearReviewStatus.READY : YearReviewStatus.NOTHING_TO_SEND;
    return { year, status, sentAt: null, sentBy: null };
  }

  /**
   * Sends last year's review: each active owner of an active squad that placed that year gets
   * their squad's year. 409s for another year, a year with nothing counted, or one already sent.
   */
  async send(leagueId: string, year: number, sentByUserId: string): Promise<YearReviewView> {
    const lastYear = championshipYear(this.now()) - 1;
    if (year !== lastYear) {
      this.deps.logger?.warn({ action: 'history.yearReview.notOpen', data: { leagueId, year, lastYear } }, 'Year in review asked for a year that is not last year');
      throw new YearReviewNotOpenError(`Only the ${String(lastYear)} year in review can be sent now.`);
    }
    if (await this.deps.reviews.findByLeagueYear(leagueId, year) !== null) {
      this.deps.logger?.warn({ action: 'history.yearReview.alreadySent', data: { leagueId, year } }, 'Year in review already sent');
      throw new YearReviewAlreadySentError(`The ${String(year)} year in review was already sent.`);
    }
    if (!await this.hasCountedContest(leagueId, year)) {
      this.deps.logger?.warn({ action: 'history.yearReview.nothingToSend', data: { leagueId, year } }, 'Year in review has nothing counted to send');
      throw new YearReviewNothingToSendError(`No championship contest counted in ${String(year)}.`);
    }
    const queued = await this.queueEmails(leagueId, year);
    // A second press racing this one finds the record already made; both sent the same emails once.
    await this.deps.reviews.create({ leagueId, year, sentByUserId });
    this.deps.logger?.info({ action: 'history.yearReview.sent', data: { leagueId, year, emailCount: queued } }, 'Sent the year in review');
    return this.getLastYear(leagueId);
  }

  private async hasCountedContest(leagueId: string, year: number): Promise<boolean> {
    const finishes = await this.deps.finishes.findByLeagueYear(leagueId, year);
    return finishes.some((finish) => finish.weight !== CupWeight.NOT_COUNTED);
  }

  /** One email per active owner of each squad that placed in the year; answers how many. */
  private async queueEmails(leagueId: string, year: number): Promise<number> {
    const league = await this.deps.leagues.findById(leagueId);
    if (league === null) return 0;
    const squadYears = (await this.deps.history.getLeagueSquadYears(leagueId, year)).flatMap((squadYear) => {
      const data = yearInReviewData(squadYear);
      return data === null ? [] : [{ squadYear, data }];
    });
    const [members, memberships] = await Promise.all([
      activeLeagueMembers(this.deps, leagueId),
      this.deps.squadMemberships.findBySquads(squadYears.map(({ squadYear }) => squadYear.squad.id)),
    ]);
    const membersById = new Map(members.map((member) => [member.id, member]));
    const squadsById = new Map(squadYears.map((row) => [row.squadYear.squad.id, row]));
    let queued = 0;
    for (const membership of memberships) {
      const user = membersById.get(membership.userId);
      const squad = squadsById.get(membership.squadId);
      if (user === undefined || squad === undefined) continue;
      await this.deps.email.send('YEAR_IN_REVIEW', {
        to: { email: user.email, userId: user.id, timeZone: user.timezone },
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
        about: `${league.id}:${String(year)}`,
        data: {
          ...squad.data,
          userName: formatUserName(user),
          leagueName: league.name,
          squadYearUrl: buildSquadYearUrl(this.deps.appBaseUrl, league.leagueCode, year),
        },
      });
      queued += 1;
    }
    return queued;
  }
}

/** A squad's year as its email tells it, or null when it placed in nothing that year. */
function yearInReviewData(squadYear: SquadYearView): Omit<YearInReviewEmailData, 'userName' | 'leagueName' | 'squadYearUrl'> | null {
  const { championship, year } = squadYear;
  const placed = championship !== null && championship.standing.played > 0 ? championship : null;
  const cups = squadYear.cups
    .filter((cup) => cup.standing.contestsCounted > 0)
    .map((cup): YearInReviewPlace => ({
      name: cupName(cup.view.cup.seasonYear, cup.view.sportLeagueName),
      place: formatStandingPlace(cup.standing),
      squadCount: cup.view.standings.length,
      points: formatTenthsOfPoints(cup.standing.points),
      trophy: cup.standing.trophy,
    }));
  if (placed === null && cups.length === 0) return null;
  return {
    squadName: squadYear.squad.name,
    year,
    championship: placed === null ? null : {
      name: championshipName(year, placed.cupName),
      place: formatStandingPlace(placed.standing),
      squadCount: placed.squadCount,
      points: formatTenthsOfPoints(placed.standing.points),
      trophy: placed.isOver ? trophyForPlace(placed.standing.position, placed.standing.points) : null,
    },
    medals: {
      firsts: placed?.standing.finishes[0] ?? 0,
      seconds: placed?.standing.finishes[1] ?? 0,
      thirds: placed?.standing.finishes[2] ?? 0,
      played: placed?.standing.played ?? 0,
    },
    cups,
  };
}
