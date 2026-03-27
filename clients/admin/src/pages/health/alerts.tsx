import { useState } from 'react';
import { Bell, Pencil, VolumeX, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAlertRules, type AlertRule } from '@/hooks/use-health-api';

function severityClass(severity: string): string {
  switch (severity) {
    case 'P1':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'P2':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'P3':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    default:
      return '';
  }
}

export function Component() {
  const { data: alertRules, isLoading } = useAlertRules();
  const [localRules, setLocalRules] = useState<AlertRule[] | null>(null);

  const rules = localRules ?? alertRules ?? [];

  function handleEdit(rule: AlertRule) {
    const newThreshold = window.prompt(`Edit threshold for "${rule.name}"`, rule.threshold);
    if (newThreshold !== null && newThreshold !== rule.threshold) {
      setLocalRules(
        rules.map((r) => (r.id === rule.id ? { ...r, threshold: newThreshold } : r)),
      );
    }
  }

  function handleToggleMute(ruleId: string) {
    setLocalRules(
      rules.map((r) =>
        r.id === ruleId
          ? { ...r, status: r.status === 'Active' ? 'Muted' : 'Active' }
          : r,
      ),
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Alert Configuration</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alert Rules</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5" />
            Configured Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Alert Name</th>
                  <th className="pb-2 pr-4 font-medium">Condition</th>
                  <th className="pb-2 pr-4 font-medium">Threshold</th>
                  <th className="pb-2 pr-4 font-medium">Window</th>
                  <th className="pb-2 pr-4 font-medium">Channels</th>
                  <th className="pb-2 pr-4 font-medium">Severity</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{rule.name}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{rule.condition}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{rule.threshold}</td>
                    <td className="py-2.5 pr-4">{rule.window}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {rule.channels.map((ch) => (
                          <Badge key={ch} variant="secondary" className="text-xs">
                            {ch}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge className={cn('text-xs', severityClass(rule.severity))}>
                        {rule.severity}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge
                        className={cn(
                          'text-xs',
                          rule.status === 'Active'
                            ? 'bg-green-100 text-green-800 border-green-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200',
                        )}
                      >
                        {rule.status}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(rule)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleMute(rule.id)}
                        >
                          {rule.status === 'Active' ? (
                            <VolumeX className="h-3.5 w-3.5" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
