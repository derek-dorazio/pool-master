import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client, requestDataExport } from '@/lib/api';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';
import { DataExportStatusResponseSchema } from '@poolmaster/shared/dto/compliance.dto';

export interface DataExportStatus {
  status: 'none' | 'pending' | 'ready';
  requestedAt: string | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  nextAllowedAt: string | null;
}

export function useDataExportStatus() {
  return useQuery({
    queryKey: settingsKeys.dataExport(),
    queryFn: async (): Promise<DataExportStatus> => {
      const { data, error } = await client.get<unknown>({
        url: '/api/v1/account/data-export',
      });
      if (error) throw error;
      return DataExportStatusResponseSchema.parse(data) as DataExportStatus;
    },
  });
}

export function useRequestDataExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await requestDataExport({ client });
      if (error) throw error;
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
