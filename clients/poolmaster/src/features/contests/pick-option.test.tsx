import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PickedLine, PickOption } from './pick-option';

function drawOption(props: Partial<Parameters<typeof PickOption>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <PickOption isBusy={false} isPicked={false} onPick={onPick} testId="option" {...props}>
      <span>Kansas City</span>
    </PickOption>,
  );
  return { button: screen.getByTestId('option'), onPick };
}

describe('PickOption', () => {
  it('picks its team on a tap while it is not the pick, unpressed and unmarked', () => {
    const { button, onPick } = drawOption();

    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByLabelText('Your pick')).not.toBeInTheDocument();
    fireEvent.click(button);

    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('shows the pick pressed with a check mark named "Your pick", and a second tap picks nothing', () => {
    const { button, onPick } = drawOption({ isPicked: true });

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Your pick')).toBeInTheDocument();
    fireEvent.click(button);

    expect(onPick).not.toHaveBeenCalled();
  });

  it('says Used and cannot be picked when a survivor entry used the team in another week', () => {
    const { button } = drawOption({ isUsed: true });

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Used');
  });

  it('keeps the used team marked as the pick, not Used, in the week it was picked', () => {
    const { button } = drawOption({ isPicked: true, isUsed: true });

    expect(button).not.toHaveTextContent('Used');
    expect(screen.getByLabelText('Your pick')).toBeInTheDocument();
  });

  it('cannot be tapped while another pick is saving', () => {
    const { button } = drawOption({ isBusy: true });

    expect(button).toBeDisabled();
  });
});

describe('PickedLine', () => {
  it('marks the entry\'s locked pick "Picked" and leaves the other side plain, neither a button', () => {
    render(
      <>
        <PickedLine isPicked testId="picked"><span>Kansas City</span></PickedLine>
        <PickedLine isPicked={false} testId="other"><span>Buffalo</span></PickedLine>
      </>,
    );

    expect(screen.getByTestId('picked')).toHaveAttribute('data-picked', 'true');
    expect(screen.getByLabelText('Picked')).toBeInTheDocument();
    expect(screen.getByTestId('other')).not.toHaveAttribute('data-picked');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
