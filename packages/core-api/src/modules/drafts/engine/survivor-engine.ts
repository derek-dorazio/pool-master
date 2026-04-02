/**
 * Survivor / Knockout Engine.
 *
 * Two pick styles:
 *   LIVE_PICK — one pick per period, submitted before each period begins.
 *   LOCKED_PICK — all picks submitted upfront before the event starts.
 *
 * Shared config options:
 *   oneEntityPerSeason — each team/player usable only once (standard: true)
 *   picksPerPeriod — 1 standard; 2 = Double Pick (both must win)
 *   strikesBeforeElimination — 0 = instant elimination
 *   buybacksAllowed — allow one re-entry after elimination
 *
 * Multiplier variant (NCAAF-5 hold'em):
 *   Players who advance carry a growing multiplier. Eliminated team = forced
 *   replacement at 1×.
 *
 * Used by: NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, NCAAF-5,
 *          SOC-5, TEN-5, UFC-5
 */

import { SurvivorStyle } from '@poolmaster/shared/domain';

// --- Types ---

export interface SurvivorConfig {
  survivorStyle: SurvivorStyle;
  totalPeriods: number;
  picksPerPeriod: number;
  oneEntityPerSeason: boolean;
  strikesBeforeElimination: number;
  buybacksAllowed: boolean;
  multipliers?: number[];
}

export interface SurvivorState {
  contestId: string;
  config: SurvivorConfig;
  currentPeriod: number;
  entries: SurvivorEntryState[];
}

export interface SurvivorEntryState {
  entryId: string;
  picks: SurvivorPick[];
  strikes: number;
  isEliminated: boolean;
  hasBoughtBack: boolean;
}

export interface SurvivorPick {
  period: number;
  participantId: string;
  pickedAt: Date;
  isCorrect?: boolean;
  multiplier?: number;
  isReplacement: boolean;
}

export interface SurvivorPickValidation {
  valid: boolean;
  reason?: string;
}

// --- Engine ---

export class SurvivorEngine {
  /**
   * Validate a proposed survivor pick.
   */
  validatePick(
    state: SurvivorState,
    entryId: string,
    participantId: string,
    period: number,
  ): SurvivorPickValidation {
    const entry = state.entries.find((e) => e.entryId === entryId);

    if (entry?.isEliminated) {
      return { valid: false, reason: 'Entry has been eliminated' };
    }

    if (state.config.survivorStyle === SurvivorStyle.LIVE_PICK && period !== state.currentPeriod) {
      return { valid: false, reason: `Can only pick for current period (${state.currentPeriod})` };
    }

    if (state.config.survivorStyle === SurvivorStyle.LOCKED_PICK && state.currentPeriod > 1) {
      return { valid: false, reason: 'All picks must be submitted before period 1 (locked mode)' };
    }

    const existingPicks = entry?.picks.filter((p) => p.period === period) ?? [];
    if (existingPicks.length >= state.config.picksPerPeriod) {
      return {
        valid: false,
        reason: `Already submitted ${existingPicks.length}/${state.config.picksPerPeriod} picks for period ${period}`,
      };
    }

    if (state.config.oneEntityPerSeason && entry) {
      const usedIds = new Set(entry.picks.map((p) => p.participantId));
      if (usedIds.has(participantId)) {
        return { valid: false, reason: `Participant ${participantId} already used this season` };
      }
    }

    return { valid: true };
  }

  /**
   * Submit a live pick for the current period. Returns updated state.
   */
  submitLivePick(
    state: SurvivorState,
    entryId: string,
    participantId: string,
  ): SurvivorState {
    const period = state.currentPeriod;
    const multiplier = state.config.multipliers?.[period - 1] ?? undefined;

    return this.addPick(state, entryId, participantId, period, multiplier, false);
  }

  /**
   * Submit all locked picks upfront (locked mode). Returns updated state.
   */
  submitLockedPicks(
    state: SurvivorState,
    entryId: string,
    picks: Array<{ period: number; participantId: string }>,
  ): SurvivorState {
    let updatedState = state;

    for (const pick of picks) {
      const validation = this.validatePick(updatedState, entryId, pick.participantId, pick.period);
      if (!validation.valid) {
        throw new Error(`Invalid pick for period ${pick.period}: ${validation.reason}`);
      }
      const multiplier = state.config.multipliers?.[pick.period - 1] ?? undefined;
      updatedState = this.addPick(updatedState, entryId, pick.participantId, pick.period, multiplier, false);
    }

    return updatedState;
  }

  /**
   * Resolve a period — mark picks as correct/incorrect, apply eliminations.
   */
  resolvePeriod(
    state: SurvivorState,
    period: number,
    winnerIds: Set<string>,
  ): SurvivorState {
    const updatedEntries = state.entries.map((entry) => {
      if (entry.isEliminated) return entry;

      const periodPicks = entry.picks.filter((p) => p.period === period);

      if (periodPicks.length === 0) {
        return this.applyMissedPick(entry, state.config);
      }

      const resolvedPicks = entry.picks.map((pick) => {
        if (pick.period !== period) return pick;
        return { ...pick, isCorrect: winnerIds.has(pick.participantId) };
      });

      const wrongPicks = resolvedPicks.filter(
        (p) => p.period === period && p.isCorrect === false,
      );

      const strikes = entry.strikes + wrongPicks.length;
      let isEliminated = strikes > state.config.strikesBeforeElimination;  

      if (state.config.picksPerPeriod > 1) {
        const allWrong = periodPicks.length === wrongPicks.length;
        if (allWrong) {
          isEliminated = true;
        }
      }

      return { ...entry, picks: resolvedPicks, strikes, isEliminated };
    });

    return {
      ...state,
      entries: updatedEntries,
      currentPeriod: period + 1,
    };
  }

  /**
   * Process a buyback for an eliminated entry.
   */
  buyback(state: SurvivorState, entryId: string): SurvivorState {
    if (!state.config.buybacksAllowed) {
      throw new Error('Buybacks are not allowed in this contest');
    }

    const updatedEntries = state.entries.map((entry) => {
      if (entry.entryId !== entryId) return entry;
      if (!entry.isEliminated) {
        throw new Error('Entry is not eliminated');
      }
      if (entry.hasBoughtBack) {
        throw new Error('Entry has already used their buyback');
      }
      return { ...entry, isEliminated: false, hasBoughtBack: true };
    });

    return { ...state, entries: updatedEntries };
  }

  /**
   * Submit a replacement pick (multiplier survivor — NCAAF-5 hold'em).
   * When a player's team is eliminated, the entry picks a replacement at 1× multiplier.
   */
  submitReplacementPick(
    state: SurvivorState,
    entryId: string,
    participantId: string,
    period: number,
  ): SurvivorState {
    return this.addPick(state, entryId, participantId, period, 1, true);
  }

  /**
   * Get all surviving (non-eliminated) entries.
   */
  getSurvivors(state: SurvivorState): SurvivorEntryState[] {
    return state.entries.filter((e) => !e.isEliminated);
  }

  /**
   * Check if the contest has a single winner.
   */
  hasWinner(state: SurvivorState): boolean {
    const survivors = this.getSurvivors(state);
    return survivors.length === 1;
  }

  /**
   * Get entries that still need to submit picks for the current period.
   */
  getPendingEntries(state: SurvivorState): SurvivorEntryState[] {
    return state.entries.filter((entry) => {
      if (entry.isEliminated) return false;
      const periodPicks = entry.picks.filter((p) => p.period === state.currentPeriod);
      return periodPicks.length < state.config.picksPerPeriod;
    });
  }

  // --- Private helpers ---

  private addPick(
    state: SurvivorState,
    entryId: string,
    participantId: string,
    period: number,
    multiplier: number | undefined,
    isReplacement: boolean,
  ): SurvivorState {
    const newPick: SurvivorPick = {
      period,
      participantId,
      pickedAt: new Date(),
      multiplier,
      isReplacement,
    };

    const entryExists = state.entries.some((e) => e.entryId === entryId);

    const updatedEntries = entryExists
      ? state.entries.map((entry) => {
          if (entry.entryId !== entryId) return entry;
          return { ...entry, picks: [...entry.picks, newPick] };
        })
      : [
          ...state.entries,
          { entryId, picks: [newPick], strikes: 0, isEliminated: false, hasBoughtBack: false },
        ];

    return { ...state, entries: updatedEntries };
  }

  private applyMissedPick(
    entry: SurvivorEntryState,
    config: SurvivorConfig,
  ): SurvivorEntryState {
    const strikes = entry.strikes + 1;
    const isEliminated = strikes > config.strikesBeforeElimination;
    return { ...entry, strikes, isEliminated };
  }
}
