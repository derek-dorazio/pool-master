import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flag, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client, adminUpdateFlag } from '@/lib/api';
import { useFlagList } from '@/hooks/use-flags-api';
import type { FlagType } from '@/hooks/use-flags-api';

function typeBadge(type: FlagType) {
  switch (type) {
    case 'Boolean':
      return <Badge variant="outline" className="text-xs">Boolean</Badge>;
    case 'Percentage':
      return <Badge className="bg-purple-100 text-purple-800 text-xs">Percentage</Badge>;
    case 'Tenant List':
      return <Badge className="bg-blue-100 text-blue-800 text-xs">Tenant List</Badge>;
  }
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-green-500' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function Component() {
  const navigate = useNavigate();
  const { data: flags = [] } = useFlagList();
  const [toggleState, setToggleState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    flags.forEach((f) => { initial[f.key] = f.enabled; });
    return initial;
  });

  async function handleToggle(key: string, value: boolean) {
    setToggleState((prev) => ({ ...prev, [key]: value }));
    await adminUpdateFlag({ client, path: { flagKey: key }, body: { enabledGlobally: value } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Flag className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Feature Flags</h1>
        </div>
        <Button disabled title="Create flag flow is not wired yet">
          <Plus className="mr-2 h-4 w-4" />
          Create Flag
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Flag Key</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-center font-medium">Global Status</th>
                  <th className="px-4 py-3 text-right font-medium">Rollout %</th>
                  <th className="px-4 py-3 text-right font-medium">Overrides</th>
                  <th className="px-4 py-3 text-left font-medium">Owner</th>
                  <th className="px-4 py-3 text-left font-medium">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr
                    key={f.key}
                    className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => navigate(`/flags/${f.key}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{f.key}</td>
                    <td className="px-4 py-3 font-medium">{f.name}</td>
                    <td className="px-4 py-3">{typeBadge(f.type)}</td>
                    <td className="px-4 py-3 text-center">
                      <Toggle
                        checked={toggleState[f.key] ?? f.enabled}
                        onChange={(v) => handleToggle(f.key, v)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {f.type === 'Percentage' ? `${f.rolloutPct}%` : '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-right">{f.overridesCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">{f.owner}</td>
                    <td className="px-4 py-3 text-muted-foreground">{f.lastUpdated}</td>
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
