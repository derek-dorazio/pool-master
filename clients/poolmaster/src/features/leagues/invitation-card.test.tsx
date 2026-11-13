import { render, screen, within } from '@testing-library/react';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { InvitationCard } from './invitation-card';

describe('InvitationCard', () => {
  it('shows a league invitation as rows: the league, joining as a member with your own team, and the code', () => {
    render(<InvitationCard inviteCode="abc123" leagueName="Big Dawgs" />);

    const card = screen.getByRole('region', { name: 'Invitation' });
    expect(card).toHaveAttribute('data-testid', 'invitation-context-card');
    expect(within(card).getByTestId('invitation-card-league')).toHaveTextContent('LeagueBig Dawgs');
    expect(within(card).getByTestId('invitation-card-role')).toHaveTextContent('You join asA member, with your own team');
    expect(within(card).getByTestId('invitation-card-code')).toHaveTextContent('Invite codeABC123');
    expect(within(card).queryByTestId('invitation-card-team')).not.toBeInTheDocument();
  });

  it('adds the team and joins as a co-owner for a co-owner invitation', () => {
    render(<InvitationCard leagueName="Big Dawgs" team={{ name: 'Sharks', iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD }} />);

    expect(screen.getByTestId('invitation-card-team')).toHaveTextContent('TeamSharks');
    expect(screen.getByTestId('invitation-card-role')).toHaveTextContent('A co-owner');
  });

  it('leaves out the code row when no code is given, and says nothing in sentences', () => {
    render(<InvitationCard leagueName="Big Dawgs" title="League invite" />);

    const card = screen.getByRole('region', { name: 'League invite' });
    expect(within(card).queryByTestId('invitation-card-code')).not.toBeInTheDocument();
    expect(within(card).queryByRole('paragraph')).not.toBeInTheDocument();
  });
});
