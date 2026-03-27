import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  bio: string;
  avatarUrl: string | null;
  authProvider: 'email' | 'google' | 'apple';
}

const mockProfile: UserProfile = {
  id: 'user-1',
  displayName: 'Dave O',
  email: 'dave@example.com',
  bio: 'Fantasy sports enthusiast',
  avatarUrl: null,
  authProvider: 'email',
};

export function useProfile() {
  return useQuery({
    queryKey: settingsKeys.profile(),
    queryFn: async (): Promise<UserProfile> => {
      // TODO: return api.get<UserProfile>('/users/me');
      await new Promise((resolve) => setTimeout(resolve, 200));
      return mockProfile;
    },
    staleTime: Infinity,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<Pick<UserProfile, 'displayName' | 'email' | 'bio'>>) => {
      // TODO: return api.patch('/users/me', data);
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Profile updated' });
    },
    onError: () => {
      toast({ title: 'Failed to update profile', description: 'Please try again.' });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_file: File) => {
      // TODO: const formData = new FormData(); formData.append('avatar', file);
      // return api.post('/users/me/avatar', formData);
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Avatar updated' });
    },
    onError: () => {
      toast({ title: 'Failed to upload avatar', description: 'Please try a smaller image.' });
    },
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // TODO: return api.delete('/users/me/avatar');
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
      toast({ title: 'Avatar removed' });
    },
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async (_data: { currentPassword: string; newPassword: string }) => {
      // TODO: return api.put('/users/me/password', data);
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to change password', description: 'Current password may be incorrect.' });
    },
  });
}
