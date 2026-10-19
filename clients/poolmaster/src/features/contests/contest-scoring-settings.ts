import {
  FinishPositionPointsSettingsSchema,
  SelectionType,
  KnockoutRoundPointsSettingsSchema,
  UpsetBonusRule,
  type ContestScoringSettings,
  type ParticipantScoringDefinitionId,
  type SportVocabulary,
} from '@poolmaster/shared/domain';
import type { ReactElement } from 'react';
import { FinishPositionPointsFields, KnockoutRoundPointsFields } from './contest-scoring-settings-fields';

/**
 * A contest's scoring settings as Create contest holds them: text from the inputs. Only the
 * fields of the contest's scoring definition are read; a definition that takes no settings reads
 * none of them.
 */
export type ScoringSettingsValues = {
  /** A finish-position contest's points by place, winner first: "5, 3, 1". */
  pointsTable: string;
  /** What a finish-position runner that does not finish scores. */
  didNotFinishPoints: string;
  /** A knockout contest's points for a win in each round, first round first: "1, 2, 4, 8". */
  roundValues: string;
  /** Whether a knockout win by the worse seed adds the seed difference. */
  upsetBonusRule: UpsetBonusRule;
  /** What the seed difference is multiplied by when the upset bonus is on. */
  upsetBonusMultiplier: string;
};

/** Before a preset fills them: blank, so nothing is sent that the commissioner did not see. */
export const EMPTY_SCORING_SETTINGS_VALUES: ScoringSettingsValues = {
  pointsTable: '',
  didNotFinishPoints: '',
  roundValues: '',
  upsetBonusRule: UpsetBonusRule.NONE,
  upsetBonusMultiplier: '1',
};

type ScoringSettingsResult =
  | { scoring: ContestScoringSettings | null; error: null }
  | { scoring: null; error: string };

export type ScoringSettingsFieldsProps = {
  onChange: (next: Partial<ScoringSettingsValues>) => void;
  /** How the contest's entries pick: a bracket's points are earned by its correct picks, not by the teams. */
  selectionType: SelectionType;
  vocabulary: SportVocabulary;
  values: ScoringSettingsValues;
};

/** What Create contest does with one scoring definition's settings. */
interface ScoringSettingsUi {
  /** The definition's inputs, or null when it takes no settings and so shows none. */
  Fields: ((props: ScoringSettingsFieldsProps) => ReactElement) | null;
  /** The form's values for a preset's settings; the other definitions' values are kept. */
  toValues: (scoring: ContestScoringSettings, current: ScoringSettingsValues) => ScoringSettingsValues;
  /**
   * The settings to send, or the first thing wrong with them. Null `scoring` sends none, and the
   * contest takes its template's preset or its sport's default.
   */
  parse: (values: ScoringSettingsValues) => ScoringSettingsResult;
  /** The sentence members read about how picks score, or null when the rules sentence says it all. */
  describe: (scoring: ContestScoringSettings | null) => string | null;
}

/** "5, 3, 1" as numbers. A blank, a non-whole number or a negative one reads as not a table. */
function parsePointsTable(text: string): number[] | null {
  const cells = text.split(/[\s,]+/).filter((cell) => cell !== '');
  if (cells.length === 0) {
    return null;
  }
  const points = cells.map(Number);
  return points.every((value) => Number.isInteger(value) && value >= 0) ? points : null;
}

const finishPositionPointsUi: ScoringSettingsUi = {
  Fields: FinishPositionPointsFields,
  toValues: (scoring, current) => (scoring.participantScoringDefinitionId === 'FINISH_POSITION_POINTS'
    ? {
      ...current,
      pointsTable: scoring.config.pointsTable.join(', '),
      didNotFinishPoints: String(scoring.config.didNotFinishPoints),
    }
    : current),
  parse: (values) => {
    const pointsTable = parsePointsTable(values.pointsTable);
    if (pointsTable === null) {
      return { scoring: null, error: 'Enter the points table as whole numbers, winner first, such as 5, 3, 1.' };
    }
    const didNotFinishText = values.didNotFinishPoints.trim();
    const didNotFinishPoints = didNotFinishText === '' ? Number.NaN : Number(didNotFinishText);
    // The shared schema is the server's own check: its message is the one the form shows.
    const parsed = FinishPositionPointsSettingsSchema.safeParse({ pointsTable, didNotFinishPoints });
    if (!parsed.success) {
      const issue = parsed.error.issues.at(0);
      return {
        scoring: null,
        error: issue?.path.at(0) === 'didNotFinishPoints'
          ? 'Points for not finishing must be a whole number, 0 or more.'
          : issue?.message ?? 'The points table is not valid.',
      };
    }
    return {
      scoring: { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: parsed.data },
      error: null,
    };
  },
  describe: (scoring) => (scoring?.participantScoringDefinitionId === 'FINISH_POSITION_POINTS'
    ? `Points by finishing place: ${scoring.config.pointsTable.join(', ')}.`
    : null),
};

/** A whole number of 1 or more, or NaN for a blank or anything else. */
function parseMultiplier(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

const knockoutRoundPointsUi: ScoringSettingsUi = {
  Fields: KnockoutRoundPointsFields,
  toValues: (scoring, current) => (scoring.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS'
    ? {
      ...current,
      roundValues: scoring.config.roundValues.join(', '),
      upsetBonusRule: scoring.config.upsetBonus.rule,
      upsetBonusMultiplier: scoring.config.upsetBonus.rule === UpsetBonusRule.SEED_DIFFERENCE
        ? String(scoring.config.upsetBonus.multiplier)
        : current.upsetBonusMultiplier,
    }
    : current),
  parse: (values) => {
    const roundValues = parsePointsTable(values.roundValues);
    if (roundValues === null) {
      return { scoring: null, error: 'Enter the points for a win in each round as whole numbers, first round first, such as 1, 2, 4, 8.' };
    }
    const upsetBonus = values.upsetBonusRule === UpsetBonusRule.SEED_DIFFERENCE
      ? { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: parseMultiplier(values.upsetBonusMultiplier) }
      : { rule: UpsetBonusRule.NONE };
    // The shared schema is the server's own check: its message is the one the form shows.
    const parsed = KnockoutRoundPointsSettingsSchema.safeParse({ roundValues, upsetBonus });
    if (!parsed.success) {
      const issue = parsed.error.issues.at(0);
      return {
        scoring: null,
        error: issue?.path.at(0) === 'upsetBonus'
          ? 'The upset bonus multiplier must be a whole number, 1 or more.'
          : issue?.message ?? 'The round points are not valid.',
      };
    }
    return {
      scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: parsed.data },
      error: null,
    };
  },
  describe: (scoring) => {
    if (scoring?.participantScoringDefinitionId !== 'KNOCKOUT_ROUND_POINTS') {
      return null;
    }
    const { roundValues, upsetBonus } = scoring.config;
    const perRound = `Points for a win in each round: ${roundValues.join(', ')}.`;
    switch (upsetBonus.rule) {
      case UpsetBonusRule.NONE:
        return perRound;
      case UpsetBonusRule.SEED_DIFFERENCE:
        return upsetBonus.multiplier === 1
          ? `${perRound} A win over a better seed adds the seed difference.`
          : `${perRound} A win over a better seed adds the seed difference times ${upsetBonus.multiplier}.`;
    }
  },
};

/** Golf's total against par takes no settings: nothing to show, nothing to send. */
const noSettingsUi: ScoringSettingsUi = {
  Fields: null,
  toValues: (_scoring, current) => current,
  parse: () => ({ scoring: null, error: null }),
  describe: () => null,
};

/**
 * Create contest's scoring settings, keyed by the contest's scoring definition. Exhaustive over
 * the definition ids, so a definition added to the shared registry fails the web build until
 * Create contest knows whether it takes settings. Reached through the event's sport definition
 * or a preset's scoring, never by comparing sports.
 */
export const SCORING_SETTINGS_UI: Readonly<Record<ParticipantScoringDefinitionId, ScoringSettingsUi>> = {
  GOLF_RELATIVE_TO_PAR_TOTAL: noSettingsUi,
  FINISH_POSITION_POINTS: finishPositionPointsUi,
  KNOCKOUT_ROUND_POINTS: knockoutRoundPointsUi,
};

/**
 * The scoring settings Create contest offers a contest of this selection type. A pick'em pool
 * scores by its mode alone (1 point, or the pick's confidence value), so it takes none; every
 * other type takes its scoring definition's.
 */
export function scoringSettingsUiFor(selectionType: SelectionType, definitionId: ParticipantScoringDefinitionId): ScoringSettingsUi {
  return selectionType === SelectionType.PICK_EM ? noSettingsUi : SCORING_SETTINGS_UI[definitionId];
}
