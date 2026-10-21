import { fireEvent, render, screen } from '@testing-library/react';
import { PickEmMode, SelectionType, Sport, getSportDefinition } from '@poolmaster/shared/domain';
import { describe, expect, it, vi } from 'vitest';
import { ContestRulesFields } from './contest-rules-fields';
import { DEFAULT_CONTEST_RULES } from './contest-rules-form';

const TEAM = getSportDefinition(Sport.AMERICAN_FOOTBALL).vocabulary.participant;

describe('contest rules fields for a pick\'em contest', () => {
  it('offers the two modes instead of roster size and scores that count, and reports the mode chosen', () => {
    const onChange = vi.fn();
    render(
      <ContestRulesFields
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
});
