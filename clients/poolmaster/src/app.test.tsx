import { render, screen } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('renders the Primetime Commissioner auth entry point', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Make every game day count.' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
