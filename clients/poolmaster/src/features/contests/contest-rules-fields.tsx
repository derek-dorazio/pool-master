import type { ReactElement } from 'react';
import {
  PickEmMode,
  RANDOM_DRAW_PICKS_PER_ENTRY_MAX,
  SQUARES_PER_ENTRY_MAX,
  SURVIVOR_LIVES_MAX,
  SelectionType,
  type SportNoun,
  describeBracketRules,
  formatDollars,
  describePickEmMode,
  describeSurvivorRules,
  formatPickEmModeName,
  getTieredRosterSize,
} from '@poolmaster/shared/domain';
import { Checkbox, FormField, Input, SegmentedControl, Text } from '@/features/shared/ui';
import { defaultCountedScoresFor, perEntryLabel, type ContestRulesValues, type EditableSelectionType } from './contest-rules-form';

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
  const rosterSize = tierCount > 0 && Number.isInteger(picksPerTier) && picksPerTier >= 1
    ? getTieredRosterSize(tierCount, picksPerTier)
    : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        helperText={tierCount > 0
          ? `${tierCount} tiers × ${values.picksPerTier || '?'} = ${rosterSize ?? '—'} ${participant.many} per entry`
          : 'The event has no tiers yet.'}
        label="Picks per tier"
      >
        <Input
          data-testid="contest-tiered-picks-per-tier"
          min={1}
          onChange={(event) => {
            const next = event.target.value;
            const countedScores = defaultCountedScoresFor(next, tierCount);
            onChange(countedScores === null ? { picksPerTier: next } : { countedScores, picksPerTier: next });
          }}
          type="number"
          value={values.picksPerTier}
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
      <Text as="div" className="rounded-xl bg-muted/40 px-4 py-3" data-testid="contest-budget-salary-cap">
        <Text size="inherit" weight="semibold">
          {salaryCap === null ? 'Salary cap not set' : `${formatDollars(salaryCap)} salary cap`}
        </Text>
        <Text className="block" variant="caption">
          {salaryCap === null
            ? `The event’s ${participant.many} have no prices yet.`
            : 'Set by the event’s prices, the same for every budget contest on it.'}
        </Text>
      </Text>
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
      <Text as="div" className="space-y-1">
        <label className="flex items-center gap-3 font-medium text-foreground">
          <Checkbox
            aria-describedby="contest-pick-em-against-the-spread-hint"
            checked={values.pickEmAgainstTheSpread}
            data-testid="contest-pick-em-against-the-spread"
            onChange={(event) => onChange({ pickEmAgainstTheSpread: event.target.checked })}
          />
          <span>Against the spread</span>
        </label>
        <Text as="p" id="contest-pick-em-against-the-spread-hint" size="inherit" tone="muted">{AGAINST_THE_SPREAD_HINT}</Text>
      </Text>
    </div>
  );
}

/**
 * The bracket rules (#721): every game of the event is picked, from the first round to the
 * final, and the round points below say what each is worth.
 */
function BracketRulesInputs() {
  return <Text as="p" data-testid="contest-bracket-rules" variant="meta">{describeBracketRules()}</Text>;
}

/** The survivor Lives choice (#1754): 1 up to the most a contest allows. */
const SURVIVOR_LIVES_CHOICES = Array.from({ length: SURVIVOR_LIVES_MAX }, (_, index) => index + 1);

type RulesInputsProps = {
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
  [SelectionType.BRACKET]: () => <BracketRulesInputs />,
  [SelectionType.SURVIVOR]: ({ onChange, values }: RulesInputsProps) => (
    <div className="space-y-4">
      <Text as="p" data-testid="contest-survivor-rules" variant="meta">{describeSurvivorRules(values.survivorReuseTeams, values.survivorLives)}</Text>
      <FormField label="Lives">
        <SegmentedControl
          aria-label="Lives"
          onChange={(value) => {
            const survivorLives = SURVIVOR_LIVES_CHOICES.find((lives) => String(lives) === value);
            if (survivorLives !== undefined) {
              onChange({ survivorLives });
            }
          }}
          options={SURVIVOR_LIVES_CHOICES.map((lives) => ({
            label: String(lives),
            testId: `contest-survivor-lives-${String(lives)}`,
            value: String(lives),
          }))}
          value={String(values.survivorLives)}
        />
      </FormField>
      <Text as="div" className="space-y-1">
        <label className="flex items-center gap-3 font-medium text-foreground">
          <Checkbox
            aria-describedby="contest-survivor-reuse-teams-hint"
            checked={values.survivorReuseTeams}
            data-testid="contest-survivor-reuse-teams"
            onChange={(event) => onChange({ survivorReuseTeams: event.target.checked })}
          />
          <span>Teams can be picked again once every team is used</span>
        </label>
        <Text as="p" id="contest-survivor-reuse-teams-hint" size="inherit" tone="muted">{SURVIVOR_REUSE_TEAMS_HINT}</Text>
      </Text>
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
 * contest, a bracket's rules, a survivor contest's rules, a squares contest's boxes per entry, then entries per member with No limit (a squares contest takes one). Create and Edit contest both use it, so a new format
 * adds its fields here once.
 */
export function ContestRulesFields({
  onChange,
  participant,
  salaryCap,
  selectionType,
  tierCount,
  values,
}: {
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
      {RULES_INPUTS[selectionType]({ onChange, participant, salaryCap, tierCount, values })}
      {selectionType === SelectionType.SQUARES ? (
        // The box limit is per entry, so a squares contest takes one entry per member (#711).
        <Text as="p" data-testid="contest-squares-one-entry" variant="meta">One entry per member, which holds their boxes.</Text>
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
