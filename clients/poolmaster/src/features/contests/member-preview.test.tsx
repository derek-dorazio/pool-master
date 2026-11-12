import { SelectionType } from '@poolmaster/shared/domain';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormatIllustration } from '@/features/contest-types/illustrations';
import { MemberPreview } from './member-preview';

/** The drawing How to Play shows for a format, to compare the preview's picture against. */
function formatPicture(selectionType: SelectionType) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<FormatIllustration selectionType={selectionType} />);
  return host.firstElementChild?.innerHTML;
}

describe('MemberPreview', () => {
  it('shows the contest as members will read it: its name, its event on a line of its own so a long name never hides it, then the rules sentence', () => {
    render(<MemberPreview eventName="The Masters" name="Masters Pool" rules="Pick 6 golfers from 6 tiers." selectionType={SelectionType.TIERED} />);

    expect(screen.getByText('Members will see')).toBeInTheDocument();
    expect(screen.getByTestId('contest-members-will-see-name')).toHaveTextContent('Masters Pool');
    expect(screen.getByTestId('contest-members-will-see-event')).toHaveTextContent('The Masters');
    expect(screen.getByTestId('contest-members-will-see-rules')).toHaveTextContent('Pick 6 golfers from 6 tiers.');
  });

  it('calls a contest with no name yet "Untitled contest" rather than showing a blank', () => {
    render(<MemberPreview eventName="The Masters" name="   " rules="Pick 6 golfers." selectionType={SelectionType.TIERED} />);

    expect(screen.getByTestId('contest-members-will-see-name')).toHaveTextContent('Untitled contest');
  });

  it('leads the row with the contest type\'s picture, the same drawing How to Play shows, and redraws it when the format changes', () => {
    const { rerender } = render(<MemberPreview eventName="The Masters" name="Masters Pool" rules="Pick 6 golfers." selectionType={SelectionType.TIERED} />);

    const picture = screen.getByTestId('contest-members-will-see-picture');
    expect(picture).toHaveAttribute('aria-hidden', 'true');
    expect(picture.innerHTML).toBe(formatPicture(SelectionType.TIERED));

    rerender(<MemberPreview eventName="Week 1" name="Week 1 Pick'em" rules="Pick the winner of every game." selectionType={SelectionType.PICK_EM} />);
    expect(screen.getByTestId('contest-members-will-see-picture').innerHTML).toBe(formatPicture(SelectionType.PICK_EM));
    expect(formatPicture(SelectionType.PICK_EM)).not.toBe(formatPicture(SelectionType.TIERED));
  });

  it('leaves out the event line when the name already says the event, as the default name does, so the event never reads twice', () => {
    render(<MemberPreview eventName="The Masters" name="The Masters Pick 6" rules="Pick 6 golfers." selectionType={SelectionType.TIERED} />);

    expect(screen.getByTestId('contest-members-will-see-name')).toHaveTextContent('The Masters Pick 6');
    expect(screen.queryByTestId('contest-members-will-see-event')).not.toBeInTheDocument();
  });
});
