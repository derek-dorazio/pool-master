import { render, screen } from '@testing-library/react';
import { UsageMeter } from './usage-meter';

describe('UsageMeter', () => {
  it('renders label and current/limit text', () => {
    render(<UsageMeter label="Leagues" current={3} limit={10} />);
    expect(screen.getByText('Leagues')).toBeInTheDocument();
    expect(screen.getByText('3 of 10')).toBeInTheDocument();
  });

  it('shows green progress bar when usage is under 75%', () => {
    const { container } = render(<UsageMeter label="Leagues" current={5} limit={10} />);
    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar).toBeInTheDocument();
    const bar = progressBar!.firstElementChild as HTMLElement;
    expect(bar.className).toContain('bg-green-500');
  });

  it('shows amber progress bar when usage is between 75% and 90%', () => {
    const { container } = render(<UsageMeter label="Leagues" current={8} limit={10} />);
    const bar = container.querySelector('[role="progressbar"]')!.firstElementChild as HTMLElement;
    expect(bar.className).toContain('bg-amber-500');
  });

  it('shows red progress bar when usage is over 90%', () => {
    const { container } = render(<UsageMeter label="Leagues" current={95} limit={100} />);
    const bar = container.querySelector('[role="progressbar"]')!.firstElementChild as HTMLElement;
    expect(bar.className).toContain('bg-red-500');
  });

  it('shows "Unlimited" mode when limit is null', () => {
    render(<UsageMeter label="Contests" current={42} limit={null} />);
    expect(screen.getByText('(Unlimited)')).toBeInTheDocument();
    expect(screen.getByText(/42 used/)).toBeInTheDocument();
  });

  it('shows limit reached message at 100%', () => {
    render(<UsageMeter label="Leagues" current={10} limit={10} />);
    expect(screen.getByText(/Limit reached/)).toBeInTheDocument();
  });
});
