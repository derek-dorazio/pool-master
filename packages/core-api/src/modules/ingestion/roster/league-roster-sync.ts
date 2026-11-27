/**
 * A sport league's roster sync (#2025, plan §4), the ROSTER kind of the one sync framework: the
 * sync tick queues a SYNC_LEAGUE_ROSTER job for each synced league with a roster (its provider
 * mapping names the provider's codes for its positions), and the job reads the roster of the
 * league's current Season, asked for by the provider's own id for that Season, never a season
 * worked out from the clock.
 *
 * Each player the feed lists becomes a roster row naming their team and position by id:
 * - the team is the TEAM participant of the league the feed's team id is mapped to. A team id no
 *   team is mapped from skips the player and raises one UNMAPPED_PARTICIPANT finding per league,
 *   Provider and id, which mapping the team resolves;
 * - the position is the league's position whose provider code is the feed's, and only one whose
 *   players can be picked into a field (`isFieldEligible`). A code with no row is not one of the
 *   league's positions (the provider codes are inclusion only), and a player with none, or with an
 *   ineligible position, is left off the roster.
 * A player the feed names for the first time becomes an individual participant of the league with
 * its mapping; one it names differently is renamed. A player the feed no longer lists keeps their
 * row and is never deleted: the row's `lastSeenAt` says when they were last listed.
 *
 * Each try records one ROSTER sync run, COMPLETED with what it wrote or FAILED with why. A league
 * the provider's plan refuses, or one no longer synced, fails the job at once; anything else is
 * tried again by the runner.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSyncRunRepository, SportLeagueRepository, SportLeagueRosterRepository, SportLeagueSeasonRepository } from '@poolmaster/shared/db';
import {
  ProviderSyncKind,
  ProviderSyncRunStatus,
  type BackgroundJobOutcome,
  type ProviderCode,
  type ProviderSyncRun,
} from '@poolmaster/shared/domain';
import { errorMessage } from '../../../core/error-message';
import { PermanentBackgroundJobError, type BackgroundJobContext } from '../../background-jobs/background-job-runner';
import type { DomainEvents } from '../../domain-events/domain-events';
import { DomainEventType } from '../../domain-events/domain-event';
import { ProviderSeasonScheduleError, type ProviderSeasonScheduleReader } from '../../events/provider-season-schedule-reader';
import type { ProviderRosterPlayer } from '../core/provider-interface';
import type { ProviderSyncFindingService } from '../findings/provider-sync-finding-service';
import type { SyncLeagueRosterJobPayload } from './league-roster-sync-job';

/** The provider's refusals a retry cannot fix, as the events sync has them. */
const PERMANENT_SOURCE_ERRORS = new Set(['PROVIDER_NOT_FOUND', 'SPORT_LEAGUE_NOT_FOUND', 'SPORT_LEAGUE_NOT_SYNCED', 'PROVIDER_LEAGUE_REFUSED', 'PROVIDER_LEAGUE_UNKNOWN']);

export interface LeagueRosterSyncOptions {
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  seasons: Pick<SportLeagueSeasonRepository, 'findForSync'>;
  rosterSource: Pick<ProviderSeasonScheduleReader, 'listSeasonRoster'>;
  rosters: SportLeagueRosterRepository;
  findings: Pick<ProviderSyncFindingService, 'raiseUnmappedParticipants' | 'checkRunOutcome'>;
  syncRuns: Pick<ProviderSyncRunRepository, 'create' | 'update'>;
  domainEvents: Pick<DomainEvents, 'collect'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** What one roster sync wrote, as its run's stats and the job's result keep them. */
export interface RosterSyncCounts {
  /** Players the feed listed. */
  listed: number;
  /** Players on the roster: a row of theirs written or seen. */
  rostered: number;
  /** New participants for players named for the first time. */
  playersCreated: number;
  /** Roster rows created, or pointed at a new team or position. */
  rowsChanged: number;
  /** Players left off: no eligible position of the league. */
  notEligible: number;
  /** Players left off: their team is not mapped. */
  teamUnmapped: number;
}

export class LeagueRosterSync {
  private readonly now: () => Date;

  constructor(private readonly options: LeagueRosterSyncOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** The SYNC_LEAGUE_ROSTER job. */
  async run(payload: SyncLeagueRosterJobPayload, context: Pick<BackgroundJobContext, 'jobId' | 'trigger'>): Promise<BackgroundJobOutcome> {
    const sportLeague = await this.options.sportLeagues.findById(payload.sportLeagueId);
    if (!sportLeague) throw new PermanentBackgroundJobError(`Sport league ${payload.sportLeagueId} no longer exists`);
    const selected = sportLeague.selectedProviderMapping;
    if (selected === null) throw new PermanentBackgroundJobError(`No provider syncs ${sportLeague.name} any more`);
    const seasons = await this.options.seasons.findForSync(sportLeague.id, selected.id);
    const current = seasons.find((season) => season.id === sportLeague.currentSeasonId);

    const startedAt = this.now();
    const run = await this.options.syncRuns.create({
      providerCode: selected.providerCode,
      kind: ProviderSyncKind.ROSTER,
      trigger: context.trigger,
      sportLeagueId: sportLeague.id,
      sportEventId: null,
      backgroundJobId: context.jobId,
      status: ProviderSyncRunStatus.IN_PROGRESS,
      startedAt,
      completedAt: null,
      summary: `Syncing ${sportLeague.name}'s roster.`,
      stats: {},
      changedCount: null,
      errorCount: 0,
      createdAt: startedAt,
    });

    // Nothing works out a Season from the clock: with no current Season the provider has an id for, nothing is read.
    if (current === undefined || current.providerSeasonId === null) {
      await this.complete(run, startedAt, `${sportLeague.name} has no current Season ${selected.providerName} has an id for, so no roster was read.`, emptyCounts());
      return { changedCount: 0, result: { syncRunId: run.id, ...emptyCounts() } };
    }

    let counts: RosterSyncCounts;
    try {
      const roster = await this.options.rosterSource.listSeasonRoster(sportLeague.id, current.providerSeasonId);
      counts = await this.writeRoster({ sportLeagueId: sportLeague.id, sportLeagueSeasonId: current.id, providerCode: selected.providerCode, providerSourceId: selected.providerId, sportLeagueProviderMappingId: selected.id }, roster);
    } catch (error) {
      await this.failRun(run, startedAt, error);
      this.options.logger?.error({
        action: 'ingestion.rosterSync.failed',
        data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, syncRunId: run.id, error: errorMessage(error) },
      }, 'A sport league\'s roster sync failed');
      if (error instanceof ProviderSeasonScheduleError && PERMANENT_SOURCE_ERRORS.has(error.code)) {
        throw new PermanentBackgroundJobError(`${error.code}: ${error.message}`, { cause: error });
      }
      throw error;
    }

    await this.complete(
      run,
      startedAt,
      `Synced ${sportLeague.name}'s ${current.name} roster: ${String(counts.rostered)} of ${String(counts.listed)} players rostered, ${String(counts.rowsChanged)} rows changed, ${String(counts.playersCreated)} players new.`,
      counts,
    );
    this.options.logger?.info({
      action: 'ingestion.rosterSync.completed',
      data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, sportLeagueSeasonId: current.id, syncRunId: run.id, ...counts },
    }, 'A sport league\'s roster sync finished');
    return { changedCount: counts.rowsChanged + counts.playersCreated, result: { syncRunId: run.id, sportLeagueSeasonId: current.id, ...counts } };
  }

  /** The roster's players on the Season's rows, in a fixed few reads and one write. */
  private async writeRoster(
    league: { sportLeagueId: string; sportLeagueSeasonId: string; providerCode: ProviderCode; providerSourceId: string; sportLeagueProviderMappingId: string },
    roster: readonly ProviderRosterPlayer[],
  ): Promise<RosterSyncCounts> {
    // A provider naming the same player twice is taken at its last word.
    const players = [...new Map(roster.map((player) => [player.externalId, player])).values()];
    const eligible = new Map((await this.options.rosters.findPositionCodes(league.sportLeagueProviderMappingId))
      .filter((code) => code.isFieldEligible)
      .map((code) => [code.providerCode, code.sportLeaguePositionId]));
    const placed = players.flatMap((player) => {
      const sportLeaguePositionId = player.positionCode === null ? undefined : eligible.get(player.positionCode);
      return sportLeaguePositionId === undefined || player.teamExternalId === null ? [] : [{ player, teamExternalId: player.teamExternalId, sportLeaguePositionId }];
    });
    const ids = await this.options.rosters.findRosterIds({
      sportLeagueId: league.sportLeagueId,
      sportLeagueSeasonId: league.sportLeagueSeasonId,
      providerCode: league.providerCode,
      teamExternalIds: [...new Set(placed.map((entry) => entry.teamExternalId))],
      playerExternalIds: placed.map((entry) => entry.player.externalId),
    });

    const unmappedTeams = new Map<string, string>();
    const newPlayers: Array<{ participantId: string; externalId: string; name: string }> = [];
    const renamedPlayers: Array<{ participantId: string; name: string }> = [];
    const rows: Array<{ participantId: string; teamParticipantId: string; sportLeaguePositionId: string }> = [];
    const seenPlayerIds: string[] = [];
    for (const { player, teamExternalId, sportLeaguePositionId } of placed) {
      const teamParticipantId = ids.teamIdByExternalId.get(teamExternalId);
      if (teamParticipantId === undefined) {
        unmappedTeams.set(teamExternalId, `${player.name}'s team`);
        continue;
      }
      const known = ids.playerByExternalId.get(player.externalId);
      const participantId = known?.participantId ?? randomUUID();
      if (known === undefined) newPlayers.push({ participantId, externalId: player.externalId, name: player.name });
      // poolmaster-allow-name-match: a rename check of the player found by their feed id, not a lookup
      else if (known.name !== player.name) renamedPlayers.push({ participantId, name: player.name });
      const row = ids.rowByPlayerId.get(participantId);
      if (row?.teamParticipantId !== teamParticipantId || row.sportLeaguePositionId !== sportLeaguePositionId) {
        rows.push({ participantId, teamParticipantId, sportLeaguePositionId });
      }
      seenPlayerIds.push(participantId);
    }

    // The new players' mappings follow up as any new mapping does (#2069).
    const followUps = newPlayers.length === 0 ? null : await this.options.domainEvents.collect({
      type: DomainEventType.PARTICIPANT_PROVIDER_MAPPED,
      sportLeagueId: league.sportLeagueId,
      providerId: ids.providerId,
      externalIds: newPlayers.map((player) => player.externalId),
    });
    await this.options.rosters.applyRoster({
      sportLeagueId: league.sportLeagueId,
      sportLeagueSeasonId: league.sportLeagueSeasonId,
      providerId: ids.providerId,
      newPlayers,
      renamedPlayers,
      rows,
      seenPlayerIds,
      seenAt: this.now(),
      jobs: followUps?.jobs ?? [],
    });
    followUps?.queued();

    await this.options.findings.raiseUnmappedParticipants({
      sportLeagueId: league.sportLeagueId,
      providerSourceId: league.providerSourceId,
      participants: [...unmappedTeams].map(([externalId, name]) => ({ externalId, name })),
    });
    const teamUnmapped = placed.filter((entry) => !ids.teamIdByExternalId.has(entry.teamExternalId)).length;
    return {
      listed: players.length,
      rostered: seenPlayerIds.length,
      playersCreated: newPlayers.length,
      rowsChanged: rows.length,
      notEligible: players.length - placed.length,
      teamUnmapped,
    };
  }

  private async complete(run: ProviderSyncRun, startedAt: Date, summary: string, counts: RosterSyncCounts): Promise<void> {
    await this.options.syncRuns.update(run.id, {
      status: ProviderSyncRunStatus.COMPLETED,
      startedAt,
      completedAt: this.now(),
      summary,
      stats: { ...counts },
      changedCount: counts.rowsChanged + counts.playersCreated,
      errorCount: 0,
    });
    await this.options.findings.checkRunOutcome(run, ProviderSyncRunStatus.COMPLETED);
  }

  private async failRun(run: ProviderSyncRun, startedAt: Date, error: unknown): Promise<void> {
    const message = errorMessage(error);
    await this.options.syncRuns.update(run.id, {
      status: ProviderSyncRunStatus.FAILED,
      startedAt,
      completedAt: this.now(),
      summary: `Failed: ${message}`,
      stats: {},
      changedCount: null,
      errorCount: 1,
      details: {
        failurePayload: {
          error: {
            ...(error instanceof Error && { name: error.name }),
            message,
            ...(error instanceof ProviderSeasonScheduleError && { code: error.code }),
          },
        },
      },
    });
    await this.options.findings.checkRunOutcome(run, ProviderSyncRunStatus.FAILED);
  }
}

function emptyCounts(): RosterSyncCounts {
  return { listed: 0, rostered: 0, playersCreated: 0, rowsChanged: 0, notEligible: 0, teamUnmapped: 0 };
}
