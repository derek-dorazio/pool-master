import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { ManageLandingRedirect, RootAdminManageLayout } from './root-admin-manage-layout';
import { sportsQueryClient } from './sport-test-fixtures';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function EntityHomeProbe() {
  useManageBreadcrumbOverride('golf-tiered-pick-6', 'Tiered Pick 6');
  return <h1>Tiered Pick 6</h1>;
}

function NamedLater({ label }: { label: string | undefined }) {
  useManageBreadcrumbOverride('golf-tiered-pick-6', label);
  return null;
}

/** A page that names its entity once it has loaded, and can be left. */
function LoadingEntityProbe() {
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [shown, setShown] = useState(true);
  return (
    <>
      {shown ? <NamedLater label={label} /> : null}
      <button onClick={() => setLabel('Tiered Pick 6')} type="button">Load</button>
      <button onClick={() => setShown(false)} type="button">Leave</button>
    </>
  );
}

function renderManage(path: string) {
  render(
    <QueryClientProvider client={sportsQueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RootAdminManageLayout />} path="/manage">
          <Route element={<ManageLandingRedirect />} index />
          <Route element={<ManageLandingRedirect />} path="legacy" />
          <Route element={<LocationProbe />} path="customers/leagues" />
          <Route element={<LocationProbe />} path="sports" />
          <Route element={<div>Plans body</div>} path="plans" />
          <Route element={<div>Detail body</div>} path="content-configuration/:templateKey" />
          <Route element={<EntityHomeProbe />} path="content-configuration/:templateKey/home" />
          <Route element={<LoadingEntityProbe />} path="content-configuration/:templateKey/loading" />
          <Route element={<div>Providers body</div>} path="providers" />
          <Route element={<div>League page body</div>} path="sports/golf/leagues/:leagueId/participants" />
          <Route element={<div>Event field body</div>} path="sports/golf/events/:eventId/field" />
          <Route element={<div>New participant body</div>} path="sports/golf/participants/new" />
        </Route>
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminManageLayout', () => {
  it('opens the Sports page when a root admin goes to /manage itself', () => {
    renderManage('/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports');
  });

  it('sends an old Manage link to the Sports page', () => {
    renderManage('/manage/legacy');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports');
  });

  it('shows Manage on the tools frame: a band with the way out, then the menu Sports to Pricing as top tabs, marking the open one', () => {
    renderManage('/manage/plans');

    const band = screen.getByTestId('root-admin-manage-layout-band');
    expect(within(band).getByText('Root admin')).toBeInTheDocument();
    expect(within(band).getByText('Manage')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Manage' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Sports',
      'Activity',
      'Notifications',
      'Providers',
      'Customers',
      'Plans',
      'Pricing',
    ]);
    expect(screen.getByTestId('root-admin-manage-menu-plans')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-sports')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('root-admin-manage-exit')).toHaveAttribute('href', '/');
    expect(screen.queryByRole('navigation', { name: 'Sports' })).not.toBeInTheDocument();
  });

  it('under Sports, lights Sports and adds no second row', () => {
    renderManage('/manage/sports/golf/events/evt-1/field');

    expect(screen.getByTestId('root-admin-manage-menu-sports')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'Sports' })).not.toBeInTheDocument();
  });

  it('leaves the title to the page and shows no trail on a page at its tab\'s level, as on a Customers tab', () => {
    renderManage('/manage/customers/leagues');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
  });

  it('shows a page under a sport the trail from the sport, skipping the sport\'s old list page', () => {
    renderManage('/manage/sports/golf/participants/new');

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Golf' })).toHaveAttribute('href', '/manage/sports/golf');
    expect(within(breadcrumbNav).queryByText('Golfers')).not.toBeInTheDocument();
    expect(screen.getByText('New participant body')).toBeInTheDocument();
  });

  it('leaves a League page\'s trail to its own header', () => {
    renderManage('/manage/sports/golf/leagues/league-1/participants');

    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
    expect(screen.getByText('League page body')).toBeInTheDocument();
  });

  it('leaves an Event page\'s trail to its own header', () => {
    renderManage('/manage/sports/golf/events/evt-1/field');

    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
    expect(screen.getByText('Event field body')).toBeInTheDocument();
  });

  it('shows a deep page the trail back up to its tab, starting at the tab', () => {
    renderManage('/manage/content-configuration/golf-tiered-pick-6');

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).queryByText('Manage')).not.toBeInTheDocument();
    expect(within(breadcrumbNav).getByRole('link', { name: 'Contest templates' })).toHaveAttribute(
      'href',
      '/manage/content-configuration',
    );
    expect(within(breadcrumbNav).getByText('golf-tiered-pick-6')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-sports')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Detail body')).toBeInTheDocument();
  });

  it('lights Providers on the Providers page, whose menu item leads there, with no trail of its own', () => {
    renderManage('/manage/providers');

    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-menu-providers')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-providers')).toHaveAttribute('href', '/manage/providers');
    expect(screen.getByText('Providers body')).toBeInTheDocument();
  });

  it('names an entity in the trail by the name its page gives', () => {
    renderManage('/manage/content-configuration/golf-tiered-pick-6/home');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Tiered Pick 6' })).toHaveAttribute('href', '/manage/content-configuration/golf-tiered-pick-6');
  });

  it('shows an entity\'s id in the trail until its page names it, and the id again once the page has gone', async () => {
    renderManage('/manage/content-configuration/golf-tiered-pick-6/loading');
    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'golf-tiered-pick-6' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(within(breadcrumbNav).getByRole('link', { name: 'Tiered Pick 6' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(within(breadcrumbNav).getByRole('link', { name: 'golf-tiered-pick-6' })).toBeInTheDocument();
  });
});
