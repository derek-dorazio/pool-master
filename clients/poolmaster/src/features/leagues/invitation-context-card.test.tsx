import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InvitationContextCard } from './invitation-context-card';

describe('InvitationContextCard', () => {
  it('shows the invitation as a titled section with the league initials, name, invite code and message', () => {
    render(
      <InvitationContextCard
        inviteCode="ABC123"
        leagueName="Big Dawgs"
        message="Name your team and select Join League when you're ready."
        title="Ready to join"
      />,
    );

    const card = screen.getByRole('region', { name: 'Ready to join' });
    expect(card).toHaveAttribute('data-testid', 'invitation-context-card');
    expect(card).toHaveClass('rounded-lg');
    expect(within(card).getByText('BD')).toBeInTheDocument();
    expect(within(card).getByText('Big Dawgs')).toBeInTheDocument();
    expect(within(card).getByText('Invite code ABC123')).toBeInTheDocument();
    expect(within(card).getByText(/Name your team/)).toBeInTheDocument();
  });

  it('titles itself League invitation and leaves out the code line when no code is given', () => {
    render(<InvitationContextCard leagueName="Big Dawgs" message="Join us." />);

    expect(screen.getByRole('region', { name: 'League invitation' })).toBeInTheDocument();
    expect(screen.queryByText(/Invite code/)).not.toBeInTheDocument();
  });

  it('draws no line under the league when given no message, as on the sign-in page', () => {
    render(<InvitationContextCard inviteCode="ABC123" leagueName="Big Dawgs" title="League invite" />);

    const card = screen.getByRole('region', { name: 'League invite' });
    expect(within(card).getByText('Big Dawgs')).toBeInTheDocument();
    expect(within(card).queryByRole('paragraph')).not.toBeInTheDocument();
  });
});
