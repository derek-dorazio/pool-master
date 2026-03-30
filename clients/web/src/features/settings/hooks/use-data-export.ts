import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface DataExportStatus {
  status: 'none' | 'pending' | 'ready';
  requestedAt: string | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  nextAllowedAt: string | null;
}

const mockExportStatus: DataExportStatus = {
  status: 'none',
  requestedAt: null,
  downloadUrl: null,
  expiresAt: null,
  nextAllowedAt: null,
};

export function useDataExportStatus() {
  return useQuery({
    queryKey: settingsKeys.dataExport(),
    queryFn: async (): Promise<DataExportStatus> => {
      try {
        return await api.get<DataExportStatus>('/v1/account/export/status');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockExportStatus;
      }
    },
  });
}

export function useRequestDataExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return await api.post('/v1/account/data-export');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.dataExport() });
      toast({ title: 'Data export requested', description: 'We\'ll email you a download link within 48 hours.' });
    },
    onError: () => {
      toast({ title: 'Failed to request data export', description: 'Please try again.' });
    },
  });
}
