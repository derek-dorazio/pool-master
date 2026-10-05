/**
 * DraftService — the draft room's two operations, their rules, guards, ordering and side
 * effects (#324, `docs/LAYERS.md` §2.4).
 *
 * Before this, all of it lived in `routes.ts`: fifteen module-private functions and thirteen
 * direct Prisma calls, with the submission path's ten validation rules interleaved with the
 * writes that depend on them. The rules were never wrong — they are more thorough than the
 * `engine/` classes #323 deleted — they were just unreachable from anywhere but an HTTP
 * request, so the only way to test a draft rule was to send one.
 *
 * **Submitting a selection has three outcomes, not two.** A selection can be placed, it can
 * *replace* the entry's last pick in a tier that is already full, or — in a tiered contest —
 * re-submitting a participant the entry already holds *toggles it off*, deleting the pick and
 * inserting nothing. `plans/144` records what happens to an abstraction that forgets this:
 * the first attempt's `validatePick` returned `{ valid, reason }`, a boolean cannot express
 * replace or toggle-off, so the live behaviour could never live behind it; the engines built
 * on it enforced three rules to the route's ten and, on a full tier, rejected the pick where
 * the route replaces it. They were dead code that disagreed with production. So
 * `submitSelection` is not `validate() → boolean` followed by an insert, and
 * `resolveTieredPlacement` returns which of the three happened rather than whether it may.
 *
 * Dependencies arrive as an **options object**. `docs/LAYERS.md` §5 records why: the services
 * with twelve, nine and seven positional constructor parameters could not be safely
 * converted, and the attempt landed "a Prisma mock in a logger slot".
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  DraftStatus,
  SelectionType,
  type ContestEntry,
  type Participant,
} from '@poolmaster/shared/domain';
import type {
  ContestConfigurationRepository,
  ContestEntryPickRepository,
  ContestEntryPickWithParticipant,
  ContestEntryRepository,
  ContestRepository,
  LeagueMembershipRepository,
  SportEventParticipantRepository,
  ParticipantRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import type { ContestEntryPickService } from '../contest-entry-picks';
import type { SportEventTierService } from '../events/sport-event-tier-service';
import { draftErrors } from './draft-errors';
import {
  buildDraftTiers,
  buildEntryUserIdMap,
  buildSelectionParticipants,
  buildTierByParticipantId,
  buildValuationLookup,
  findTierByLabel,
  getRosterSize,
  isCommissionerRole,
  isRosterSelectionType,
  mapContestStatusToDraftStatus,
  resolveTieredPlacement,
} from './draft-rules';
import type {
  DraftContext,
  DraftRoomEntry,
  DraftRoomPick,
  DraftRoomView,
  DraftSelectionGroup,
  SubmitSelectionResult,
} from './types';

export interface DraftServiceDeps {
  contests: ContestRepository;
  configurations: ContestConfigurationRepository;
  entries: ContestEntryRepository;
  /** Only ever read for the actor's own row — the room needs it to answer `isCommissioner`. */
  memberships: LeagueMembershipRepository;
  squadMemberships: SquadMembershipRepository;
  field: SportEventParticipantRepository;
  participants: ParticipantRepository;
  /** Read-only by design (#247); the two pick writes below go through `pickWrites`. */
  picks: ContestEntryPickRepository;
  /**
   * The single enforced pick-write path (plans/117 §7.1): `createPick` resolves the parent
   * contest's `contestFormat` inside the insert's transaction, and `deletePick` keeps the
   * tiered replace and toggle-off deletes on the same service rather than on the read port.
   */
  pickWrites: ContestEntryPickService;
  tiers: SportEventTierService;
  logger?: FastifyBaseLogger;
}

export interface GetDraftStateInput {
  contestId: string;
  /** The entry whose selections to show; defaults to the actor's own entry. */
  selectedEntryId?: string;
  actorUserId?: string;
}

export interface SubmitSelectionInput {
  contestId: string;
  entryId: string;
  /** A `SportEventParticipant` id — the field row, not the canonical participant. */
  participantId: string;
  actorUserId?: string;
}

export class DraftService {
  constructor(private readonly deps: DraftServiceDeps) {}

  /**
   * The draft room as the actor should see it. 404 for an unknown contest, 501 for a
   * selection type this surface does not serve.
   */
  async getDraftState(input: GetDraftStateInput): Promise<DraftRoomView> {
    const context = await this.loadContext(input.contestId);

    if (!isRosterSelectionType(context.contest.selectionType)) {
      throw draftErrors.draftModeUnsupportedForRead(context.contest.selectionType);
    }

    return this.buildRoomView({
      context,
      selectedEntryId: input.selectedEntryId,
      actorUserId: input.actorUserId,
    });
  }

  /**
   * Submit a selection, and answer with the refreshed room.
   *
   * The guards run in the order below and that order is part of the contract — an unknown
   * entry answers 404 before an unauthenticated caller answers 401, because which entry was
   * meant is not a secret and a missing one is the more specific complaint.
   */
  async submitSelection(input: SubmitSelectionInput): Promise<SubmitSelectionResult> {
    const { contestId, entryId, participantId, actorUserId } = input;
    const context = await this.loadContext(contestId);

    const requestedEntry = context.entries.find((entry) => entry.id === entryId);
    if (!requestedEntry) throw draftErrors.entryNotFound(entryId, contestId);

    if (!actorUserId) throw draftErrors.authSessionRequired();

    const ownsRequestedEntry = context.squadMemberships.some(
      (membership) =>
        membership.squadId === requestedEntry.squadId && membership.userId === actorUserId,
    );
    if (!ownsRequestedEntry) throw draftErrors.entryAccessDenied();

    if (!isRosterSelectionType(context.contest.selectionType)) {
      throw draftErrors.draftModeUnsupportedForSubmission(context.contest.selectionType);
    }

    const isTiered = context.contest.selectionType === SelectionType.TIERED;
    const { tiers } = context;
    const rosterSize = getRosterSize(context.contest.selectionType, context.configuration, tiers);
    if (rosterSize <= 0) throw draftErrors.selectionConfigInvalid(contestId);

    const fieldRow = await this.deps.field.findById(participantId);
    if (!fieldRow || fieldRow.sportEventId !== context.contest.sportEventId) {
      throw draftErrors.participantNotInEvent(participantId, contestId);
    }

    // Accepts either id, because a client may send the field row's id or the canonical
    // participant's and both identify the same selection.
    const selectionParticipant = context.selectionParticipants.find(
      (participant) =>
        participant.sportEventParticipantId === participantId
        || participant.participantId === fieldRow.participantId,
    );
    if (!selectionParticipant) {
      throw draftErrors.participantNotSelectable(participantId, contestId);
    }
    if (!selectionParticipant.isAvailable) {
      throw draftErrors.participantUnavailable(
        participantId,
        selectionParticipant.unavailableReason,
      );
    }

    const existingPicks = await this.deps.picks.findByEntriesWithParticipant([entryId]);
    const existingParticipantPick = existingPicks.find(
      (pick) => pick.sportEventParticipantId === participantId,
    );

    // Outcome one: toggle off. Re-submitting a participant a tiered entry already holds
    // unselects it — the pick is deleted and nothing is inserted. A budget-pick entry has no
    // such gesture, so there the same submission is a duplicate.
    if (existingParticipantPick && isTiered) {
      await this.deps.pickWrites.deletePick(existingParticipantPick.id);
      this.deps.logger?.info(
        {
          action: 'draft.submitSelection.toggledOff',
          data: { contestId, entryId, participantId, pickId: existingParticipantPick.id },
        },
        'Unselected a participant already on the entry',
      );
      return {
        outcome: 'toggled-off',
        view: await this.buildRoomView({ context, selectedEntryId: entryId, actorUserId }),
      };
    }
    if (existingParticipantPick) throw draftErrors.duplicatePick(participantId);

    if (context.configuration?.isExclusive) {
      const contestPicks = await this.deps.picks.findByContestAndParticipant(
        contestId,
        participantId,
      );
      if (contestPicks.some((pick) => pick.entryId !== entryId)) {
        throw draftErrors.participantAlreadyTaken(participantId);
      }
    }

    // Outcome two and three: place, or replace. A tiered selection into a tier the entry has
    // already filled displaces that tier's last pick and takes its round; a full entry with
    // nothing to displace is ENTRY_COMPLETE.
    let draftRound = existingPicks.length + 1;
    let replacedPickId: string | null = null;

    if (isTiered) {
      const tierLabel = selectionParticipant.tier;
      if (!tierLabel) throw draftErrors.tierMissing(participantId);

      const tier = findTierByLabel(tiers, tierLabel);
      if (!tier) throw draftErrors.tierNotFound(tierLabel, contestId);

      const placement = resolveTieredPlacement({
        tier,
        tiers,
        existingPicks: existingPicks.map(toPlacementPick),
        rosterSize,
      });
      if (placement.kind === 'entry-complete') {
        throw draftErrors.entryComplete(entryId, rosterSize);
      }

      draftRound = placement.draftRound;
      if (placement.kind === 'replace') {
        replacedPickId = placement.replacedPickId;
        await this.deps.pickWrites.deletePick(replacedPickId);
      }
    } else if (existingPicks.length >= rosterSize) {
      throw draftErrors.entryComplete(entryId, rosterSize);
    }

    const contestPickCount = await this.deps.picks.countByContest(contestId);

    // pool-master-rop.78.6 — the one enforced insert path, so the denormalized
    // contestFormat is read from the parent contest in the same transaction
    // (plans/117 §7.1 — "no insert path bypasses this").
    await this.deps.pickWrites.createPick({
      entryId,
      sportEventParticipantId: participantId,
      draftRound,
      draftPickNumber: contestPickCount + 1,
      isAutoPicked: false,
    });

    this.deps.logger?.info(
      {
        action: 'draft.submitSelection.placed',
        data: { contestId, entryId, participantId, draftRound, replacedPickId },
      },
      replacedPickId ? 'Replaced a pick in a full tier' : 'Placed a selection',
    );

    return {
      outcome: 'placed',
      view: await this.buildRoomView({ context, selectedEntryId: entryId, actorUserId }),
    };
  }

  /**
   * Everything one operation reads about a contest, in six parallel reads plus the squad
   * memberships, which need the entries' squad ids first.
   */
  private async loadContext(contestId: string): Promise<DraftContext> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) throw draftErrors.contestNotFound(contestId);

    const sportEventId = contest.sportEventId;
    const [configuration, entries, field, tierGroups, valuations] = await Promise.all([
      this.deps.configurations.findByContest(contestId),
      this.deps.entries.findByContest(contestId),
      sportEventId ? this.deps.field.findBySportEvent(sportEventId) : Promise.resolve([]),
      sportEventId
        ? this.deps.tiers.getEffectiveTiersForSportEvent(sportEventId)
        : Promise.resolve([]),
      sportEventId
        ? this.deps.tiers.getEffectiveValuationsForSportEvent(sportEventId)
        : Promise.resolve([]),
    ]);

    const squadIds = Array.from(new Set(entries.map((entry) => entry.squadId)));
    const [squadMemberships, participants] = await Promise.all([
      this.deps.squadMemberships.findBySquads(squadIds),
      this.deps.participants.findByIds(field.map((entry) => entry.participantId)),
    ]);

    return {
      contest,
      configuration,
      entries,
      squadMemberships,
      tiers: buildDraftTiers(tierGroups),
      selectionParticipants: buildSelectionParticipants({
        field,
        participantsById: new Map(participants.map((p: Participant) => [p.id, p])),
        valuationBySportEventParticipantId: buildValuationLookup(valuations),
      }),
    };
  }

  /**
   * The room, assembled from a context and the picks currently on it.
   *
   * Takes the context rather than re-reading it, which is what lets a submission answer with
   * the room *as of the write*: the picks below are read fresh, so they include what was just
   * inserted or deleted, while the contest, its entries and its field are the ones the
   * submission validated against.
   */
  private async buildRoomView(input: {
    context: DraftContext;
    selectedEntryId?: string;
    actorUserId?: string;
  }): Promise<DraftRoomView> {
    const { context, actorUserId } = input;
    const { contest, configuration, tiers, entries: contestEntries } = context;
    const entryIds = contestEntries.map((entry) => entry.id);

    const [picks, actorMembership] = await Promise.all([
      this.deps.picks.findByEntriesWithParticipant(entryIds),
      actorUserId
        ? this.deps.memberships.findByLeagueAndUser(contest.leagueId, actorUserId)
        : Promise.resolve(null),
    ]);

    const rosterSize = getRosterSize(contest.selectionType, configuration, tiers);
    const entryUserIdMap = buildEntryUserIdMap(contestEntries, context.squadMemberships);
    const contestEntryById = new Map(contestEntries.map((entry) => [entry.id, entry]));
    const tierByParticipantId = buildTierByParticipantId(tiers);
    const priceBySportEventParticipantId = new Map(
      context.selectionParticipants.map((participant) => [
        participant.sportEventParticipantId,
        participant.price,
      ]),
    );

    const picksByEntry = new Map<string, ContestEntryPickWithParticipant[]>();
    for (const pick of picks) {
      const existing = picksByEntry.get(pick.entryId) ?? [];
      existing.push(pick);
      picksByEntry.set(pick.entryId, existing);
    }

    const entries: DraftRoomEntry[] = contestEntries.map((entry) => ({
      id: entry.id,
      userId: entryUserIdMap.get(entry.id) ?? '',
      name: entry.name,
      pickCount: picksByEntry.get(entry.id)?.length ?? 0,
    }));

    const myEntryId = actorUserId
      ? entries.find((entry) => entry.userId === actorUserId)?.id ?? null
      : null;
    const resolvedSelectedEntryId =
      input.selectedEntryId && entries.some((entry) => entry.id === input.selectedEntryId)
        ? input.selectedEntryId
        : myEntryId;
    const selectedEntry = resolvedSelectedEntryId
      ? entries.find((entry) => entry.id === resolvedSelectedEntryId) ?? null
      : null;
    const myEntryPickCount = myEntryId ? picksByEntry.get(myEntryId)?.length ?? 0 : 0;
    const selectedEntryPicks = resolvedSelectedEntryId
      ? picksByEntry.get(resolvedSelectedEntryId) ?? []
      : [];
    const selectedSportEventParticipantIds = new Set(
      selectedEntryPicks.map((pick) => pick.sportEventParticipantId),
    );

    const isComplete =
      rosterSize > 0
        ? entries.every((entry) => entry.pickCount >= rosterSize)
        : false;
    const status = mapContestStatusToDraftStatus(contest.status, isComplete);
    // Against `status`, not `isComplete`: a COMPLETED contest closes submission even while
    // some roster is still short, which is the whole difference between the two.
    const canCurrentUserSubmit =
      myEntryId !== null
      && rosterSize > 0
      && myEntryPickCount < rosterSize
      && status !== DraftStatus.COMPLETE;

    return {
      contest,
      configuration,
      tiers,
      rosterSize,
      isCommissioner: actorMembership ? isCommissionerRole(actorMembership.role) : false,
      status,
      entries,
      picks: this.buildPickHistory({
        picks,
        contestEntryById,
        tierByParticipantId,
        priceBySportEventParticipantId,
        isTiered: contest.selectionType === SelectionType.TIERED,
      }),
      selectionGroups: this.buildSelectionGroups(context, selectedSportEventParticipantIds),
      availableSportEventParticipantIds: this.buildAvailableParticipantIds(context, picks),
      myEntryId,
      selectedEntryId: resolvedSelectedEntryId,
      selectedEntryName: selectedEntry?.name ?? null,
      tiebreakerValue: contestEntryById.get(resolvedSelectedEntryId ?? '')?.tiebreakerValue ?? null,
      currentPickNumber: canCurrentUserSubmit ? myEntryPickCount + 1 : myEntryPickCount,
      // Tiered and budget-pick rooms compute this identically; the route had the same
      // expression on both arms of a ternary on the selection type.
      currentRound: Math.min(myEntryPickCount + 1, Math.max(rosterSize, 1)),
      totalPicks: rosterSize * entries.length,
      totalRounds: rosterSize,
      currentEntryId: canCurrentUserSubmit ? myEntryId : null,
      currentEntryName: canCurrentUserSubmit ? entryNameById(entries, myEntryId) : null,
      canCurrentUserSubmit,
      isComplete,
    };
  }

  /**
   * The room's pick history, each pick placed in a round.
   *
   * A pick carries the round it was stored with, and these counters are the fallback for one
   * that does not: the running index within its entry, and within its entry's picks from the
   * same tier. In a tiered room a pick's round *is* its tier number, which is why a tiered
   * history is grouped by tier rather than by when the picks were made.
   */
  private buildPickHistory(input: {
    picks: readonly ContestEntryPickWithParticipant[];
    contestEntryById: ReadonlyMap<string, ContestEntry>;
    tierByParticipantId: ReadonlyMap<string, { tierId: string; tierName: string; tierNumber: number }>;
    priceBySportEventParticipantId: ReadonlyMap<string, number | undefined>;
    isTiered: boolean;
  }): DraftRoomPick[] {
    const pickIndexByEntry = new Map<string, number>();
    const pickIndexByEntryTier = new Map<string, number>();

    return input.picks.map((pick, index) => {
      const entry = input.contestEntryById.get(pick.entryId);
      const tier = input.tierByParticipantId.get(pick.participant.participantId);

      const entryPickIndex = (pickIndexByEntry.get(pick.entryId) ?? 0) + 1;
      pickIndexByEntry.set(pick.entryId, entryPickIndex);

      const tierKey = `${pick.entryId}:${tier?.tierId ?? ''}`;
      const tierPickIndex = tier ? (pickIndexByEntryTier.get(tierKey) ?? 0) + 1 : entryPickIndex;
      if (tier) pickIndexByEntryTier.set(tierKey, tierPickIndex);

      return {
        pickNumber: pick.draftPickNumber ?? index + 1,
        round: input.isTiered ? tier?.tierNumber ?? entryPickIndex : entryPickIndex,
        pickInRound: pick.draftRound ?? tierPickIndex,
        entryId: pick.entryId,
        // A pick whose entry or participant has gone missing falls back to the id, so the
        // history stays renderable rather than showing a blank row.
        entryName: entry?.name ?? pick.entryId,
        sportEventParticipantId: pick.sportEventParticipantId,
        participantName: pick.participant.participantName,
        role: pick.participant.role ?? undefined,
        teamAffiliation: pick.participant.teamAffiliation ?? undefined,
        price: input.priceBySportEventParticipantId.get(pick.sportEventParticipantId),
        tierId: tier?.tierId,
        tierName: tier?.tierName,
        isAutoPicked: pick.isAutoPicked,
        pickedAt: pick.pickedAt,
      };
    });
  }

  /** Each tier with its selectable field rows, and which of them the viewed entry holds. */
  private buildSelectionGroups(
    context: DraftContext,
    selectedSportEventParticipantIds: ReadonlySet<string>,
  ): DraftSelectionGroup[] {
    const participantByParticipantId = new Map(
      context.selectionParticipants.map((participant) => [participant.participantId, participant]),
    );

    return context.tiers.map((tier) => ({
      groupId: tier.tierId,
      groupName: tier.tierName,
      groupNumber: tier.tierNumber,
      picksFromGroup: tier.picksFromTier,
      participants: tier.participantIds
        .flatMap((participantId) => {
          const participant = participantByParticipantId.get(participantId);
          return participant ? [participant] : [];
        })
        .map((participant) => ({
          ...participant,
          isSelected: selectedSportEventParticipantIds.has(participant.sportEventParticipantId),
        })),
    }));
  }

  /**
   * What is still selectable. In an exclusive contest a participant any entry has taken is
   * gone for everyone; otherwise availability is just the field row's own.
   */
  private buildAvailableParticipantIds(
    context: DraftContext,
    picks: readonly ContestEntryPickWithParticipant[],
  ): string[] {
    const takenSportEventParticipantIds = context.configuration?.isExclusive
      ? new Set(picks.map((pick) => pick.sportEventParticipantId))
      : null;

    return context.selectionParticipants.flatMap((participant) => {
      if (!participant.isAvailable) return [];
      if (takenSportEventParticipantIds?.has(participant.sportEventParticipantId)) return [];
      return [participant.sportEventParticipantId];
    });
  }
}

/** The shape `resolveTieredPlacement` reasons over: a pick's id and whom it points at. */
function toPlacementPick(pick: ContestEntryPickWithParticipant): {
  id: string;
  participantId: string;
} {
  return { id: pick.id, participantId: pick.participant.participantId };
}

function entryNameById(entries: readonly DraftRoomEntry[], entryId: string | null): string | null {
  return entries.find((entry) => entry.id === entryId)?.name ?? null;
}
