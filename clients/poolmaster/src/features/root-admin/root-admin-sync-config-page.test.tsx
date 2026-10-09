import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminSyncConfigPage } from './root-admin-sync-config-page';

describe('RootAdminSyncConfigPage', () => {
  it('links to the ingestion schedule and sport override pages', () => {
    render(
      <MemoryRouter>
        <RootAdminSyncConfigPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('root-admin-sync-config-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-sync-config-link-ingestion-schedule'),
    ).toHaveAttribute('href', '/manage/sync-config/ingestion-schedule');
    expect(
      screen.getByTestId('root-admin-sync-config-link-sport-overrides'),
    ).toHaveAttribute('href', '/manage/sync-config/sport-overrides');
  });
});
