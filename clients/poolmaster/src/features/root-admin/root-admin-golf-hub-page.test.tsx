import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminGolfHubPage } from './root-admin-golf-hub-page';

// plans/124 §6.3 — /manage/golf hub cards (pool-master-3dg).
describe('RootAdminGolfHubPage', () => {
  it('pool-master-3dg links each golf surface, including stubbed Tours/Seasons/Players', () => {
    render(
      <MemoryRouter>
        <RootAdminGolfHubPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('root-admin-golf-hub-page')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-hub-link-tournaments')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments',
    );
    expect(screen.getByTestId('root-admin-golf-hub-link-tours')).toHaveAttribute(
      'href',
      '/manage/golf/leagues',
    );
    expect(screen.getByTestId('root-admin-golf-hub-link-seasons')).toHaveAttribute(
      'href',
      '/manage/golf/seasons',
    );
    expect(screen.getByTestId('root-admin-golf-hub-link-players')).toHaveAttribute(
      'href',
      '/manage/golf/players',
    );
    expect(screen.getByTestId('root-admin-golf-hub-link-sync')).toHaveAttribute(
      'href',
      '/manage/sync?sport=GOLF',
    );
  });
});
