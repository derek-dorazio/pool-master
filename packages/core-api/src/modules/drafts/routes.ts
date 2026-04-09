/**
 * Draft module — REST routes for async snake draft and roster-based selection.
 *
 * The route surface is shared by snake drafts plus roster-based selection modes
 * such as tiered and budget pick so the web draft room can consume one honest
 * contract instead of frontend-only mock state.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  DraftStatus,
  SelectionType,
} from '@poolmaster/shared/domain';
import {
  zodToJsonSchema,
  DraftStateResponseSchema,
  DraftPickResponseSchema,
  ExtendCurrentTurnRequestSchema,
  StartDraftRequestSchema,
  SubmitPickRequestSchema,
} from '@poolmaster/shared/dto';
import {
  PrismaContestEntryRepository,
} from '../../adapters';
import crypto from 'node:crypto';
import { SnakeDraftEngine } from './engine/snake-draft-engine';
import type { DraftState } from './engine/snake-draft-engine';
import {
  startSession,
  isPickExpired,
  pauseSession,
  resumeSession,
  extendCurrentTurn,
} from './engine/draft-session-manager';
import type { SessionState } from './engine/draft-session-manager';
import { draftStore } from './storage/draft-store';
import { draftQueue } from './engine/draft-queue';

const engine = new SnakeDraftEngine();

type ContestConfigurationRecord = Awaited<ReturnType<PrismaClient['contestConfiguration']['findUnique']>>;
interface ContestRecord {
  id: string;
  name: string;
  leagueId: string;
  sportEventId: string | null;
  selectionType: string;
  status: string;
  lockAt: Date | null;
}
type ContestEntryRecord = Awaited<ReturnType<PrismaClient['contestEntry']['findMany']>>[number];
type MembershipRecord = Awaited<ReturnType<PrismaClient['leagueMembership']['findMany']>>[number];
type SquadMembershipRecord = Awaited<ReturnType<PrismaClient['squadMembership']['findMany']>>[number];
type SportEventParticipantWithParticipantRecord = Awaited<
  ReturnType<
    PrismaClient['sportEventParticipant']['findMany']
  >
>[number] & {
  participant: Awaited<ReturnType<PrismaClient['participant']['findMany']>>[number];
};
interface SelectionParticipantRecord {
  sportEventParticipantId: string;
  participantId: string;
  participantName: string;
  position?: string | null;
  teamAffiliation?: string | null;
  status?: string | null;
  price?: number;
  tier?: string | null;
  orderIndex?: number;
  isAvailable: boolean;
  unavailableReason?: string;
}
type RosterPickRecord = Awaited<ReturnType<PrismaClient['rosterPick']['findMany']>>[number];

interface DraftContext {
  contest: ContestRecord;
  contestConfiguration: ContestConfigurationRecord;
  contestEntries: ContestEntryRecord[];
  memberships: MembershipRecord[];
  squadMemberships: SquadMembershipRecord[];
  selectionParticipants: SelectionParticipantRecord[];
}

interface DraftTierConfig {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
}

function sendWithStatus(reply: FastifyReply, statusCode: number, payload: unknown) {
  return reply.status(statusCode).send(payload);
}

function isCommissionerRole(role: unknown): boolean {
  return role === 'OWNER' || role === 'COMMISSIONER';
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

async function loadSportEventParticipantsByIds(
  prisma: PrismaClient,
  sportEventParticipantIds: string[],
): Promise<Map<string, SportEventParticipantWithParticipantRecord>> {
  if (sportEventParticipantIds.length === 0) {
    return new Map();
  }

  const records = await prisma.sportEventParticipant.findMany({
    where: { id: { in: sportEventParticipantIds } },
    include: {
      participant: true,
    },
  });

  return new Map(records.map((record) => [record.id, record]));
}

function rewindSnakeDraftState(state: DraftState): DraftState {
  const lastPick = state.picks[state.picks.length - 1];
  if (!lastPick) {
    throw new Error('No picks are available to undo');
  }

  return {
    ...state,
    status: DraftStatus.LIVE,
    currentPickNumber: lastPick.pickNumber,
    picks: state.picks.slice(0, -1),
  };
}

function skipSnakeDraftPick(state: DraftState): DraftState {
  const position = engine.getCurrentPickPosition(state);
  const totalPicks = state.entryIds.length * state.rounds;
  const skippedPick = {
    pickNumber: state.currentPickNumber,
    round: position.round,
    pickInRound: position.pickInRound,
    entryId: engine.getCurrentEntryId(state),
    participantId: null,
    autoPicked: false,
    isSkipped: true,
    pickedAt: new Date(),
  };
  const nextPickNumber = state.currentPickNumber + 1;

  return {
    ...state,
    currentPickNumber: nextPickNumber,
    status: nextPickNumber > totalPicks ? DraftStatus.COMPLETE : state.status,
    picks: [...state.picks, skippedPick],
  };
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
  if (selectionType === SelectionType.SNAKE_DRAFT) return contestConfiguration?.rounds ?? 0;
  if (selectionType === SelectionType.BUDGET_PICK) return contestConfiguration?.rosterSize ?? 0;
  if (selectionType === SelectionType.TIERED) {
    return tiers.reduce((sum, tier) => sum + tier.picksFromTier, 0);
  }
  return 0;
}

function compareTierNames(a: string, b: string): number {
  const aNum = Number.parseInt(a.replace(/\D/g, ''), 10);
  const bNum = Number.parseInt(b.replace(/\D/g, ''), 10);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) {
    return aNum - bNum;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function deriveTierConfig(
  contestConfiguration: ContestConfigurationRecord,
  selectionParticipants: SelectionParticipantRecord[],
): DraftTierConfig[] {
  if (Array.isArray(contestConfiguration?.tierConfig) && contestConfiguration.tierConfig.length > 0) {
    return contestConfiguration.tierConfig.map((tier, index) => {
      const record = tier as Record<string, unknown>;
      return {
        tierId: String(record.tierId ?? record.tierName ?? `tier-${index + 1}`),
        tierName: String(record.tierName ?? record.tierId ?? `Tier ${index + 1}`),
        tierNumber: Number(record.tierNumber ?? index + 1),
        picksFromTier: Number(record.picksFromTier ?? 1),
        participantIds: Array.isArray(record.participantIds)
          ? record.participantIds.map((value) => String(value))
          : [],
      };
    });
  }

  const groups = new Map<string, string[]>();
  for (const participant of selectionParticipants) {
    const tierName = participant.tier ?? 'Unassigned';
    const existing = groups.get(tierName) ?? [];
    existing.push(participant.participantId);
    groups.set(tierName, existing);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => compareTierNames(a, b))
    .map(([tierName, participantIds], index) => ({
      tierId: tierName,
      tierName,
      tierNumber: index + 1,
      picksFromTier: 1,
      participantIds,
    }));
}

async function loadDraftContext(prisma: PrismaClient, contestId: string): Promise<DraftContext | null> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      id: true,
      name: true,
      leagueId: true,
      sportEventId: true,
      selectionType: true,
      status: true,
      lockAt: true,
    },
  });
  if (!contest) return null;

  const [contestConfiguration, contestEntries, memberships, sportEventParticipants] = await Promise.all([
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
            valuations: {
              orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const squadIds = Array.from(new Set(contestEntries.map((entry) => entry.squadId)));
  const squadMemberships = squadIds.length === 0
    ? []
    : await prisma.squadMembership.findMany({
        where: {
          squadId: { in: squadIds },
          status: 'ACTIVE',
        },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      });

  return {
    contest,
    contestConfiguration,
    contestEntries,
    memberships,
    squadMemberships,
    selectionParticipants: sportEventParticipants.map((record) => {
      const valuation = record.valuations[0];
      const normalizedStatus = record.status?.toUpperCase?.();
      const isAvailable = !normalizedStatus || !['INACTIVE', 'REMOVED', 'WITHDRAWN'].includes(normalizedStatus);

      return {
        sportEventParticipantId: record.id,
        participantId: record.participantId,
        participantName: record.participant.name,
        position: record.participant.position,
        teamAffiliation: record.participant.teamAffiliation,
        status: record.status,
        price: valuation?.price ?? undefined,
        tier: valuation?.tier ?? null,
        orderIndex: valuation?.orderIndex ?? undefined,
        isAvailable,
        unavailableReason: isAvailable
          ? undefined
          : `SportEventParticipant ${record.id} is unavailable with status ${record.status ?? 'UNKNOWN'}`,
      };
    }).sort((a, b) => {
      const orderDiff = (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      return a.participantName.localeCompare(b.participantName, undefined, { sensitivity: 'base' });
    }),
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
    pricingMethod: contestConfiguration.pricingMethod ?? undefined,
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

async function buildSnakeDraftResponse(
  prisma: PrismaClient,
  context: DraftContext,
  session: SessionState,
  state: DraftState,
  availableParticipantIds: string[],
  requestUserId?: string,
) {
  const takenIds = engine.getTakenParticipantIds(state);
  const remaining = availableParticipantIds.filter((id) => !takenIds.includes(id));
  const contestEntryRepo = new PrismaContestEntryRepository(prisma);

  const contestEntries = await contestEntryRepo.findByContest(state.contestId);
  const contestEntryById = new Map(contestEntries.map((entry) => [entry.id, entry]));
  const entryUserIdMap = buildEntryUserIdMap(context);
  const sportEventParticipantIds = Array.from(new Set(
    state.picks.map((pick) => pick.participantId).filter((value): value is string => Boolean(value)),
  ));
  const sportEventParticipantById = await loadSportEventParticipantsByIds(
    prisma,
    sportEventParticipantIds,
  );
  const tiers = deriveTierConfig(context.contestConfiguration, context.selectionParticipants);
  const rosterSize = getRosterSize(context.contest.selectionType, context.contestConfiguration, tiers);

  const entries = state.entryIds.map((entryId) => {
    const contestEntry = contestEntryById.get(entryId);
    return {
      id: entryId,
      userId: contestEntry ? entryUserIdMap.get(contestEntry.id) ?? '' : '',
      name: contestEntry?.name ?? entryId,
      isOnClock: session.currentEntryId === entryId && session.status === DraftStatus.LIVE,
    };
  });

  const myEntryId = requestUserId
    ? entries.find((entry) => entry.userId === requestUserId)?.id ?? null
    : null;
  const isCommissioner = getIsCommissioner(context, requestUserId);

  return {
    contestId: state.contestId,
    contestName: context.contest?.name ?? state.contestId,
    selectionType: context.contest.selectionType,
    isTurnBased: true,
    isCommissioner,
    rosterSize,
    contestConfiguration: buildContestConfigurationResponse(context.contestConfiguration, tiers, rosterSize),
    status: session.status,
    currentPickNumber: state.currentPickNumber,
    currentRound: engine.getCurrentPickPosition(state).round,
    totalPicks: state.entryIds.length * state.rounds,
    totalRounds: state.rounds,
    currentEntryId: state.status === DraftStatus.LIVE && !engine.isComplete(state)
      ? engine.getCurrentEntryId(state)
      : null,
    currentEntryName: state.status === DraftStatus.LIVE && !engine.isComplete(state)
      ? (contestEntryById.get(engine.getCurrentEntryId(state))?.name ?? engine.getCurrentEntryId(state))
      : null,
    myEntryId,
    isMyPick: myEntryId !== null && session.currentEntryId === myEntryId && session.status === DraftStatus.LIVE,
    currentTurnStartedAt:
      session.currentTurnStartedAt?.toISOString?.() ?? session.currentTurnStartedAt ?? null,
    timePerPickSeconds: session.timePerPickSeconds,
    entries,
    draftPickHistories: state.picks.map((pick) => {
      const contestEntry = contestEntryById.get(pick.entryId);
      const sportEventParticipant = pick.participantId
        ? sportEventParticipantById.get(pick.participantId)
        : undefined;
      const participant = sportEventParticipant?.participant;
      return {
        pickNumber: pick.pickNumber,
        round: pick.round,
        pickInRound: pick.pickInRound,
        entryId: pick.entryId,
        entryName: contestEntry?.name ?? pick.entryId,
        participantId: pick.participantId,
        participantName: pick.isSkipped ? null : participant?.name ?? pick.participantId,
        position: participant?.position ?? undefined,
        team: participant?.teamAffiliation ?? undefined,
        tierId: undefined,
        tierName: undefined,
        autoPicked: pick.autoPicked,
        isSkipped: pick.isSkipped,
        pickedAt: pick.pickedAt.toISOString(),
      };
    }),
    availableParticipantIds: remaining,
    isComplete: engine.isComplete(state),
  };
}

async function buildRosterSelectionResponse(
  prisma: PrismaClient,
  context: DraftContext,
  requestUserId?: string,
) {
  const contestEntryById = new Map(context.contestEntries.map((entry) => [entry.id, entry]));
  const entryUserIdMap = buildEntryUserIdMap(context);
  const entryIds = context.contestEntries.map((entry) => entry.id);
  const tiers = deriveTierConfig(context.contestConfiguration, context.selectionParticipants);
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

  const rosterPicks = entryIds.length === 0
    ? []
    : await prisma.rosterPick.findMany({
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

  const picksByEntry = new Map<string, RosterPickRecord[]>();
  for (const pick of rosterPicks) {
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
  const myEntryPicks = myEntryId ? picksByEntry.get(myEntryId) ?? [] : [];
  const isCommissioner = getIsCommissioner(context, requestUserId);

  const pickIndexByEntry = new Map<string, number>();
  const pickIndexByEntryTier = new Map<string, number>();
  const pickDtos = rosterPicks.map((pick, index) => {
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
      position: participant?.position ?? undefined,
      team: participant?.teamAffiliation ?? undefined,
      price: priceBySportEventParticipantId.get(pick.sportEventParticipantId),
      tierId: tier?.tierId,
      tierName: tier?.tierName,
      autoPicked: pick.autoPicked,
      pickedAt: pick.pickedAt.toISOString(),
    };
  });

  const availableParticipantIds = context.contestConfiguration?.isExclusive
    ? context.selectionParticipants.flatMap((participant) => {
        if (!participant.isAvailable) return [];
        if (rosterPicks.some((pick) => pick.sportEventParticipantId === participant.sportEventParticipantId)) {
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
    draftPickHistories: pickDtos,
    availableParticipantIds,
    isComplete,
  };
}

async function buildDraftStateResponse(
  prisma: PrismaClient,
  contestId: string,
  requestUserId?: string,
) {
  const context = await loadDraftContext(prisma, contestId);
  if (!context) {
    return { kind: 'error' as const, statusCode: 404, payload: { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` } };
  }

  if (context.contest.selectionType === SelectionType.SNAKE_DRAFT) {
    const session = await draftStore.getSession(contestId);
    if (!session) {
      return { kind: 'error' as const, statusCode: 404, payload: { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` } };
    }

    const state = await draftStore.getState(contestId);
    if (!state) {
      return { kind: 'error' as const, statusCode: 404, payload: { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` } };
    }

    const available = await draftStore.getAvailableParticipants(contestId);
    return {
      kind: 'success' as const,
      payload: await buildSnakeDraftResponse(prisma, context, session, state, available, requestUserId),
      context,
    };
  }

  if (
    context.contest.selectionType === SelectionType.TIERED
    || context.contest.selectionType === SelectionType.BUDGET_PICK
  ) {
    return {
      kind: 'success' as const,
      payload: await buildRosterSelectionResponse(prisma, context, requestUserId),
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

export async function draftsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();

  fastify.get('/:contestId', {
    schema: {
      tags: ['Drafts'],
      summary: 'Get current draft state for a contest',
      operationId: 'getDraftState',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const result = await buildDraftStateResponse(prisma, contestId, requestUserId);
      if (result.kind === 'error') {
        return sendWithStatus(reply, result.statusCode, result.payload);
      }
      return result.payload;
    },
  });

  fastify.post('/:contestId/start', {
    schema: {
      tags: ['Drafts'],
      summary: 'Start a new draft session',
      operationId: 'startDraft',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: zodToJsonSchema(StartDraftRequestSchema),
      response: { 201: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const body = (request.body ?? {}) as {
        entryIds?: string[];
        rounds?: number;
        timePerPickSeconds?: number;
        availableParticipantIds?: string[];
        autoPickPolicy?: string;
      };

      if (draftStore.has(contestId)) {
        return sendWithStatus(reply, 409, { error: 'DRAFT_EXISTS', message: `Draft already exists for contest ${contestId}` });
      }

      const entryIds = body.entryIds ?? [crypto.randomUUID(), crypto.randomUUID()];
      const rounds = body.rounds ?? 5;
      const timePerPickSeconds = body.timePerPickSeconds ?? 120;
      const availableParticipantIds = body.availableParticipantIds ?? [];
      const autoPickPolicy = (body.autoPickPolicy as 'QUEUE_THEN_BEST' | 'BEST_AVAILABLE' | 'RANDOM') ?? 'BEST_AVAILABLE';

      const pendingSession: SessionState = {
        sessionId: crypto.randomUUID(),
        contestId,
        status: DraftStatus.PENDING,
        currentPickNumber: 0,
        currentEntryId: null,
        startedAt: null,
        currentTurnStartedAt: null,
        timePerPickSeconds,
      };

      const liveSession = startSession(pendingSession);

      const initialState: DraftState = {
        contestId,
        status: DraftStatus.LIVE,
        entryIds,
        rounds,
        currentPickNumber: 1,
        picks: [],
        autoPickPolicy,
      };

      liveSession.currentEntryId = engine.getCurrentEntryId(initialState);

      await draftStore.setSession(contestId, liveSession);
      await draftStore.setState(contestId, initialState);
      await draftStore.setAvailableParticipants(contestId, availableParticipantIds);

      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);
      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }

      return sendWithStatus(
        reply,
        201,
        await buildSnakeDraftResponse(prisma, context, liveSession, initialState, availableParticipantIds, requestUserId),
      );
    },
  });

  fastify.post('/:contestId/pick', {
    schema: {
      tags: ['Drafts'],
      summary: 'Submit a draft pick',
      operationId: 'submitContestSelection',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: zodToJsonSchema(SubmitPickRequestSchema),
      response: { 200: zodToJsonSchema(DraftPickResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { entryId, participantId } = request.body as {
        entryId: string;
        participantId: string;
      };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }

      const requestedEntry = context.contestEntries.find((contestEntry) => contestEntry.id === entryId);
      if (!requestedEntry) {
        return sendWithStatus(reply, 404, { error: 'ENTRY_NOT_FOUND', message: `Entry ${entryId} was not found for contest ${contestId}` });
      }

      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED', message: 'Missing user identity' });
      }

      const requestedSquadMembership = context.squadMemberships.find(
        (membership) => membership.squadId === requestedEntry.squadId && membership.userId === requestUserId,
      );
      if (!requestedSquadMembership) {
        return sendWithStatus(reply, 403, { error: 'FORBIDDEN', message: 'You can only draft for your own entry' });
      }

      if (context.contest.selectionType === SelectionType.SNAKE_DRAFT) {
        const session = await draftStore.getSession(contestId);
        if (!session) {
          return sendWithStatus(reply, 404, { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
        }

        let state = await draftStore.getState(contestId);
        if (!state) {
          return sendWithStatus(reply, 404, { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
        }

        const available = await draftStore.getAvailableParticipants(contestId);

        if (isPickExpired(session)) {
          const currentEntryId = engine.getCurrentEntryId(state);
          const queueEntries = draftQueue.getQueue(currentEntryId);
          const autoPickId = engine.resolveAutoPick(state, {
            entryId: currentEntryId,
            queue: queueEntries,
            availableParticipantIds: available,
          });

          if (autoPickId) {
            state = engine.applyPick(state, { entryId: currentEntryId, participantId: autoPickId }, true);
            session.currentTurnStartedAt = new Date();

            if (!engine.isComplete(state)) {
              session.currentEntryId = engine.getCurrentEntryId(state);
            } else {
              session.status = DraftStatus.COMPLETE;
              session.currentTurnStartedAt = null;
              session.currentEntryId = null;
            }

            await draftStore.setSession(contestId, session);
            await draftStore.setState(contestId, state);
          }
        }

        const validation = engine.validatePick(state, { entryId, participantId });
        if (!validation.valid) {
          return sendWithStatus(reply, 400, { error: 'INVALID_PICK', message: validation.reason });
        }

        state = engine.applyPick(state, { entryId, participantId });

        if (!engine.isComplete(state)) {
          session.currentEntryId = engine.getCurrentEntryId(state);
          session.currentPickNumber = state.currentPickNumber;
          session.currentTurnStartedAt = new Date();
        } else {
          session.status = DraftStatus.COMPLETE;
          state = { ...state, status: DraftStatus.COMPLETE };
          session.currentEntryId = null;
          session.currentTurnStartedAt = null;
        }

        await draftStore.setSession(contestId, session);
        await draftStore.setState(contestId, state);

        return buildSnakeDraftResponse(prisma, context, session, state, available, requestUserId);
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

      const tiers = deriveTierConfig(context.contestConfiguration, context.selectionParticipants);
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

      const existingEntryPicks = await prisma.rosterPick.findMany({
        where: { entryId },
        include: {
          sportEventParticipant: true,
        },
        orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }],
      });
      if (existingEntryPicks.length >= rosterSize) {
        return sendWithStatus(reply, 400, {
          error: 'ENTRY_COMPLETE',
          message: `Entry ${entryId} has already submitted all ${rosterSize} picks`,
        });
      }
      if (existingEntryPicks.some((pick) => pick.sportEventParticipantId === participantId)) {
        return sendWithStatus(reply, 400, {
          error: 'DUPLICATE_PICK',
          message: `SportEventParticipant ${participantId} is already on this entry`,
        });
      }

      const exclusiveTaken = context.contestConfiguration?.isExclusive
        ? await prisma.rosterPick.findFirst({
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
          return sendWithStatus(reply, 400, {
            error: 'TIER_FULL',
            message: `Entry ${entryId} has already filled ${tier.tierName}`,
          });
        }

        const roundsBeforeTier = tiers
          .filter((item) => item.tierNumber < tier.tierNumber)
          .reduce((sum, item) => sum + item.picksFromTier, 0);
        draftRound = roundsBeforeTier + picksInTier.length + 1;
      }

      const globalPickCount = await prisma.rosterPick.count({
        where: {
          entry: {
            contestId,
          },
        },
      });

      await prisma.rosterPick.create({
        data: {
          entryId,
          sportEventParticipantId: participantId,
          draftRound,
          draftPickNumber: globalPickCount + 1,
          autoPicked: false,
        },
      });

      return buildRosterSelectionResponse(prisma, context, requestUserId);
    },
  });

  fastify.post('/:contestId/pause', {
    schema: {
      tags: ['Drafts'],
      summary: 'Pause an active draft',
      operationId: 'pauseDraft',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }
      if (context.contest.selectionType !== SelectionType.SNAKE_DRAFT) {
        return sendWithStatus(reply, 400, { error: 'INVALID_CONTEST_MODE', message: 'Pause is only available for snake drafts' });
      }
      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED', message: 'Missing user identity' });
      }
      if (!getIsCommissioner(context, requestUserId)) {
        return sendWithStatus(reply, 403, { error: 'FORBIDDEN', message: 'Only commissioners can pause drafts' });
      }

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }
      const state = await draftStore.getState(contestId);
      if (!state) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }
      const available = await draftStore.getAvailableParticipants(contestId);

      const pausedSession = pauseSession(session);
      const pausedState = { ...state, status: DraftStatus.PAUSED };
      await draftStore.setSession(contestId, pausedSession);
      await draftStore.setState(contestId, pausedState);

      return buildSnakeDraftResponse(prisma, context, pausedSession, pausedState, available, requestUserId);
    },
  });

  fastify.post('/:contestId/resume', {
    schema: {
      tags: ['Drafts'],
      summary: 'Resume a paused draft',
      operationId: 'resumeDraft',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }
      if (context.contest.selectionType !== SelectionType.SNAKE_DRAFT) {
        return sendWithStatus(reply, 400, { error: 'INVALID_CONTEST_MODE', message: 'Resume is only available for snake drafts' });
      }
      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED', message: 'Missing user identity' });
      }
      if (!getIsCommissioner(context, requestUserId)) {
        return sendWithStatus(reply, 403, { error: 'FORBIDDEN', message: 'Only commissioners can resume drafts' });
      }

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }
      const state = await draftStore.getState(contestId);
      if (!state) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }
      const available = await draftStore.getAvailableParticipants(contestId);

      const resumedSession = resumeSession(session);
      const resumedState = { ...state, status: DraftStatus.LIVE };
      await draftStore.setSession(contestId, resumedSession);
      await draftStore.setState(contestId, resumedState);

      return buildSnakeDraftResponse(prisma, context, resumedSession, resumedState, available, requestUserId);
    },
  });

  fastify.post('/:contestId/extend', {
    schema: {
      tags: ['Drafts'],
      summary: 'Shift the current turn start time',
      operationId: 'extendCurrentTurn',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: zodToJsonSchema(ExtendCurrentTurnRequestSchema),
      response: { 200: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { additionalSeconds } = request.body as { additionalSeconds: number };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }
      if (context.contest.selectionType !== SelectionType.SNAKE_DRAFT) {
        return sendWithStatus(reply, 400, { error: 'INVALID_CONTEST_MODE', message: 'Clock extension is only available for snake drafts' });
      }
      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED', message: 'Missing user identity' });
      }
      if (!getIsCommissioner(context, requestUserId)) {
        return sendWithStatus(reply, 403, { error: 'FORBIDDEN', message: 'Only commissioners can extend draft clocks' });
      }

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }
      const state = await draftStore.getState(contestId);
      if (!state) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }
      const available = await draftStore.getAvailableParticipants(contestId);

      const extendedSession = extendCurrentTurn(session, additionalSeconds);
      await draftStore.setSession(contestId, extendedSession);

      return buildSnakeDraftResponse(prisma, context, extendedSession, state, available, requestUserId);
    },
  });

  fastify.post('/:contestId/undo', {
    schema: {
      tags: ['Drafts'],
      summary: 'Undo the most recent snake draft pick',
      operationId: 'undoSnakeDraftSelection',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }
      if (context.contest.selectionType !== SelectionType.SNAKE_DRAFT) {
        return sendWithStatus(reply, 400, { error: 'INVALID_CONTEST_MODE', message: 'Undo is only available for snake drafts' });
      }
      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED', message: 'Missing user identity' });
      }
      if (!getIsCommissioner(context, requestUserId)) {
        return sendWithStatus(reply, 403, { error: 'FORBIDDEN', message: 'Only commissioners can undo draft picks' });
      }

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }
      const state = await draftStore.getState(contestId);
      if (!state) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }
      if (state.picks.length === 0) {
        return sendWithStatus(reply, 400, { error: 'NO_PICKS_TO_UNDO', message: 'This draft has no picks to undo' });
      }

      const available = await draftStore.getAvailableParticipants(contestId);
      const rewoundState = rewindSnakeDraftState(state);
      const rewoundEntryId = engine.getCurrentEntryId(rewoundState);
      const rewoundSession = {
        ...session,
        status: DraftStatus.LIVE,
        currentPickNumber: rewoundState.currentPickNumber,
        currentEntryId: rewoundEntryId,
        currentTurnStartedAt: new Date(),
      };

      await draftStore.setState(contestId, rewoundState);
      await draftStore.setSession(contestId, rewoundSession);

      return buildSnakeDraftResponse(prisma, context, rewoundSession, rewoundState, available, requestUserId);
    },
  });

  fastify.post('/:contestId/skip', {
    schema: {
      tags: ['Drafts'],
      summary: 'Skip the current snake draft pick',
      operationId: 'skipSnakeDraftTurn',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: zodToJsonSchema(DraftStateResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const requestUserId = request.headers['x-user-id'] as string | undefined;
      const context = await loadDraftContext(prisma, contestId);

      if (!context) {
        return sendWithStatus(reply, 404, { error: 'CONTEST_NOT_FOUND', message: `Contest ${contestId} was not found` });
      }
      if (context.contest.selectionType !== SelectionType.SNAKE_DRAFT) {
        return sendWithStatus(reply, 400, { error: 'INVALID_CONTEST_MODE', message: 'Skip is only available for snake drafts' });
      }
      if (!requestUserId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED', message: 'Missing user identity' });
      }
      if (!getIsCommissioner(context, requestUserId)) {
        return sendWithStatus(reply, 403, { error: 'FORBIDDEN', message: 'Only commissioners can skip draft picks' });
      }

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }
      const state = await draftStore.getState(contestId);
      if (!state) {
        return sendWithStatus(reply, 404, { error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }
      if (state.status !== DraftStatus.LIVE) {
        return sendWithStatus(reply, 400, { error: 'DRAFT_NOT_LIVE', message: 'Only live drafts can skip the current pick' });
      }

      const available = await draftStore.getAvailableParticipants(contestId);
      const skippedState = skipSnakeDraftPick(state);
      const isComplete = engine.isComplete(skippedState);
      const skippedSession = {
        ...session,
        status: isComplete ? DraftStatus.COMPLETE : DraftStatus.LIVE,
        currentPickNumber: skippedState.currentPickNumber,
        currentEntryId: isComplete ? null : engine.getCurrentEntryId(skippedState),
        currentTurnStartedAt: isComplete ? null : new Date(),
      };

      await draftStore.setState(contestId, skippedState);
      await draftStore.setSession(contestId, skippedSession);

      return buildSnakeDraftResponse(prisma, context, skippedSession, skippedState, available, requestUserId);
    },
  });
}
