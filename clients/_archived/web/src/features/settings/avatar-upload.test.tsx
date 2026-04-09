import { render, screen } from '@testing-library/react';
import { AvatarUpload } from './avatar-upload';

vi.mock('./hooks/use-profile', () => ({
  useUploadAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

describe('AvatarUpload', () => {
  it('renders initials when no avatarUrl is provided', () => {
    render(<AvatarUpload avatarUrl={null} displayName="John Doe" />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('renders single initial for single-word name', () => {
    render(<AvatarUpload avatarUrl={null} displayName="Madonna" />);
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('renders image when avatarUrl is provided', () => {
    render(<AvatarUpload avatarUrl="https://example.com/photo.jpg" displayName="John Doe" />);
    const img = screen.getByAltText('John Doe');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg');
  });

  it('has Upload Photo button', () => {
    render(<AvatarUpload avatarUrl={null} displayName="John Doe" />);
    expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeInTheDocument();
  });

  it('shows Remove Photo button when avatarUrl is provided', () => {
    render(<AvatarUpload avatarUrl="https://example.com/photo.jpg" displayName="John Doe" />);
    expect(screen.getByRole('button', { name: 'Remove Photo' })).toBeInTheDocument();
  });

  it('does not show Remove Photo button when no avatarUrl', () => {
    render(<AvatarUpload avatarUrl={null} displayName="John Doe" />);
    expect(screen.queryByRole('button', { name: 'Remove Photo' })).not.toBeInTheDocument();
  });
});
