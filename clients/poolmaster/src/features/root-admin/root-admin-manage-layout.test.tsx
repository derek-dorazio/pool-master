import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { ManageLandingRedirect, RootAdminManageLayout } from './root-admin-manage-layout';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function EntityHomeProbe() {
  useManageBreadcrumbOverride('evt-1', 'Target Event');
  return <h1>Target Event</h1>;
}

function renderManage(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RootAdminManageLayout />} path="/manage">
          <Route element={<ManageLandingRedirect />} index />
          <Route element={<ManageLandingRedirect />} path="legacy" />
          <Route element={<LocationProbe />} path="customers/leagues" />
          <Route element={<LocationProbe />} path="sports" />
          <Route element={<div>Plans body</div>} path="plans" />
          <Route element={<div>Detail body</div>} path="content-configuration/:templateKey" />
          <Route element={<div>Providers body</div>} path="providers" />
          <Route element={<div>Golf events body</div>} path="sports/golf/events" />
          <Route element={<div>Event field body</div>} path="sports/golf/events/:eventId/field" />
          <Route element={<EntityHomeProbe />} path="sports/golf/events/:eventId" />
        </Route>
      </Routes>
    </MemoryRouter>,
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

  it('under Sports, adds a second row of Sport leagues, Events, Contest templates and one tab per sport, marking the sport being managed', () => {
    renderManage('/manage/sports/golf/events');

    expect(screen.getByTestId('root-admin-manage-menu-sports')).toHaveAttribute('aria-current', 'page');
    const sports = screen.getByRole('navigation', { name: 'Sports' });
    expect(within(sports).getAllByRole('link')).toHaveLength(14);
    expect(screen.getByTestId('root-admin-manage-menu-golf')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-tennis')).not.toHaveAttribute('aria-current');
  });

  it('leaves the title to the page and shows no trail on a page at its tab\'s level, as on a Customers tab', () => {
    renderManage('/manage/customers/leagues');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
  });

  it('shows a sport list no trail, since the tabs already name the sport and its list', () => {
    renderManage('/manage/sports/golf/events');

    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
    expect(screen.getByText('Golf events body')).toBeInTheDocument();
  });

  it('shows a page under a sport the trail from the sport\'s list, leaving the sport to its tab', () => {
    renderManage('/manage/sports/golf/events/evt-1/field');

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).queryByText('Golf')).not.toBeInTheDocument();
    expect(within(breadcrumbNav).getByRole('link', { name: 'Tournaments' })).toHaveAttribute('href', '/manage/sports/golf/events');
    expect(within(breadcrumbNav).getByText('Field')).toHaveAttribute('aria-current', 'page');
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
    expect(screen.getByTestId('root-admin-manage-menu-contest-templates')).toHaveAttribute('aria-current', 'page');
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
    renderManage('/manage/sports/golf/events/evt-1');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Tournaments' })).toHaveAttribute('href', '/manage/sports/golf/events');
    expect(within(breadcrumbNav).getByText('Target Event')).toHaveAttribute('aria-current', 'page');
  });
});
