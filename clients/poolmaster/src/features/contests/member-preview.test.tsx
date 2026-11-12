import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemberPreview } from './member-preview';

describe('MemberPreview', () => {
  it('shows the contest as members will read it: name and event, then the rules sentence', () => {
    render(<MemberPreview eventName="The Masters" name="Masters Pool" rules="Pick 6 golfers from 6 tiers." />);

    expect(screen.getByText('Members will see')).toBeInTheDocument();
    expect(screen.getByTestId('contest-members-will-see-name')).toHaveTextContent('Masters Pool · The Masters');
    expect(screen.getByTestId('contest-members-will-see-rules')).toHaveTextContent('Pick 6 golfers from 6 tiers.');
  });

  it('calls a contest with no name yet "Untitled contest" rather than showing a blank', () => {
    render(<MemberPreview eventName="The Masters" name="   " rules="Pick 6 golfers." />);

    expect(screen.getByTestId('contest-members-will-see-name')).toHaveTextContent('Untitled contest · The Masters');
  });
});
