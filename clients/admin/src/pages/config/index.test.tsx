import { render, screen } from '@testing-library/react';
import { Component as ConfigPage } from './index';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ConfigPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the supported configuration entry points', () => {
    render(<ConfigPage />);

    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Retention defaults')).toBeInTheDocument();
  });

  it('navigates to platform configuration from the platform card', async () => {
    render(<ConfigPage />);

    screen.getByText('Platform').click();

    expect(mockNavigate).toHaveBeenCalledWith('/config/platform');
  });
});
