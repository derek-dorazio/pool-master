import { render, screen } from '@testing-library/react';
import { ProfileForm } from './profile-form';

const mockProfile = {
  id: 'user-1',
  displayName: 'Dave O',
  email: 'dave@example.com',
  bio: 'Fantasy sports enthusiast',
  avatarUrl: null,
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

vi.mock('./avatar-upload', () => ({
  AvatarUpload: () => <div data-testid="avatar-upload" />,
}));

describe('ProfileForm', () => {
  it('renders form fields (displayName, email, bio)', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toBeInTheDocument();
  });

  it('populates fields with profile data', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display Name')).toHaveValue('Dave O');
    expect(screen.getByLabelText('Email')).toHaveValue('dave@example.com');
    expect(screen.getByLabelText('Bio')).toHaveValue('Fantasy sports enthusiast');
  });

  it('save button is disabled when form is clean (no changes)', () => {
    render(<ProfileForm />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('shows character count for bio', () => {
    render(<ProfileForm />);

    // "Fantasy sports enthusiast" is 25 characters
    expect(screen.getByText(`${mockProfile.bio.length}/200 characters`)).toBeInTheDocument();
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
