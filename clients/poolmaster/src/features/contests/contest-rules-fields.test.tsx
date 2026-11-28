import { fireEvent, render, screen } from '@testing-library/react';
import { PickEmMode, SelectionType, Sport, sportVocabulary } from '@poolmaster/shared/domain';
import { describe, expect, it, vi } from 'vitest';
import { ContestRulesFields } from './contest-rules-fields';
import { RULES_LIMITS, tieredChoices } from '@/test/rules-bounds';
import { DEFAULT_CONTEST_RULES, type ContestRulesBounds } from './contest-rules-form';

/** The API's bounds for an event with no tiers yet, and for six tiers of five. */
const NO_TIERS: ContestRulesBounds = { limits: RULES_LIMITS, tieredRosterChoices: [] };
const SIX_TIERS: ContestRulesBounds = { limits: RULES_LIMITS, tieredRosterChoices: tieredChoices([5, 5, 5, 5, 5, 5]) };

const TEAM = sportVocabulary(Sport.FOOTBALL).participant;

describe('contest rules fields for a pick\'em contest', () => {
  it('offers the two modes instead of roster size and scores that count, and reports the mode chosen', () => {
    const onChange = vi.fn();
    render(
      <ContestRulesFields
        bounds={NO_TIERS}
        onChange={onChange}
        participant={TEAM}
        salaryCap={null}
        selectionType={SelectionType.PICK_EM}
        tierCount={0}
        values={DEFAULT_CONTEST_RULES}
      />,
    );

    expect(screen.getByTestId('contest-pick-em-mode-STRAIGHT_UP')).toBeChecked();
    expect(screen.getByText('Pick the winner of every game.')).toBeInTheDocument();
    expect(screen.queryByText('Scores that count')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-pick-em-mode-CONFIDENCE'));

    expect(onChange).toHaveBeenCalledWith({ pickEmMode: PickEmMode.CONFIDENCE });
  });

  it('offers scoring against the spread, off by default, and reports it when ticked', () => {
    const onChange = vi.fn();
    render(
      <ContestRulesFields
        bounds={NO_TIERS}
        onChange={onChange}
        participant={TEAM}
        salaryCap={null}
        selectionType={SelectionType.PICK_EM}
        tierCount={0}
        values={DEFAULT_CONTEST_RULES}
      />,
    );

    expect(screen.getByTestId('contest-pick-em-against-the-spread')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('contest-pick-em-against-the-spread'));

    expect(onChange).toHaveBeenCalledWith({ pickEmAgainstTheSpread: true });
  });
});

describe('contest rules fields for a survivor contest', () => {
  it('lets teams be picked again once every team is used, on by default, reports it when unticked, and says so in the rules', () => {
    const onChange = vi.fn();
    render(
      <ContestRulesFields
        bounds={NO_TIERS}
        onChange={onChange}
        participant={TEAM}
        salaryCap={null}
        selectionType={SelectionType.SURVIVOR}
        tierCount={0}
        values={DEFAULT_CONTEST_RULES}
      />,
    );

    expect(screen.getByTestId('contest-survivor-reuse-teams')).toBeChecked();
    expect(screen.getByTestId('contest-survivor-rules')).toHaveTextContent('never the same team twice until every team has been picked');
    fireEvent.click(screen.getByTestId('contest-survivor-reuse-teams'));

    expect(onChange).toHaveBeenCalledWith({ survivorReuseTeams: false });
  });

  it('offers Lives of 1 or 2, starting at 1, reports the choice, and names the second life in the rules only with 2', () => {
    const onChange = vi.fn();
    const props = { bounds: NO_TIERS, onChange, participant: TEAM, salaryCap: null, selectionType: SelectionType.SURVIVOR, tierCount: 0 } as const;
    const { rerender } = render(<ContestRulesFields {...props} values={DEFAULT_CONTEST_RULES} />);

    expect(screen.getByTestId('contest-survivor-lives-1')).toBeChecked();
    expect(screen.getByTestId('contest-survivor-rules')).not.toHaveTextContent('lose once');
    fireEvent.click(screen.getByTestId('contest-survivor-lives-2'));
    expect(onChange).toHaveBeenCalledWith({ survivorLives: 2 });

    rerender(<ContestRulesFields {...props} values={{ ...DEFAULT_CONTEST_RULES, survivorLives: 2 }} />);
    expect(screen.getByTestId('contest-survivor-rules')).toHaveTextContent('You can lose once and stay in; a second loss puts you out.');
  });
});

describe('contest rules fields for a tiered contest', () => {
  it('picks from every tier of the event, so the roster reads the event\'s tier count times the picks per tier and there is no tier count to choose', () => {
    render(
      <ContestRulesFields
        bounds={SIX_TIERS}
        onChange={vi.fn()}
        participant={sportVocabulary(Sport.GOLF).participant}
        salaryCap={null}
        selectionType={SelectionType.TIERED}
        tierCount={6}
        values={DEFAULT_CONTEST_RULES}
      />,
    );

    expect(screen.getByText('6 tiers × 1 = 6 golfers per entry')).toBeInTheDocument();
    expect(screen.queryByText('Tiers to pick from')).not.toBeInTheDocument();
  });
});

describe('contest rules fields for a budget contest', () => {
  it('says the salary cap is not set and the field has no prices yet when the event has no cap, and marks unset counts with a question mark', () => {
    render(
      <ContestRulesFields
        bounds={NO_TIERS}
        onChange={vi.fn()}
        participant={TEAM}
        salaryCap={null}
        selectionType={SelectionType.BUDGET_PICK}
        tierCount={0}
        values={{ ...DEFAULT_CONTEST_RULES, countedScores: '', rosterSize: '' }}
      />,
    );

    expect(screen.getByTestId('contest-budget-salary-cap')).toHaveTextContent(`Salary cap not set`);
    expect(screen.getByTestId('contest-budget-salary-cap')).toHaveTextContent(`have no prices yet`);
    expect(screen.getByText('Best ? of ?')).toBeInTheDocument();
  });

  it('shows the event\'s salary cap, which the commissioner cannot edit, and the counted scores of the roster', () => {
    render(
      <ContestRulesFields
        bounds={NO_TIERS}
        onChange={vi.fn()}
        participant={TEAM}
        salaryCap={50000}
        selectionType={SelectionType.BUDGET_PICK}
        tierCount={0}
        values={{ ...DEFAULT_CONTEST_RULES, countedScores: '3', rosterSize: '4' }}
      />,
    );

    expect(screen.getByTestId('contest-budget-salary-cap')).toHaveTextContent('salary cap');
    expect(screen.getByTestId('contest-budget-salary-cap')).not.toHaveTextContent('Salary cap not set');
    expect(screen.getByText('Best 3 of 4')).toBeInTheDocument();
  });
});
