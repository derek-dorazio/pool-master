import type { ReactElement } from 'react';
import { PickEmMode, RANDOM_DRAW_PICKS_PER_ENTRY_MAX, SQUARES_PER_ENTRY_MAX, SelectionType, getTieredRosterSize, type SportNoun } from '@poolmaster/shared/domain';
import { Checkbox, FormField, formatDollars, Input, SegmentedControl, Select } from '@/features/shared/ui';
import type { BracketStartRoundOption } from './bracket-start-round';
import { describeBracketRules, describePickEmMode, describeSurvivorRules, formatPickEmModeName, isSecondChanceBracket } from './contest-rules';
import { defaultCountedScoresFor, perEntryLabel, tiersInPlayFor, type ContestRulesValues, type EditableSelectionType } from './contest-rules-form';

function TieredRulesInputs({
  onChange,
  participant,
  tierCount,
  values,
}: {
  onChange: (next: Partial<ContestRulesValues>) => void;
  participant: SportNoun;
  tierCount: number;
  values: ContestRulesValues;
}) {
  const picksPerTier = Number(values.picksPerTier);
  const tiersInPlay = tiersInPlayFor(values.tiersUsed, tierCount);
  const rosterSize = tierCount > 0 && Number.isInteger(picksPerTier) && picksPerTier >= 1
    ? getTieredRosterSize(tiersInPlay, picksPerTier)
    : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        helperText={tierCount > 0
          ? `${tiersInPlay} tiers × ${values.picksPerTier || '?'} = ${rosterSize ?? '—'} ${participant.many} per entry`
          : 'The event has no tiers yet.'}
        label="Picks per tier"
      >
        <Input
          data-testid="contest-tiered-picks-per-tier"
          min={1}
          onChange={(event) => {
            const next = event.target.value;
            const countedScores = defaultCountedScoresFor(next, tiersInPlay);
            onChange(countedScores === null ? { picksPerTier: next } : { countedScores, picksPerTier: next });
          }}
          type="number"
          value={values.picksPerTier}
        />
      </FormField>
      <FormField
        helperText={tierCount > 0
          ? `The first tiers only, in tier order. Leave empty for all ${tierCount}.`
          : 'The first tiers only, in tier order. Leave empty for every tier.'}
        label="Tiers to pick from"
      >
        <Input
          data-testid="contest-tiered-tiers-used"
          min={1}
          onChange={(event) => onChange({ tiersUsed: event.target.value })}
          placeholder={tierCount > 0 ? `All ${tierCount}` : 'All'}
          type="number"
          value={values.tiersUsed}
        />
      </FormField>
      <FormField
        helperText={rosterSize !== null ? `Best ${values.countedScores || '?'} of ${rosterSize}` : undefined}
        label="Scores that count"
      >
        <Input
          data-testid="contest-tiered-counted-scores"
          min={1}
          onChange={(event) => onChange({ countedScores: event.target.value })}
          type="number"
          value={values.countedScores}
        />
      </FormField>
    </div>
  );
}

/** The budget inputs (#93). The salary cap is the event's, so it shows but does not edit. */
function BudgetRulesInputs({
  onChange,
  participant,
  salaryCap,
  values,
}: {
  onChange: (next: Partial<ContestRulesValues>) => void;
  participant: SportNoun;
  salaryCap: number | null;
  values: ContestRulesValues;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={perEntryLabel(participant)}>
          <Input
            data-testid="contest-budget-roster-size"
            min={1}
            onChange={(event) => onChange({ rosterSize: event.target.value })}
            type="number"
            value={values.rosterSize}
          />
        </FormField>
        <FormField
          helperText={`Best ${values.countedScores || '?'} of ${values.rosterSize || '?'}`}
          label="Scores that count"
        >
          <Input
            data-testid="contest-budget-counted-scores"
            min={1}
            onChange={(event) => onChange({ countedScores: event.target.value })}
            type="number"
            value={values.countedScores}
          />
        </FormField>
      </div>
      <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm" data-testid="contest-budget-salary-cap">
        <span className="font-semibold">
          {salaryCap === null ? 'Salary cap not set' : `${formatDollars(salaryCap)} salary cap`}
        </span>
        <span className="block text-xs text-muted-foreground">
          {salaryCap === null
            ? `The event’s ${participant.many} have no prices yet.`
            : 'Set by the event’s prices, the same for every budget contest on it.'}
        </span>
      </div>
    </div>
  );
}

/**
 * The random-draw inputs: how many golfers the commissioner's draw deals each entry, and how many
 * of their scores count. Nobody picks, so there is nothing else to set.
 */
function RandomDrawRulesInputs({
  onChange,
  participant,
  values,
}: {
  onChange: (next: Partial<ContestRulesValues>) => void;
  participant: SportNoun;
  values: ContestRulesValues;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        helperText={`The draw deals each entry this many ${participant.many} at random.`}
        label={perEntryLabel(participant)}
      >
        <Input
          data-testid="contest-draw-picks-per-entry"
          max={RANDOM_DRAW_PICKS_PER_ENTRY_MAX}
          min={1}
          onChange={(event) => onChange({ picksPerEntry: event.target.value })}
          type="number"
          value={values.picksPerEntry}
        />
      </FormField>
      <FormField
        helperText={`Best ${values.countedScores || '?'} of ${values.picksPerEntry || '?'}`}
        label="Scores that count"
      >
        <Input
          data-testid="contest-draw-counted-scores"
          min={1}
          onChange={(event) => onChange({ countedScores: event.target.value })}
          type="number"
          value={values.countedScores}
        />
      </FormField>
    </div>
  );
}

const PICK_EM_MODES = Object.values(PickEmMode);

const AGAINST_THE_SPREAD_HINT = 'Pick the team that covers each game\'s spread. A game that lands exactly on the spread scores nothing.';

const SURVIVOR_REUSE_TEAMS_HINT = 'Each entry starts again once it has picked every team. It matters only when the contest has more weeks than the league has teams.';

/** The pick'em inputs (#716): straight up or ranked by confidence, and against the spread or not (#720). */
function PickEmRulesInputs({
  onChange,
  values,
}: {
  onChange: (next: Partial<ContestRulesValues>) => void;
  values: ContestRulesValues;
}) {
  return (
    <div className="space-y-4">
      <FormField helperText={describePickEmMode(values.pickEmMode)} label="Mode">
        <SegmentedControl
          aria-label="Mode"
          onChange={(value) => {
            const pickEmMode = PICK_EM_MODES.find((mode) => mode === value);
            if (pickEmMode) {
              onChange({ pickEmMode });
            }
          }}
          options={PICK_EM_MODES.map((mode) => ({
            label: formatPickEmModeName(mode),
            testId: `contest-pick-em-mode-${mode}`,
            value: mode,
          }))}
          value={values.pickEmMode}
        />
      </FormField>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-3 font-medium text-foreground">
          <Checkbox
            aria-describedby="contest-pick-em-against-the-spread-hint"
            checked={values.pickEmAgainstTheSpread}
            data-testid="contest-pick-em-against-the-spread"
            onChange={(event) => onChange({ pickEmAgainstTheSpread: event.target.checked })}
          />
          <span>Against the spread</span>
        </label>
        <p className="text-muted-foreground" id="contest-pick-em-against-the-spread-hint">{AGAINST_THE_SPREAD_HINT}</p>
      </div>
    </div>
  );
}

/**
 * The bracket input (#721): where the bracket starts, the full bracket or a later round for a
 * second-chance bracket, among the rounds the event offers. Every game from there on is picked,
 * and the round points below say what each is worth.
 */
function BracketRulesInputs({
  onChange,
  startRounds,
  values,
}: {
  onChange: (next: Partial<ContestRulesValues>) => void;
  startRounds: readonly BracketStartRoundOption[];
  values: ContestRulesValues;
}) {
  const chosen = startRounds.find((option) => String(option.roundNumber) === values.startsAtRound) ?? null;
  const startRoundName = chosen && isSecondChanceBracket(chosen.roundNumber) ? chosen.name : null;
  return (
    <div className="space-y-3">
      {startRounds.length ? (
        <FormField
          helperText="A second-chance bracket is picked from a later round on, and closes at that round's first game."
          label="Starts at"
        >
          <Select
            data-testid="contest-bracket-starts-at-round"
            onChange={(event) => onChange({ startsAtRound: event.target.value })}
            value={chosen ? values.startsAtRound : ''}
          >
            {chosen ? null : <option disabled value="">Choose a round</option>}
            {startRounds.map((option) => (
              <option key={option.roundNumber} value={String(option.roundNumber)}>{option.label}</option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <p className="text-sm text-muted-foreground" data-testid="contest-bracket-rules">{describeBracketRules(startRoundName)}</p>
    </div>
  );
}

type RulesInputsProps = {
  bracketStartRounds: readonly BracketStartRoundOption[];
  onChange: (next: Partial<ContestRulesValues>) => void;
  participant: SportNoun;
  salaryCap: number | null;
  tierCount: number;
  values: ContestRulesValues;
};

/** Each format's own inputs. A `Record` over the type, so a new format without inputs fails the typecheck. */
const RULES_INPUTS: Record<EditableSelectionType, (props: RulesInputsProps) => ReactElement> = {
  [SelectionType.TIERED]: ({ onChange, participant, tierCount, values }: RulesInputsProps) => (
    <TieredRulesInputs onChange={onChange} participant={participant} tierCount={tierCount} values={values} />
  ),
  [SelectionType.BUDGET_PICK]: ({ onChange, participant, salaryCap, values }: RulesInputsProps) => (
    <BudgetRulesInputs onChange={onChange} participant={participant} salaryCap={salaryCap} values={values} />
  ),
  [SelectionType.RANDOM_DRAW]: ({ onChange, participant, values }: RulesInputsProps) => (
    <RandomDrawRulesInputs onChange={onChange} participant={participant} values={values} />
  ),
  [SelectionType.PICK_EM]: ({ onChange, values }: RulesInputsProps) => (
    <PickEmRulesInputs onChange={onChange} values={values} />
  ),
  [SelectionType.BRACKET]: ({ bracketStartRounds, onChange, values }: RulesInputsProps) => (
    <BracketRulesInputs onChange={onChange} startRounds={bracketStartRounds} values={values} />
  ),
  [SelectionType.SURVIVOR]: ({ onChange, values }: RulesInputsProps) => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="contest-survivor-rules">{describeSurvivorRules(values.survivorReuseTeams)}</p>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-3 font-medium text-foreground">
          <Checkbox
            aria-describedby="contest-survivor-reuse-teams-hint"
            checked={values.survivorReuseTeams}
            data-testid="contest-survivor-reuse-teams"
            onChange={(event) => onChange({ survivorReuseTeams: event.target.checked })}
          />
          <span>Teams can be picked again once every team is used</span>
        </label>
        <p className="text-muted-foreground" id="contest-survivor-reuse-teams-hint">{SURVIVOR_REUSE_TEAMS_HINT}</p>
      </div>
    </div>
  ),
  [SelectionType.SQUARES]: ({ onChange, values }: RulesInputsProps) => (
    <FormField helperText="Boxes nobody claims stay empty, and a quarter won by an empty box has no winner." label="Boxes per entry">
      <Input
        data-testid="contest-squares-boxes-per-entry"
        max={SQUARES_PER_ENTRY_MAX}
        min={1}
        onChange={(event) => onChange({ maxSquaresPerEntry: event.target.value })}
        type="number"
        value={values.maxSquaresPerEntry}
      />
    </FormField>
  ),
};

/**
 * The rules inputs for a contest's format: picks per tier and scores that count for a tiered
 * contest, golfers per entry and scores that count under the event's salary cap for a budget
 * one, golfers dealt per entry and scores that count for a random draw, the mode for a pick'em
 * contest, where a bracket starts, a survivor contest's rules, a squares contest's boxes per entry, then entries per member with No limit (a squares contest takes one). Create and Edit contest both use it, so a new format
 * adds its fields here once.
 */
export function ContestRulesFields({
  bracketStartRounds = [],
  onChange,
  participant,
  salaryCap,
  selectionType,
  tierCount,
  values,
}: {
  /** The rounds a bracket on the event can start at; only a bracket reads them. */
  bracketStartRounds?: readonly BracketStartRoundOption[];
  onChange: (next: Partial<ContestRulesValues>) => void;
  /** What the event's sport calls a competitor: "golfer", "horse". */
  participant: SportNoun;
  /** The event's salary cap, or null while its field is unpriced. */
  salaryCap: number | null;
  selectionType: EditableSelectionType;
  tierCount: number;
  values: ContestRulesValues;
}) {
  return (
    <div className="space-y-4">
      {RULES_INPUTS[selectionType]({ bracketStartRounds, onChange, participant, salaryCap, tierCount, values })}
      {selectionType === SelectionType.SQUARES ? (
        // The box limit is per entry, so a squares contest takes one entry per member (#711).
        <p className="text-sm text-muted-foreground" data-testid="contest-squares-one-entry">One entry per member, which holds their boxes.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Entries per member">
            <Input
              data-testid="contest-max-entries"
              disabled={values.unlimitedEntries}
              min={1}
              onChange={(event) => onChange({ maxEntriesPerTeam: event.target.value })}
              type="number"
              value={values.unlimitedEntries ? '' : values.maxEntriesPerTeam}
            />
          </FormField>
          <label className="flex items-end gap-3 pb-3 text-sm font-medium text-foreground">
            <Checkbox
              checked={values.unlimitedEntries}
              data-testid="contest-max-entries-unlimited"
              onChange={(event) => onChange({ unlimitedEntries: event.target.checked })}
            />
            No limit
          </label>
        </div>
      )}
    </div>
  );
}
