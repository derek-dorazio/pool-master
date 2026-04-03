import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Megaphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  client,
  adminActivateAnnouncement,
  adminDeactivateAnnouncement,
} from '@/lib/api';
import { useAnnouncements, type Announcement } from '@/hooks/use-announcements-api';

function typeClass(type: string): string {
  switch (type) {
    case 'Banner':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'Notification':
      return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    case 'Both':
      return 'bg-violet-100 text-violet-800 border-violet-200';
    default:
      return '';
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'Info':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'Warning':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'Critical':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return '';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'Active':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'Scheduled':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'Expired':
      return 'bg-gray-100 text-gray-600 border-gray-200';
    default:
      return '';
  }
}

export function Component() {
  const queryClient = useQueryClient();
  const { data: announcements, isLoading } = useAnnouncements();

  const items = announcements ?? [];

  async function toggleStatus(announcement: Announcement) {
    if (announcement.status === 'Active') {
      await adminDeactivateAnnouncement({ client, path: { id: announcement.id } });
    } else {
      await adminActivateAnnouncement({ client, path: { id: announcement.id } });
    }

    await queryClient.invalidateQueries({ queryKey: ['announcements'] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Global Announcements</h1>
        <Button asChild>
          <Link to="/announcements/create">
            <Plus className="mr-2 h-4 w-4" />
            Create Announcement
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="h-5 w-5" />
            Announcements
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">No announcements.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Title</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Severity</th>
                    <th className="pb-2 pr-4 font-medium">Target</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Starts</th>
                    <th className="pb-2 pr-4 font-medium">Ends</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((ann) => (
                    <tr key={ann.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{ann.title}</td>
                      <td className="py-2.5 pr-4">
                        <Badge className={cn('text-xs', typeClass(ann.type))}>{ann.type}</Badge>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge className={cn('text-xs', severityClass(ann.severity))}>{ann.severity}</Badge>
                      </td>
                      <td className="py-2.5 pr-4">{ann.target}</td>
                      <td className="py-2.5 pr-4">
                        <Badge className={cn('text-xs', statusClass(ann.status))}>{ann.status}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-xs">
                        {new Date(ann.startsAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 pr-4 text-xs">
                        {ann.endsAt ? new Date(ann.endsAt).toLocaleDateString() : '--'}
                      </td>
                      <td className="py-2.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleStatus(ann)}
                        >
                          {ann.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
