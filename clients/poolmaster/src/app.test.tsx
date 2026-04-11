import { render, screen } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('renders the PoolMaster auth entry point', () => {
    render(<App />);

    expect(
      screen.getByText(/ultimate office pool manager starts with one simple choice/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
