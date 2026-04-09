import { render, screen } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('renders the PoolMaster scaffold home page', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: /the new role-based poolmaster web app starts here/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders the route-map navigation shell', () => {
    render(<App />);

    expect(screen.getByRole('link', { name: /leagues/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /commissioner/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /root admin/i })).toBeInTheDocument();
  });
});
