/**
 * SelectionService — the selection room's two operations, their rules, guards, ordering and side
 * effects (#324, `docs/LAYERS.md` §2.4).
 *
 * Before this, all of it lived in `routes.ts`: fifteen module-private functions and thirteen
 * direct Prisma calls, with the submission path's ten validation rules interleaved with the
 * writes that depend on them. The rules were never wrong — they are more thorough than the
 * `engine/` classes #323 deleted — they were just unreachable from anywhere but an HTTP
 * request, so the only way to test a selection rule was to send one.
 *
 * **Submitting a selection has three outcomes, not two.** A selection can be placed, it can
 * *replace* the entry's last pick in a tier that is already full, or — in a tiered contest —
 * re-submitting a participant the entry already holds *toggles it off*, deleting the pick and
 * inserting nothing. An abstraction that forgot this has already failed once:
 * the first attempt's `validatePick` returned `{ valid, reason }`, a boolean cannot express
 * replace or toggle-off, so the live behaviour could never live behind it; the engines built
 * on it enforced three rules to the route's ten and, on a full tier, rejected the pick where
 * the route replaces it. They were dead code that disagreed with production.
 *
 * **This is the shared handler; the per-type rules are engines (#198).** Auth, the pick
 * window, participant-in-event, availability, exclusivity and persistence are the same for
 * every selection type and live here. What differs (roster size, what a selection does to the
 * entry, lineup completeness, a pick's round) is a `SelectionEngine`, looked up by the
 * contest's `SelectionType`; a type with no engine answers 501. An engine's `evaluate` returns
 * which outcome applies, and this service performs it.
 *
 * Dependencies arrive as an **options object**. `docs/LAYERS.md` §5 records why: the services
 * with twelve, nine and seven positional constructor parameters could not be safely
 * converted, and the attempt landed "a Prisma mock in a logger slot".
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  ContestEntryStatus,
  ContestStatus,
  SelectionType,
  LeagueMembershipStatus,
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
  SportEventRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import type { ContestEntryPickService } from '../contest-entry-picks';
import { contestPicksRevealed, type ContestService } from '../contests/service';
import { areContestEntriesOpen } from '../contests/entry-window';
import type { SportEventTierService } from '../events/sport-event-tier-service';
import { selectionErrors, type SelectionError } from './selection-errors';
import {
  buildSelectionTiers,
  buildEntryUserIdMap,
  buildSelectionParticipants,
  buildTierByParticipantId,
  buildValuationLookup,
  isCommissionerRole,
  mapContestStatusToSelectionStatus,
} from './selection-rules';
import { findSelectionEngine } from './selection-engines/registry';
import {
  SelectionOutcomeKind,
  SelectionRejectCode,
  type EntryPick,
  type SelectionEngine,
  type SelectionRejection,
} from './selection-engines/selection-engine';
import {
  LineupIssueKind,
  type LineupIssue,
  type SelectionContext,
  type SelectionEntry,
  type PickHistoryRow,
  type SelectionView,
  type SelectionGroup,
  type SubmitSelectionResult,
} from './types';

export interface SelectionServiceDeps {
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
  /**
   * Sends the "Entry submitted" confirmation once an entry is submitted (#481). Optional so the
   * room can be built without mail; the contests module owns the email.
   */
  entryReceipts?: Pick<ContestService, 'sendEntrySubmittedEmail'>;
  /** Read for the event's start time, the cutoff for pick changes. */
  sportEvents: Pick<SportEventRepository, 'findById'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export interface GetSelectionStateInput {
  contestId: string;
  /**
   * The entry whose selections to show; defaults to the actor's own entry. Another team's
   * entry is honoured only once the contest's picks are revealed.
   */
  selectedEntryId?: string;
  actorUserId?: string;
  /** Root admins see a DRAFT contest's room, as they see the contest itself (#117). */
  actorIsRootAdmin?: boolean;
}

export interface SubmitSelectionInput {
  contestId: string;
  entryId: string;
  /** A `SportEventParticipant` id — the field row, not the canonical participant. */
  participantId: string;
  actorUserId?: string;
}

export interface SubmitEntryInput {
  contestId: string;
  entryId: string;
  actorUserId?: string;
}

export class SelectionService {
  constructor(private readonly deps: SelectionServiceDeps) {}

  /**
   * The selection room as the actor should see it. 404 for an unknown contest, and for a DRAFT
   * one to anyone but its league's commissioners and root admins, the answer the contest read
   * gives (#117); 501 for a selection type this surface does not serve.
   */
  async getSelectionState(input: GetSelectionStateInput): Promise<SelectionView> {
    const context = await this.loadContext(input.contestId);

    if (
      context.contest.status === ContestStatus.DRAFT
      && !(await this.canSeeDraftContest(context.contest.leagueId, input))
    ) {
      this.deps.logger?.warn(
        { action: 'selection.getSelectionState.draftHidden', data: { contestId: input.contestId } },
        'Hid a draft contest\'s room from a member',
      );
      throw selectionErrors.contestNotFound(input.contestId);
    }

    const engine = findSelectionEngine(context.contest.selectionType);
    if (!engine) throw selectionErrors.selectionTypeUnsupportedForRead(context.contest.selectionType);

    return this.buildRoomView({
      context,
      engine,
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
    if (!requestedEntry) throw selectionErrors.entryNotFound(entryId, contestId);

    if (!actorUserId) throw selectionErrors.authSessionRequired();

    const ownsRequestedEntry = context.squadMemberships.some(
      (membership) =>
        membership.squadId === requestedEntry.squadId && membership.userId === actorUserId,
    );
    if (!ownsRequestedEntry) throw selectionErrors.entryAccessDenied();

    const engine = findSelectionEngine(context.contest.selectionType);
    if (!engine) throw selectionErrors.selectionTypeUnsupportedForSubmission(context.contest.selectionType);

    // Placing, swapping and unselecting alike: once the contest leaves OPEN its picks are
    // revealed to the league, so a change after that would be made with the others in view;
    // and once the event's start time passes the golfers are playing.
    if (!context.acceptsPicks) {
      this.deps.logger?.warn(
        { action: 'selection.submitSelection.locked', data: { contestId, entryId, status: context.contest.status } },
        'Refused a pick change on a contest that no longer takes picks',
      );
      throw context.contest.status === ContestStatus.OPEN
        ? selectionErrors.selectionLockedByEventStart(contestId)
        : selectionErrors.selectionLocked(contestId, context.contest.status);
    }

    const { tiers } = context;
    const rosterSize = engine.rosterSize({ configuration: context.configuration, tiers });
    if (rosterSize <= 0) throw selectionErrors.selectionConfigInvalid(contestId);

    const fieldRow = await this.deps.field.findById(participantId);
    if (!fieldRow || fieldRow.sportEventId !== context.contest.sportEventId) {
      throw selectionErrors.participantNotInEvent(participantId, contestId);
    }

    // Accepts either id, because a client may send the field row's id or the canonical
    // participant's and both identify the same selection.
    const selectionParticipant = context.selectionParticipants.find(
      (participant) =>
        participant.sportEventParticipantId === participantId
        || participant.participantId === fieldRow.participantId,
    );
    if (!selectionParticipant) {
      throw selectionErrors.participantNotSelectable(participantId, contestId);
    }

    const existingPicks = await this.deps.picks.findByEntriesWithParticipant([entryId]);
    const heldPick = existingPicks.find((pick) => pick.sportEventParticipantId === participantId);
    const outcome = engine.evaluate({
      participant: selectionParticipant,
      heldPick: heldPick ? toEntryPick(heldPick) : null,
      existingPicks: existingPicks.map(toEntryPick),
      tiers,
      rosterSize,
    });

    // A toggle-off is acted on before the availability check: a golfer who withdrew after
    // being picked can no longer be chosen, but must still be removable, or the entry is stuck
    // holding them.
    if (outcome.kind === SelectionOutcomeKind.TOGGLE_OFF) {
      await this.deps.pickWrites.deletePick(outcome.pickId);
      this.deps.logger?.info(
        {
          action: 'selection.submitSelection.toggledOff',
          data: { contestId, entryId, participantId, pickId: outcome.pickId },
        },
        'Unselected a participant already on the entry',
      );
      const toggledContext = await this.returnToDraftIfShort(context, engine, requestedEntry, rosterSize);
      return {
        outcome: 'toggled-off',
        view: await this.buildRoomView({ context: toggledContext, engine, selectedEntryId: entryId, actorUserId }),
      };
    }
    if (!selectionParticipant.isAvailable) {
      throw selectionErrors.participantUnavailable(
        participantId,
        selectionParticipant.unavailableReason,
      );
    }

    if (outcome.kind === SelectionOutcomeKind.REJECT) {
      throw rejectionError(outcome, { contestId, entryId, participantId, rosterSize });
    }

    // Accept, or replace: a replacement first displaces the pick it takes the place of.
    const { lineupSlot } = outcome;
    const replacedPickId = outcome.kind === SelectionOutcomeKind.REPLACE ? outcome.replacedPickId : null;
    if (replacedPickId) await this.deps.pickWrites.deletePick(replacedPickId);

    const contestPickCount = await this.deps.picks.countByContest(contestId);

    // pool-master-rop.78.6 — the one enforced insert path, so the denormalized
    // contestFormat is read from the parent contest in the same transaction
    // (plans/117 §7.1 — "no insert path bypasses this").
    await this.deps.pickWrites.createPick({
      entryId,
      sportEventParticipantId: participantId,
      lineupSlot,
      pickSequence: contestPickCount + 1,
      isAutoPicked: false,
    });

    this.deps.logger?.info(
      {
        action: 'selection.submitSelection.placed',
        data: { contestId, entryId, participantId, lineupSlot, replacedPickId },
      },
      replacedPickId ? 'Replaced a pick in a full tier' : 'Placed a selection',
    );

    const placedContext = await this.returnToDraftIfShort(context, engine, requestedEntry, rosterSize);
    return {
      outcome: 'placed',
      view: await this.buildRoomView({ context: placedContext, engine, selectedEntryId: entryId, actorUserId }),
    };
  }

  /**
   * Submit an entry (#481): its owner declares the lineup final, and from then on it counts on
   * the leaderboard, in standings and at settlement. Refused unless the lineup is complete.
   *
   * The guards are `submitSelection`'s, in the same order, because they protect the same thing:
   * an unknown entry answers 404 before an unauthenticated caller 401, then ownership, the
   * selection type, and the window picks change in. Submitting an entry that is already
   * submitted changes nothing and answers with the room.
   */
  async submitEntry(input: SubmitEntryInput): Promise<SelectionView> {
    const { contestId, entryId, actorUserId } = input;
    const context = await this.loadContext(contestId);

    const entry = context.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw selectionErrors.entryNotFound(entryId, contestId);

    if (!actorUserId) throw selectionErrors.authSessionRequired();

    const ownsEntry = context.squadMemberships.some(
      (membership) => membership.squadId === entry.squadId && membership.userId === actorUserId,
    );
    if (!ownsEntry) throw selectionErrors.entryAccessDenied();

    const engine = findSelectionEngine(context.contest.selectionType);
    if (!engine) throw selectionErrors.selectionTypeUnsupportedForSubmission(context.contest.selectionType);

    if (!context.acceptsPicks) {
      this.deps.logger?.warn(
        { action: 'selection.submitEntry.locked', data: { contestId, entryId, status: context.contest.status } },
        'Refused to submit an entry on a contest that no longer takes picks',
      );
      throw context.contest.status === ContestStatus.OPEN
        ? selectionErrors.submitLockedByEventStart(contestId)
        : selectionErrors.submitLocked(contestId, context.contest.status);
    }

    const rosterSize = engine.rosterSize({ configuration: context.configuration, tiers: context.tiers });
    if (rosterSize <= 0) throw selectionErrors.selectionConfigInvalid(contestId);

    const { issues, pickCount } = await this.findEntryIssues(context, engine, entryId, rosterSize);
    // An incomplete lineup is the first thing to fix, so it is reported ahead of the budget.
    const tierShort = issues.find((issue) => issue.kind === LineupIssueKind.TIER_SHORT);
    if (tierShort || issues.some((issue) => issue.kind === LineupIssueKind.ROSTER_SHORT)) {
      const shortfall = { pickCount, rosterSize, shortTierNames: tierShort?.tierNames ?? [] };
      this.deps.logger?.warn(
        { action: 'selection.submitEntry.incomplete', data: { contestId, entryId, ...shortfall } },
        'Refused to submit an entry with an incomplete lineup',
      );
      throw selectionErrors.lineupIncomplete(entryId, shortfall);
    }
    const overBudget = issues.find((issue) => issue.kind === LineupIssueKind.OVER_BUDGET);
    if (overBudget) {
      this.deps.logger?.warn(
        { action: 'selection.submitEntry.overBudget', data: { contestId, entryId, spent: overBudget.spent, salaryCap: overBudget.salaryCap } },
        'Refused to submit an entry whose picks cost more than the salary cap',
      );
      throw selectionErrors.overBudget(entryId, overBudget.spent, overBudget.salaryCap);
    }

    let submittedContext = context;
    if (entry.status !== ContestEntryStatus.SUBMITTED) {
      const submitted = await this.deps.entries.update(entryId, { status: ContestEntryStatus.SUBMITTED });
      submittedContext = withEntry(context, submitted);
      this.deps.logger?.info(
        { action: 'selection.submitEntry.submitted', data: { contestId, entryId } },
        'Submitted a contest entry',
      );
      await this.deps.entryReceipts?.sendEntrySubmittedEmail(contestId, entryId, actorUserId);
    }

    return this.buildRoomView({ context: submittedContext, engine, selectedEntryId: entryId, actorUserId });
  }

  /** What stops the entry's lineup being submitted as of now, read fresh so it sees the latest pick write. */
  private async findEntryIssues(
    context: SelectionContext,
    engine: SelectionEngine,
    entryId: string,
    rosterSize: number,
  ): Promise<{ issues: LineupIssue[]; pickCount: number }> {
    const picks = await this.deps.picks.findByEntriesWithParticipant([entryId]);
    const priceBySportEventParticipantId = buildPriceLookup(context);
    return {
      pickCount: picks.length,
      issues: engine.findLineupIssues({
        configuration: context.configuration,
        rosterSize,
        tiers: context.tiers,
        picks: picks.map((pick) => ({
          participantId: pick.participant.participantId,
          price: priceBySportEventParticipantId.get(pick.sportEventParticipantId),
        })),
      }),
    };
  }

  /**
   * After a pick change on a submitted entry: a lineup it could no longer be submitted with goes
   * back to DRAFT (#481), so it stops counting until its owner fixes it and submits again. That
   * is a lineup left short, or a budget lineup a swap took over the cap (#93). A swap within a
   * full tier, or one that stays under the cap, keeps the entry submitted.
   */
  private async returnToDraftIfShort(
    context: SelectionContext,
    engine: SelectionEngine,
    entry: ContestEntry,
    rosterSize: number,
  ): Promise<SelectionContext> {
    if (entry.status !== ContestEntryStatus.SUBMITTED) return context;
    const { issues } = await this.findEntryIssues(context, engine, entry.id, rosterSize);
    if (issues.length === 0) return context;

    const reverted = await this.deps.entries.update(entry.id, { status: ContestEntryStatus.DRAFT });
    this.deps.logger?.info(
      {
        action: 'selection.submitSelection.returnedToDraft',
        data: { contestId: context.contest.id, entryId: entry.id, issues: issues.map((issue) => issue.kind) },
      },
      'A pick change left a submitted lineup unsubmittable; the entry is a draft again',
    );
    return withEntry(context, reverted);
  }

  /** A DRAFT contest is its league's active commissioners' alone, and root admins' (#117). */
  private async canSeeDraftContest(leagueId: string, input: GetSelectionStateInput): Promise<boolean> {
    if (input.actorIsRootAdmin) return true;
    if (!input.actorUserId) return false;
    const membership = await this.deps.memberships.findByLeagueAndUser(leagueId, input.actorUserId);
    return membership?.status === LeagueMembershipStatus.ACTIVE && isCommissionerRole(membership.role);
  }

  /**
   * Everything one operation reads about a contest, in six parallel reads plus the squad
   * memberships, which need the entries' squad ids first.
   */
  private async loadContext(contestId: string): Promise<SelectionContext> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) throw selectionErrors.contestNotFound(contestId);

    const sportEventId = contest.sportEventId;
    const [configuration, entries, field, tierGroups, valuations, sportEvent] = await Promise.all([
      this.deps.configurations.findByContest(contestId),
      this.deps.entries.findByContest(contestId),
      sportEventId ? this.deps.field.findBySportEvent(sportEventId) : Promise.resolve([]),
      sportEventId
        ? this.deps.tiers.getEffectiveTiersForSportEvent(sportEventId)
        : Promise.resolve([]),
      sportEventId
        ? this.deps.tiers.getEffectiveValuationsForSportEvent(sportEventId)
        : Promise.resolve([]),
      sportEventId ? this.deps.sportEvents.findById(sportEventId) : Promise.resolve(null),
    ]);
    const now = this.deps.now?.() ?? new Date();

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
      // A configuration without typed settings takes no picks per tier: its roster is 0, and the
      // room refuses picks with SELECTION_CONFIG_INVALID rather than guessing a number.
      tiers: buildSelectionTiers(
        tierGroups,
        configuration?.configJson?.selectionType === SelectionType.TIERED ? configuration.configJson.picksPerTier : 0,
      ),
      // One rule for every entry change: see contests/entry-window.
      acceptsPicks: areContestEntriesOpen(contest, sportEvent, now),
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
    context: SelectionContext;
    engine: SelectionEngine;
    selectedEntryId?: string;
    actorUserId?: string;
  }): Promise<SelectionView> {
    const { context, engine, actorUserId } = input;
    const { contest, configuration, tiers, entries: contestEntries } = context;
    const entryIds = contestEntries.map((entry) => entry.id);

    const [picks, actorMembership] = await Promise.all([
      this.deps.picks.findByEntriesWithParticipant(entryIds),
      actorUserId
        ? this.deps.memberships.findByLeagueAndUser(contest.leagueId, actorUserId)
        : Promise.resolve(null),
    ]);

    const rosterSize = engine.rosterSize({ configuration, tiers });
    const entryUserIdMap = buildEntryUserIdMap(contestEntries, context.squadMemberships);
    const contestEntryById = new Map(contestEntries.map((entry) => [entry.id, entry]));
    const tierByParticipantId = buildTierByParticipantId(tiers);
    const priceBySportEventParticipantId = buildPriceLookup(context);

    // While the contest takes entries (DRAFT, OPEN) a team sees only its own picks, the rule
    // the contest's entry reads follow (`contestPicksRevealed`). The actor's teams are every
    // squad they are an active member of, co-owners included, not only the squad's first
    // member, which is who `entryUserIdMap` attributes an entry to.
    const picksRevealed = contestPicksRevealed(contest.status);
    const actorSquadIds = new Set(
      actorUserId
        ? context.squadMemberships
          .filter((membership) => membership.userId === actorUserId)
          .map((membership) => membership.squadId)
        : [],
    );
    const actorEntryIds = new Set(
      contestEntries.filter((entry) => actorSquadIds.has(entry.squadId)).map((entry) => entry.id),
    );
    const visiblePicks = picksRevealed ? picks : picks.filter((pick) => actorEntryIds.has(pick.entryId));

    const picksByEntry = new Map<string, ContestEntryPickWithParticipant[]>();
    for (const pick of picks) {
      const existing = picksByEntry.get(pick.entryId) ?? [];
      existing.push(pick);
      picksByEntry.set(pick.entryId, existing);
    }

    const entries: SelectionEntry[] = contestEntries.map((entry) => ({
      id: entry.id,
      userId: entryUserIdMap.get(entry.id) ?? '',
      name: entry.name,
      pickCount: picksByEntry.get(entry.id)?.length ?? 0,
      status: entry.status,
    }));

    const myEntryId = entries.find((entry) => actorEntryIds.has(entry.id))?.id ?? null;
    const canViewSelectedEntry = (entryId: string): boolean =>
      entries.some((entry) => entry.id === entryId) && (picksRevealed || actorEntryIds.has(entryId));
    const resolvedSelectedEntryId =
      input.selectedEntryId && canViewSelectedEntry(input.selectedEntryId)
        ? input.selectedEntryId
        : myEntryId;
    const selectedEntry = resolvedSelectedEntryId
      ? entries.find((entry) => entry.id === resolvedSelectedEntryId) ?? null
      : null;
    const selectedEntryPicks = resolvedSelectedEntryId
      ? picksByEntry.get(resolvedSelectedEntryId) ?? []
      : [];
    const selectedSportEventParticipantIds = new Set(
      selectedEntryPicks.map((pick) => pick.sportEventParticipantId),
    );
    const availableSportEventParticipantIds = buildAvailableParticipantIds(context);

    const isComplete =
      rosterSize > 0
        ? entries.every((entry) => entry.pickCount >= rosterSize)
        : false;
    const status = mapContestStatusToSelectionStatus(contest.status, isComplete);

    return {
      contest,
      rosterSize,
      isCommissioner: actorMembership ? isCommissionerRole(actorMembership.role) : false,
      status,
      entries,
      picks: this.buildPickHistory({
        picks: visiblePicks,
        contestEntryById,
        tierByParticipantId,
        priceBySportEventParticipantId,
        engine,
      }),
      selectionGroups: this.buildSelectionGroups(context, engine, rosterSize, selectedSportEventParticipantIds),
      availableSportEventParticipantIds: [...availableSportEventParticipantIds],
      myEntryId,
      selectedEntryId: resolvedSelectedEntryId,
      selectedEntryName: selectedEntry?.name ?? null,
      tiebreakerValue: contestEntryById.get(resolvedSelectedEntryId ?? '')?.tiebreakerValue ?? null,
      isComplete,
      lineupSummary: resolvedSelectedEntryId
        ? engine.summarizeLineup({
          configuration,
          rosterSize,
          tiers,
          picks: selectedEntryPicks.map((pick) => ({
            participantId: pick.participant.participantId,
            price: priceBySportEventParticipantId.get(pick.sportEventParticipantId),
          })),
          openField: context.selectionParticipants.filter((participant) =>
            availableSportEventParticipantIds.has(participant.sportEventParticipantId)
            && !selectedSportEventParticipantIds.has(participant.sportEventParticipantId)),
        })
        : null,
    };
  }

  /**
   * The room's pick history, each pick placed in a round.
   *
   * A pick carries the round it was stored with, and these counters are the fallback for one
   * that does not: the running index within its entry, and within its entry's picks from the
   * same tier. The round it shows in is the engine's: in a tiered room it *is* the tier
   * number, which is why a tiered history is grouped by tier rather than by when the picks
   * were made.
   */
  private buildPickHistory(input: {
    picks: readonly ContestEntryPickWithParticipant[];
    contestEntryById: ReadonlyMap<string, ContestEntry>;
    tierByParticipantId: ReadonlyMap<string, { tierId: string; tierName: string; tierNumber: number }>;
    priceBySportEventParticipantId: ReadonlyMap<string, number | undefined>;
    engine: SelectionEngine;
  }): PickHistoryRow[] {
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
        pickNumber: pick.pickSequence ?? index + 1,
        round: input.engine.historyRound({ tierNumber: tier?.tierNumber, entryPickIndex }),
        pickInRound: pick.lineupSlot ?? tierPickIndex,
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

  /** The field as the engine groups it, with which rows the viewed entry holds. */
  private buildSelectionGroups(
    context: SelectionContext,
    engine: SelectionEngine,
    rosterSize: number,
    selectedSportEventParticipantIds: ReadonlySet<string>,
  ): SelectionGroup[] {
    return engine
      .groupField({ tiers: context.tiers, participants: context.selectionParticipants, rosterSize })
      .map((group) => ({
        ...group,
        participants: group.participants.map((participant) => ({
          ...participant,
          isSelected: selectedSportEventParticipantIds.has(participant.sportEventParticipantId),
        })),
      }));
  }

}

/** What is still selectable: every field row that is itself available. */
function buildAvailableParticipantIds(context: SelectionContext): Set<string> {
  return new Set(context.selectionParticipants
    .filter((participant) => participant.isAvailable)
    .map((participant) => participant.sportEventParticipantId));
}

/** The shape an engine reasons over: a pick's id, whom it points at, and its place. */
function toEntryPick(pick: ContestEntryPickWithParticipant): EntryPick {
  return { id: pick.id, participantId: pick.participant.participantId, lineupSlot: pick.lineupSlot };
}

/** Each field row's price in dollars, by its `sportEventParticipantId`. */
function buildPriceLookup(context: SelectionContext): ReadonlyMap<string, number | undefined> {
  return new Map(
    context.selectionParticipants.map((participant) => [participant.sportEventParticipantId, participant.price]),
  );
}

/** The contract error an engine's rejection answers with; one case per reject code. */
function rejectionError(
  rejection: SelectionRejection,
  request: { contestId: string; entryId: string; participantId: string; rosterSize: number },
): SelectionError {
  switch (rejection.code) {
    case SelectionRejectCode.ENTRY_COMPLETE:
      return selectionErrors.entryComplete(request.entryId, request.rosterSize);
    case SelectionRejectCode.PRICE_MISSING:
      return selectionErrors.priceMissing(request.participantId);
    case SelectionRejectCode.TIER_MISSING:
      return selectionErrors.tierMissing(request.participantId);
    case SelectionRejectCode.TIER_NOT_FOUND:
      return selectionErrors.tierNotFound(rejection.tierLabel, request.contestId);
  }
}

/** The context with one entry replaced by its freshly written row. */
function withEntry(context: SelectionContext, updated: ContestEntry): SelectionContext {
  return {
    ...context,
    entries: context.entries.map((entry) => (entry.id === updated.id ? updated : entry)),
  };
}
