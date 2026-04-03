import { render, screen } from '@testing-library/react';
import { ProfileForm } from './profile-form';

const mockProfile = {
  id: 'user-1',
  displayName: 'Dave O',
  email: 'dave@example.com',
  authProvider: 'email' as const,
};

vi.mock('./hooks/use-profile', () => ({
  useProfile: vi.fn(() => ({
    data: mockProfile,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useUpdateProfile: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

describe('ProfileForm', () => {
  it('renders form fields (displayName, email)', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('populates fields with profile data', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display Name')).toHaveValue('Dave O');
    expect(screen.getByLabelText('Email')).toHaveValue('dave@example.com');
  });

  it('save button is disabled when form is clean (no changes)', () => {
    render(<ProfileForm />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('does not render the unsupported bio field', () => {
    render(<ProfileForm />);
    expect(screen.queryByLabelText('Bio')).not.toBeInTheDocument();
  });

  it('renders loading state when isLoading', async () => {
    const { useProfile } = await import('./hooks/use-profile');
    vi.mocked(useProfile).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as any);

    render(<ProfileForm />);

    // Loading state shows Profile card title but skeleton content
    expect(screen.getByText('Profile')).toBeInTheDocument();
    // Form fields should not be present during loading
    expect(screen.queryByLabelText('Display Name')).not.toBeInTheDocument();
  });
});
