import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldOrderBasis } from '@poolmaster/shared/domain';
import { describe, expect, it, vi } from 'vitest';
import { ProfileSourcesField } from './profile-sources-field';

const TEST_ID = 'sources';

function showSources(value: FieldOrderBasis[]) {
  const onChange = vi.fn<(sources: FieldOrderBasis[]) => void>();
  render(<ProfileSourcesField id="sources" onChange={onChange} testId={TEST_ID} value={value} />);
  return onChange;
}

describe('ProfileSourcesField', () => {
  it('lists the sources in their order, numbered, with the first unable to move up and the last unable to move down', () => {
    showSources([FieldOrderBasis.SEED, FieldOrderBasis.ODDS]);

    const rows = within(screen.getByTestId(TEST_ID)).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['1. Seed', '2. Odds']);
    expect(screen.getByTestId(`${TEST_ID}-SEED-up`)).toBeDisabled();
    expect(screen.getByTestId(`${TEST_ID}-ODDS-down`)).toBeDisabled();
  });

  it('moves a source up or down one place, and removes one, handing back the new list', async () => {
    const onChange = showSources([FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING]);

    await userEvent.click(screen.getByTestId(`${TEST_ID}-SEED-up`));
    await userEvent.click(screen.getByTestId(`${TEST_ID}-SEED-down`));
    await userEvent.click(screen.getByTestId(`${TEST_ID}-ODDS-remove`));

    expect(onChange.mock.calls).toEqual([
      [[FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING]],
      [[FieldOrderBasis.ODDS, FieldOrderBasis.RANKING, FieldOrderBasis.SEED]],
      [[FieldOrderBasis.SEED, FieldOrderBasis.RANKING]],
    ]);
  });

  it('keeps the last source, since a profile orders by at least one', () => {
    showSources([FieldOrderBasis.RANKING]);

    expect(screen.getByTestId(`${TEST_ID}-RANKING-remove`)).toBeDisabled();
  });

  it('offers only the sources not yet listed, and adds the one picked at the end', async () => {
    const onChange = showSources([FieldOrderBasis.SEED]);

    const add = screen.getByTestId(`${TEST_ID}-add`);
    expect(within(add).getAllByRole('option').map((option) => option.textContent)).toEqual(['Add a source…', 'Odds', 'Rank']);
    await userEvent.selectOptions(add, FieldOrderBasis.RANKING);

    expect(onChange).toHaveBeenCalledWith([FieldOrderBasis.SEED, FieldOrderBasis.RANKING]);
  });

  it('adds nothing when the add choice goes back to its prompt', () => {
    const onChange = showSources([FieldOrderBasis.SEED]);

    fireEvent.change(screen.getByTestId(`${TEST_ID}-add`), { target: { value: '' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows no add once every source is listed', () => {
    showSources([FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING]);

    expect(screen.queryByTestId(`${TEST_ID}-add`)).not.toBeInTheDocument();
  });
});
