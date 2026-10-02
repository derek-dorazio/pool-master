/**
 * Draft module — REST routes for roster-based selection.
 *
 * The route surface serves the independent selection modes (tiered and budget
 * pick). Any other configured SelectionType returns 501 DRAFT_MODE_UNSUPPORTED.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { type PrismaClient } from '@prisma/client';
import {
  deriveLegacyParticipantStatus,
  DraftStatus,
  SelectionType,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import {
  zodToJsonSchema,
  DraftStateQuerySchema,
  DraftStateResponseSchema,
  DraftPickResponseSchema,
  ErrorEnvelopeSchema,
  SubmitPickRequestSchema,
} from '@poolmaster/shared/dto';
import { ContestEntryPickService } from '../contest-entry-picks';
import { createErrorEnvelope } from '../../core/error-handler';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestRepository, PrismaLeagueMembershipRepository } from '../../adapters';
import { requireMemberOfLeague } from '../leagues/permissions';
import { createSportEventTierService } from '../events/wiring';
import type { ParticipantValuationView, SportEventTierGroup } from '../events/sport-event-tier-service';

type ContestConfigurationRecord = Awaited<ReturnType<PrismaClient['contestConfiguration']['findUnique']>>;
interface ContestRecord {
  id: string;
  name: string;
  leagueId: string;
  sportEventId: string | null;
  sportEventStartDate: Date | null;
  selectionType: string;
  status: string;
  lockAt: Date | null;
}
type ContestEntryRecord = Awaited<ReturnType<PrismaClient['contestEntry']['findMany']>>[number];
type MembershipRecord = Awaited<ReturnType<PrismaClient['leagueMembership']['findMany']>>[number];
type SquadMembershipRecord = Awaited<ReturnType<PrismaClient['squadMembership']['findMany']>>[number];
interface SelectionParticipantRecord {
  sportEventParticipantId: string;
  participantId: string;
  participantName: string;
  role?: string | null;
  teamAffiliation?: string | null;
  status?: string | null;
  price?: number;
  ranking?: number;
  tier?: string | null;
  orderIndex?: number;
  isAvailable: boolean;
  unavailableReason?: string;
}
type ContestEntryPickRecord = Awaited<ReturnType<PrismaClient['contestEntryPick']['findMany']>>[number];

interface SelectionGroupResponseRecord {
  groupId: string;
  groupName: string;
  groupNumber: number;
  picksFromGroup: number;
  selectedParticipantIds: string[];
  participants: Array<{
    sportEventParticipantId: string;
    participantId: string;
    participantName: string;
    role?: string | null;
    team?: string | null;
    status?: string | null;
    price?: number | null;
    ranking?: number | null;
    orderIndex?: number | null;
    isAvailable: boolean;
    unavailableReason?: string | null;
    isSelected: boolean;
  }>;
}

interface DraftContext {
  contest: ContestRecord;
  contestConfiguration: ContestConfigurationRecord;
  contestEntries: ContestEntryRecord[];
  memberships: MembershipRecord[];
  squadMemberships: SquadMembershipRecord[];
  selectionParticipants: SelectionParticipantRecord[];
  /** The contest's linked SportEvent's tiers, resolved once here (plans/124 §4.6b) — every group-by-tier call site reads this instead of re-deriving. */
  tiers: DraftTierConfig[];
}

interface DraftTierConfig {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
}

function sendWithStatus(reply: FastifyReply, statusCode: number, payload: unknown) {
  if (
    payload
    && typeof payload === 'object'
    && 'error' in payload
    && typeof (payload as { error?: unknown }).error === 'string'
    && 'message' in payload
    && typeof (payload as { message?: unknown }).message === 'string'
  ) {
    const errorPayload = payload as { error: string; message: string; details?: unknown };
    return reply.status(statusCode).send(
      createErrorEnvelope(errorPayload.error, errorPayload.message, errorPayload.details),
    );
  }
  return reply.status(statusCode).send(payload);
}

function draftErrorResponses(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((status) => [status, zodToJsonSchema(ErrorEnvelopeSchema)]),
  );
}

function isCommissionerRole(role: unknown): boolean {
  return role === 'COMMISSIONER';
}

function getRequestMembership(
  context: DraftContext,
  requestUserId?: string,
): MembershipRecord | undefined {
  if (!requestUserId) return undefined;
  return context.memberships.find((membership) => membership.userId === requestUserId);
}

function getIsCommissioner(
  context: DraftContext,
  requestUserId?: string,
): boolean {
  const membership = getRequestMembership(context, requestUserId);
  return membership ? isCommissionerRole(membership.role) : false;
}

function buildEntryUserIdMap(context: DraftContext): Map<string, string> {
  const membershipBySquadId = new Map<string, string>();
  for (const membership of context.squadMemberships) {
    if (!membershipBySquadId.has(membership.squadId)) {
      membershipBySquadId.set(membership.squadId, membership.userId);
    }
  }

  return new Map(
    context.contestEntries.map((entry) => [entry.id, membershipBySquadId.get(entry.squadId) ?? '']),
  );
}

function mapContestStatusToDraftStatus(
  contestStatus: string,
  isComplete: boolean,
): keyof typeof DraftStatus {
  if (isComplete || contestStatus === 'COMPLETED') return DraftStatus.COMPLETE;
  if (contestStatus === 'DRAFTING' || contestStatus === 'OPEN' || contestStatus === 'ACTIVE') {
    return DraftStatus.LIVE;
  }
  return DraftStatus.PENDING;
}

function getRosterSize(
  selectionType: string,
  contestConfiguration: ContestConfigurationRecord,
  tiers: DraftTierConfig[],
): number {
  if (selectionType === SelectionType.BUDGET_PICK) return contestConfiguration?.rosterSize ?? 0;
  if (selectionType === SelectionType.TIERED) {
    return tiers.reduce((sum, tier) => sum + tier.picksFromTier, 0);
  }
  return 0;
}

/**
 * Tiers are event-owned data now (plans/124 §4.6/§4.6b) — this is the one
 * place a SportEventTierGroup[] (already resolved via sport-event-tier-service) gets
 * turned into the draft room's DraftTierConfig[] shape. The legacy
 * tierConfig-JSON branch this replaced is gone; there's exactly one source
 * now. Per-golfer tier/price is a separate lookup (buildValuationLookup,
 * below) since a golfer can have a price with no tier at all.
 */
function buildDraftTiers(tierGroups: SportEventTierGroup[]): DraftTierConfig[] {
  return tierGroups.map((tier) => ({
    tierId: tier.tierKey,
    tierName: tier.label,
    tierNumber: tier.tierNumber,
    picksFromTier: tier.defaultPickCount,
    participantIds: tier.participants.map((participant) => participant.participantId),
  }));
}

/**
 * Per-golfer tier/price lookup, keyed by sportEventParticipantId. Sourced
 * from sport-event-tier-service.getEffectiveValuationsForSportEvent, not derived
 * from the tier-grouped shape above — a price-only valuation (e.g. a
 * budget-format contest, no tier assignment) would be invisible to any
 * lookup built by walking tier groups.
 */
function buildValuationLookup(
  valuations: ParticipantValuationView[],
): Map<string, { tierLabel: string | null; tierOrderIndex: number | null; price: number | null }> {
  return new Map(
    valuations.map((valuation) => [
      valuation.sportEventParticipantId,
      { tierLabel: valuation.tierLabel, tierOrderIndex: valuation.tierOrderIndex, price: valuation.price },
    ]),
  );
}

export async function loadDraftContext(prisma: PrismaClient, contestId: string): Promise<DraftContext | null> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      id: true,
      name: true,
      leagueId: true,
      sportEventId: true,
      sportEvent: {
        select: {
          startDate: true,
        },
      },
      selectionType: true,
      status: true,
      lockAt: true,
    },
  });
  if (!contest) return null;

  const sportEventTierService = createSportEventTierService(prisma);
  const [contestConfiguration, contestEntries, memberships, sportEventParticipants, tierGroups, valuations] = await Promise.all([
    prisma.contestConfiguration.findUnique({ where: { contestId } }),
    prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.leagueMembership.findMany({
      where: { leagueId: contest.leagueId },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    }),
    contest.sportEventId
      ? prisma.sportEventParticipant.findMany({
          where: { sportEventId: contest.sportEventId },
          include: {
            participant: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]),
    contest.sportEventId
      ? sportEventTierService.getEffectiveTiersForSportEvent(contest.sportEventId)
      : Promise.resolve([]),
    contest.sportEventId
      ? sportEventTierService.getEffectiveValuationsForSportEvent(contest.sportEventId)
      : Promise.resolve<ParticipantValuationView[]>([]),
  ]);
  const tiers = buildDraftTiers(tierGroups);
  const valuationBySportEventParticipantId = buildValuationLookup(valuations);

  const squadIds = Array.from(new Set(contestEntries.map((entry) => entry.squadId)));
  const squadMemberships = squadIds.length === 0
    ? []
    : await prisma.squadMembership.findMany({
        where: {
          squadId: { in: squadIds },
          status: SquadMembershipStatus.ACTIVE,
        },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      });

  return {
    contest: {
      id: contest.id,
      name: contest.name,
      leagueId: contest.leagueId,
      sportEventId: contest.sportEventId,
      sportEventStartDate: contest.sportEvent?.startDate ?? null,
      selectionType: contest.selectionType,
      status: contest.status,
      lockAt: contest.lockAt,
    },
    contestConfiguration,
    contestEntries,
    memberships,
    squadMemberships,
    selectionParticipants: sportEventParticipants.map((record) => {
      const valuation = valuationBySportEventParticipantId.get(record.id);
      const legacyStatus = deriveLegacyParticipantStatus(record.isActive, record.inactiveReason);
      const isAvailable = record.isActive;

      return {
        sportEventParticipantId: record.id,
        participantId: record.participantId,
        participantName: record.participant.name,
        role: record.participant.role,
        teamAffiliation: record.participant.teamAffiliation,
        status: legacyStatus,
        price: valuation?.price ?? undefined,
        ranking: record.ranking ?? undefined,
        tier: valuation?.tierLabel ?? null,
        orderIndex: valuation?.tierOrderIndex ?? undefined,
        isAvailable,
        unavailableReason: isAvailable
          ? undefined
          : `SportEventParticipant ${record.id} is unavailable with status ${legacyStatus}`,
      };
    }).sort((a, b) => {
      const orderDiff = (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      return a.participantName.localeCompare(b.participantName, undefined, { sensitivity: 'base' });
    }),
    tiers,
  };
}

function buildContestConfigurationResponse(
  contestConfiguration: ContestConfigurationRecord,
  tiers: DraftTierConfig[],
  rosterSize: number,
) {
  if (!contestConfiguration) return null;
  return {
    isExclusive: contestConfiguration.isExclusive,
    rounds: contestConfiguration.rounds ?? undefined,
    pickCount: contestConfiguration.pickCount ?? undefined,
    rosterSize: rosterSize || contestConfiguration.rosterSize || contestConfiguration.pickCount || contestConfiguration.rounds || undefined,
    budget: contestConfiguration.budget ?? undefined,
    timePerPickSeconds: contestConfiguration.timePerPickSeconds ?? undefined,
    picksPerPeriod: contestConfiguration.picksPerPeriod ?? undefined,
    roundValues: contestConfiguration.roundValues ?? undefined,
    startRound: contestConfiguration.startRound ?? undefined,
    tierConfig: tiers.length > 0
      ? tiers.map((tier) => ({
          tierId: tier.tierId,
          tierName: tier.tierName,
          tierNumber: tier.tierNumber,
          picksFromTier: tier.picksFromTier,
        }))
      : undefined,
  };
}

function buildSelectionGroups(
  selectionParticipants: SelectionParticipantRecord[],
  tiers: DraftTierConfig[],
  selectedSportEventParticipantIds: Set<string>,
): SelectionGroupResponseRecord[] {
  const participantByParticipantId = new Map(
    selectionParticipants.map((participant) => [participant.participantId, participant] as const),
  );

  return tiers.map((tier) => {
    const participants = tier.participantIds
      .map((participantId) => participantByParticipantId.get(participantId))
      .filter((participant): participant is SelectionParticipantRecord => Boolean(participant))
      .map((participant) => ({
        sportEventParticipantId: participant.sportEventParticipantId,
        participantId: participant.participantId,
        participantName: participant.participantName,
        role: participant.role ?? null,
        team: participant.teamAffiliation ?? null,
        status: participant.status ?? null,
        price: participant.price ?? null,
        ranking: participant.ranking ?? null,
        orderIndex: participant.orderIndex ?? null,
        isAvailable: participant.isAvailable,
        unavailableReason: participant.unavailableReason ?? null,
        isSelected: selectedSportEventParticipantIds.has(participant.sportEventParticipantId),
      }));

    return {
      groupId: tier.tierId,
      groupName: tier.tierName,
      groupNumber: tier.tierNumber,
      picksFromGroup: tier.picksFromTier,
      selectedParticipantIds: participants
        .filter((participant) => participant.isSelected)
        .map((participant) => participant.sportEventParticipantId),
      participants,
    };
  });
}

async function buildRosterSelectionResponse(
  prisma: PrismaClient,
  context: DraftContext,
  selectedEntryId?: string,
  requestUserId?: string,
) {
  const contestEntryById = new Map(context.contestEntries.map((entry) => [entry.id, entry]));
  const entryUserIdMap = buildEntryUserIdMap(context);
  const entryIds = context.contestEntries.map((entry) => entry.id);
  const tiers = context.tiers;
  const rosterSize = getRosterSize(context.contest.selectionType, context.contestConfiguration, tiers);
  const tierByParticipantId = new Map<string, DraftTierConfig>();
  const priceBySportEventParticipantId = new Map(
    context.selectionParticipants.map((participant) => [
      participant.sportEventParticipantId,
      participant.price,
    ] as const),
  );

  for (const tier of tiers) {
    for (const participantId of tier.participantIds) {
      tierByParticipantId.set(participantId, tier);
    }
  }

  const picks = entryIds.length === 0
    ? []
    : await prisma.contestEntryPick.findMany({
        where: { entryId: { in: entryIds } },
        include: {
          sportEventParticipant: {
            include: {
              participant: true,
            },
          },
        },
        orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }],
      });

  const picksByEntry = new Map<string, ContestEntryPickRecord[]>();
  for (const pick of picks) {
    const existing = picksByEntry.get(pick.entryId) ?? [];
    existing.push(pick);
    picksByEntry.set(pick.entryId, existing);
  }

  const entries = context.contestEntries.map((entry) => {
    const entryPicks = picksByEntry.get(entry.id) ?? [];
    return {
      id: entry.id,
      userId: entryUserIdMap.get(entry.id) ?? '',
      name: entry.name,
      isOnClock: false,
      pickCount: entryPicks.length,
    };
  });

  const myEntryId = requestUserId
    ? entries.find((entry) => entry.userId === requestUserId)?.id ?? null
    : null;
  const resolvedSelectedEntryId = selectedEntryId
    && entries.some((entry) => entry.id === selectedEntryId)
    ? selectedEntryId
    : myEntryId;
  const selectedEntry = resolvedSelectedEntryId
    ? entries.find((entry) => entry.id === resolvedSelectedEntryId) ?? null
    : null;
  const myEntryPicks = myEntryId ? picksByEntry.get(myEntryId) ?? [] : [];
  const selectedEntryPicks = resolvedSelectedEntryId ? picksByEntry.get(resolvedSelectedEntryId) ?? [] : [];
  const isCommissioner = getIsCommissioner(context, requestUserId);
  const selectedSportEventParticipantIds = new Set(
    selectedEntryPicks.map((pick) => pick.sportEventParticipantId),
  );
  const selectionGroups = buildSelectionGroups(
    context.selectionParticipants,
    tiers,
    selectedSportEventParticipantIds,
  );

  const pickIndexByEntry = new Map<string, number>();
  const pickIndexByEntryTier = new Map<string, number>();
  const pickDtos = picks.map((pick, index) => {
    const participant = pick.sportEventParticipant.participant;
    const entry = contestEntryById.get(pick.entryId);
    const tier = tierByParticipantId.get(pick.sportEventParticipant.participantId);
    const currentEntryPickIndex = (pickIndexByEntry.get(pick.entryId) ?? 0) + 1;
    pickIndexByEntry.set(pick.entryId, currentEntryPickIndex);

    const tierKey = `${pick.entryId}:${tier?.tierId ?? ''}`;
    const currentTierPickIndex = tier
      ? (pickIndexByEntryTier.get(tierKey) ?? 0) + 1
      : currentEntryPickIndex;
    if (tier) {
      pickIndexByEntryTier.set(tierKey, currentTierPickIndex);
    }

    const round = context.contest.selectionType === SelectionType.TIERED
      ? tier?.tierNumber ?? currentEntryPickIndex
      : currentEntryPickIndex;

    return {
      pickNumber: pick.draftPickNumber ?? index + 1,
      round,
      pickInRound: pick.draftRound ?? currentTierPickIndex,
      entryId: pick.entryId,
      entryName: entry?.name ?? pick.entryId,
      participantId: pick.sportEventParticipantId,
      participantName: participant?.name ?? pick.sportEventParticipantId,
      role: participant?.role ?? undefined,
      team: participant?.teamAffiliation ?? undefined,
      price: priceBySportEventParticipantId.get(pick.sportEventParticipantId),
      tierId: tier?.tierId,
      tierName: tier?.tierName,
      autoPicked: pick.isAutoPicked,
      pickedAt: pick.pickedAt.toISOString(),
    };
  });

  const availableParticipantIds = context.contestConfiguration?.isExclusive
    ? context.selectionParticipants.flatMap((participant) => {
        if (!participant.isAvailable) return [];
        if (picks.some((pick) => pick.sportEventParticipantId === participant.sportEventParticipantId)) {
          return [];
        }
        return [participant.sportEventParticipantId];
      })
    : context.selectionParticipants.flatMap((participant) =>
        participant.isAvailable ? [participant.sportEventParticipantId] : [],
      );

  const isComplete = rosterSize > 0
    ? entries.every((entry) => (picksByEntry.get(entry.id)?.length ?? 0) >= rosterSize)
    : false;
  const status = mapContestStatusToDraftStatus(context.contest.status, isComplete);
  const canCurrentUserSubmit = myEntryId !== null
    && rosterSize > 0
    && myEntryPicks.length < rosterSize
    && status !== DraftStatus.COMPLETE;

  return {
    contestId: context.contest.id,
    contestName: context.contest.name,
    selectionType: context.contest.selectionType,
    isTurnBased: false,
    isCommissioner,
    rosterSize,
    contestConfiguration: buildContestConfigurationResponse(context.contestConfiguration, tiers, rosterSize),
    status,
    currentPickNumber: canCurrentUserSubmit ? myEntryPicks.length + 1 : myEntryPicks.length,
    currentRound: context.contest.selectionType === SelectionType.TIERED
      ? Math.min(myEntryPicks.length + 1, Math.max(rosterSize, 1))
      : Math.min(myEntryPicks.length + 1, Math.max(rosterSize, 1)),
    totalPicks: rosterSize * entries.length,
    totalRounds: rosterSize,
    currentEntryId: canCurrentUserSubmit ? myEntryId : null,
    currentEntryName: canCurrentUserSubmit ? entries.find((entry) => entry.id === myEntryId)?.name ?? null : null,
    myEntryId,
    isMyPick: canCurrentUserSubmit,
    currentTurnStartedAt: null,
    timePerPickSeconds: 0,
    entries: entries.map(({ pickCount: _pickCount, ...entry }) => entry),
    selectedEntryId: resolvedSelectedEntryId,
    selectedEntryName: selectedEntry?.name ?? null,
    tiebreakerValue: contestEntryById.get(resolvedSelectedEntryId ?? '')?.tiebreakerValue ?? null,
    selectionGroups,
    draftPickHistories: pickDtos,
    availableParticipantIds,
    isComplete,
  };
}

async function buildDraftStateResponse(
  prisma: PrismaClient,
  contestId: string,
  selectedEntryId?: string,
  requestUserId?: string,
) {
  const context = await loadDraftContext(prisma, contestId);
  if (!context) {
    return { kind: 'error' as const, statusCode: 404, payload: { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` } };
  }

  if (
    context.contest.selectionType === SelectionType.TIERED
    || context.contest.selectionType === SelectionType.BUDGET_PICK
  ) {
    return {
      kind: 'success' as const,
      payload: await buildRosterSelectionResponse(prisma, context, selectedEntryId, requestUserId),
      context,
    };
  }

  return {
    kind: 'error' as const,
    statusCode: 501,
    payload: {
      error: 'DRAFT_MODE_UNSUPPORTED',
      message: `${context.contest.selectionType} draft-room endpoints are not implemented yet`,
    },
  };
}

export function draftsModule(fastify: FastifyInstance): void {
  const prisma = getAppPrisma(fastify);
  // Module-scoped (one per fastify register) — see plans/117 §7.1; the service
  // resolves Contest.contestFormat in the same Prisma transaction at insert time.
  const pickService = new ContestEntryPickService(prisma, fastify.log);
  // #291 — the draft room shows every entry's picks, so reading it needs membership of the
  // contest's league, as every other contest read does.
  const requireContestLeagueMember = requireMemberOfLeague(
    new PrismaContestRepository(prisma),
    new PrismaLeagueMembershipRepository(prisma),
  );

  fastify.get('/:contestId', {
    schema: {
      tags: ['Drafts'],
      summary: 'Get current draft state for a contest',
      description:
        'Returns the current draft-room state for the contest, including queue, picks, timers, and selection availability. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getDraftState',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      querystring: zodToJsonSchema(DraftStateQuerySchema),
      response: {
        200: zodToJsonSchema(DraftStateResponseSchema),
        ...draftErrorResponses(401, 403, 404, 501),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { entryId } = (request.query ?? {}) as { entryId?: string };
      const requestUserId = request.authUser?.userId;
      const result = await buildDraftStateResponse(prisma, contestId, entryId, requestUserId);
      if (result.kind === 'error') {
        return sendWithStatus(reply, result.statusCode, result.payload);
      }
      return result.payload;
    },
  });

  fastify.post('/:contestId/pick', {
    schema: {
      tags: ['Drafts'],
      summary: 'Submit a draft pick',
      description:
        'Submits a draft pick for the current turn and returns the refreshed draft state after the selection is processed.',
      operationId: 'submitContestSelection',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: zodToJsonSchema(SubmitPickRequestSchema),
      response: {
        200: zodToJsonSchema(DraftPickResponseSchema),
        ...draftErrorResponses(400, 401, 403, 404, 501),
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { entryId, participantId } = request.body as {
        entryId: string;
        participantId: string;
      };
      const requestUserId = request.authUser?.userId;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }

      const requestedEntry = context.contestEntries.find((contestEntry) => contestEntry.id === entryId);
      if (!requestedEntry) {
        return sendWithStatus(reply, 404, { error: 'ENTRY_NOT_FOUND', message: `Entry ${entryId} was not found for contest ${contestId}` });
      }

      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'AUTH_SESSION_REQUIRED', message: 'Authenticated session required' });
      }

      const requestedSquadMembership = context.squadMemberships.find(
        (membership) => membership.squadId === requestedEntry.squadId && membership.userId === requestUserId,
      );
      if (!requestedSquadMembership) {
        return sendWithStatus(reply, 403, {
          error: 'DRAFT_ENTRY_ACCESS_DENIED',
          message: 'You can only submit draft picks for your own contest entry',
        });
      }

      if (
        context.contest.selectionType !== SelectionType.TIERED
        && context.contest.selectionType !== SelectionType.BUDGET_PICK
      ) {
        return sendWithStatus(reply, 501, {
          error: 'DRAFT_MODE_UNSUPPORTED',
          message: `${context.contest.selectionType} pick submission is not implemented yet`,
        });
      }

      const tiers = context.tiers;
      const rosterSize = getRosterSize(context.contest.selectionType, context.contestConfiguration, tiers);
      if (rosterSize <= 0) {
        return sendWithStatus(reply, 400, {
          error: 'SELECTION_CONFIG_INVALID',
          message: `Contest ${contestId} does not have a usable roster size or pick count`,
        });
      }

      const sportEventParticipant = await prisma.sportEventParticipant.findUnique({
        where: { id: participantId },
        include: { participant: true },
      });
      if (!sportEventParticipant || sportEventParticipant.sportEventId !== context.contest.sportEventId) {
        return sendWithStatus(reply, 400, {
          error: 'PARTICIPANT_NOT_IN_EVENT',
          message: `SportEventParticipant ${participantId} is not part of contest ${contestId}`,
        });
      }

      const canonicalParticipantId = sportEventParticipant.participantId;
      const selectionParticipant = context.selectionParticipants.find(
        (participant) => participant.sportEventParticipantId === participantId
          || participant.participantId === canonicalParticipantId,
      );
      if (!selectionParticipant) {
        return sendWithStatus(reply, 400, {
          error: 'PARTICIPANT_NOT_SELECTABLE',
          message: `SportEventParticipant ${participantId} is not selectable for contest ${contestId}`,
        });
      }
      if (!selectionParticipant.isAvailable) {
        return sendWithStatus(reply, 400, {
          error: 'PARTICIPANT_UNAVAILABLE',
          message:
            selectionParticipant.unavailableReason
            ?? `SportEventParticipant ${participantId} is unavailable`,
        });
      }

      const existingEntryPicks = await prisma.contestEntryPick.findMany({
        where: { entryId },
        include: {
          sportEventParticipant: true,
        },
        orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }],
      });
      const existingParticipantPick = existingEntryPicks.find((pick) => pick.sportEventParticipantId === participantId);
      if (existingParticipantPick && context.contest.selectionType === SelectionType.TIERED) {
        await prisma.contestEntryPick.delete({
          where: { id: existingParticipantPick.id },
        });
        return buildRosterSelectionResponse(prisma, context, entryId, requestUserId);
      }
      if (existingParticipantPick) {
        return sendWithStatus(reply, 400, {
          error: 'DUPLICATE_PICK',
          message: `SportEventParticipant ${participantId} is already on this entry`,
        });
      }

      const exclusiveTaken = context.contestConfiguration?.isExclusive
        ? await prisma.contestEntryPick.findFirst({
            where: {
              sportEventParticipantId: participantId,
              entry: {
                contestId,
              },
              entryId: { not: entryId },
            },
          })
        : null;
      if (exclusiveTaken) {
        return sendWithStatus(reply, 400, {
          error: 'PARTICIPANT_ALREADY_TAKEN',
          message: `SportEventParticipant ${participantId} is already selected by another entry`,
        });
      }

      let draftRound = existingEntryPicks.length + 1;
      let replacementPickId: string | null = null;
      if (context.contest.selectionType === SelectionType.TIERED) {
        const participantTier = selectionParticipant.tier;
        if (!participantTier) {
          return sendWithStatus(reply, 400, {
            error: 'TIER_MISSING',
            message: `SportEventParticipant ${participantId} is missing a tier assignment`,
          });
        }

        const tier = tiers.find((item) => item.tierId === participantTier || item.tierName === participantTier);
        if (!tier) {
          return sendWithStatus(reply, 400, {
            error: 'TIER_NOT_FOUND',
            message: `Tier ${participantTier} is not configured for contest ${contestId}`,
          });
        }

        const participantIdsInTier = new Set(tier.participantIds);
        const picksInTier = existingEntryPicks.filter((pick) =>
          participantIdsInTier.has(pick.sportEventParticipant.participantId),
        );
        if (picksInTier.length >= tier.picksFromTier) {
          replacementPickId = picksInTier[picksInTier.length - 1]?.id ?? null;
        }

        if (existingEntryPicks.length >= rosterSize && !replacementPickId) {
          return sendWithStatus(reply, 400, {
            error: 'ENTRY_COMPLETE',
            message: `Entry ${entryId} has already submitted all ${rosterSize} picks`,
          });
        }

        if (replacementPickId) {
          await prisma.contestEntryPick.delete({
            where: { id: replacementPickId },
          });
        }

        const effectivePicksInTierCount = replacementPickId
          ? tier.picksFromTier - 1
          : Math.min(picksInTier.length, tier.picksFromTier - 1);
        const roundsBeforeTier = tiers
          .filter((item) => item.tierNumber < tier.tierNumber)
          .reduce((sum, item) => sum + item.picksFromTier, 0);
        draftRound = roundsBeforeTier + effectivePicksInTierCount + 1;
      } else if (existingEntryPicks.length >= rosterSize) {
        return sendWithStatus(reply, 400, {
          error: 'ENTRY_COMPLETE',
          message: `Entry ${entryId} has already submitted all ${rosterSize} picks`,
        });
      }

      const globalPickCount = await prisma.contestEntryPick.count({
        where: {
          entry: {
            contestId,
          },
        },
      });

      // pool-master-rop.78.6 — go through ContestEntryPickService so the
      // denormalized contestFormat is read from the parent contest in the same
      // transaction (plans/117 §7.1 — "no insert path bypasses this").
      await pickService.createPick({
        entryId,
        sportEventParticipantId: participantId,
        draftRound,
        draftPickNumber: globalPickCount + 1,
        isAutoPicked: false,
      });

      return buildRosterSelectionResponse(prisma, context, entryId, requestUserId);
    },
  });
}
