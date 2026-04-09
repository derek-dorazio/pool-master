import { render, screen } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('renders the PoolMaster auth entry point', () => {
    render(<App />);

    expect(
      screen.getByText(/one web app for members, commissioners, and future root admins/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
