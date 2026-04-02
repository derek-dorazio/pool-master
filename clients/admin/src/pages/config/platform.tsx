import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Server, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  client,
  adminUpdatePollIntervals,
  adminUpdateIngestionSchedule,
  adminUpdateDunningConfig,
  adminUpdateRetentionDefaults,
  adminGetTenantRetentionOverride,
  adminClearTenantRetentionOverride,
  adminSetTenantRetentionOverride,
} from '@/lib/api';
import { Sport } from '@poolmaster/shared/domain';
import {
  usePollIntervals,
  useIngestionSchedule,
  useDunningConfig,
  useRetentionDefaults,
} from '@/hooks/use-config-api';
import type {
  PollIntervalConfig,
  SportOverride,
  RetryAttempt,
  RetentionDefaultsConfig,
} from '@/hooks/use-config-api';

// ── Shared Toggle ──────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
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
      {label}
    </label>
  );
}

function formatInterval(ms: number): string {
  if (ms >= 60000) return `${ms / 60000} min`;
  return `${ms / 1000}s`;
}

// ── Poll Intervals Section ─────────────────────────────────────────────────────

const POLL_FIELDS: { key: keyof PollIntervalConfig; label: string }[] = [
  { key: 'standings', label: 'Standings' },
  { key: 'draft', label: 'Draft' },
  { key: 'contestStatus', label: 'Contest Status' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'default', label: 'Default' },
];

function PollIntervalsSection() {
  const { data: config } = usePollIntervals();
  const [values, setValues] = useState<PollIntervalConfig>({ ...config });

  function update(key: keyof PollIntervalConfig, value: number) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setValues({ ...config });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Poll Intervals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {POLL_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium">{field.label} (ms)</label>
              <Input
                type="number"
                step={1000}
                value={values[field.key]}
                onChange={(e) => update(field.key, Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Refresh every {formatInterval(values[field.key])}
              </p>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>Reset</Button>
          <Button onClick={async () => {
            await adminUpdatePollIntervals({ client, body: values });
          }}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Ingestion Schedule Section ─────────────────────────────────────────────────

const AVAILABLE_SPORTS = [Sport.NFL, Sport.NBA, Sport.NCAA_BASKETBALL, Sport.SOCCER, Sport.GOLF, Sport.NASCAR, Sport.TENNIS, Sport.F1, Sport.HORSE_RACING];

function IngestionScheduleSection() {
  const { data: config } = useIngestionSchedule();
  const [healthCheckMin, setHealthCheckMin] = useState(config.healthCheckMin);
  const [scheduleSyncHrs, setScheduleSyncHrs] = useState(config.scheduleSyncHrs);
  const [participantSyncHrs, setParticipantSyncHrs] = useState(config.participantSyncHrs);
  const [rankingSyncHrs, setRankingSyncHrs] = useState(config.rankingSyncHrs);
  const [liveScorePolling, setLiveScorePolling] = useState(config.liveScorePollingSeconds);
  const [overrides, setOverrides] = useState<SportOverride[]>(config.sportOverrides);
  const [showOverrides, setShowOverrides] = useState(false);

  function updateOverride(index: number, field: keyof SportOverride, value: string | number) {
    setOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    );
  }

  function addOverride() {
    const usedSports = overrides.map((o) => o.sport);
    const available = AVAILABLE_SPORTS.filter((s) => !usedSports.includes(s));
    if (available.length === 0) return;
    setOverrides((prev) => [
      ...prev,
      {
        sport: available[0],
        healthCheckMin,
        scheduleSyncHrs,
        participantSyncHrs,
        rankingSyncHrs,
        liveScorePollingSeconds: liveScorePolling,
      },
    ]);
  }

  function removeOverride(index: number) {
    setOverrides((prev) => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setHealthCheckMin(config.healthCheckMin);
    setScheduleSyncHrs(config.scheduleSyncHrs);
    setParticipantSyncHrs(config.participantSyncHrs);
    setRankingSyncHrs(config.rankingSyncHrs);
    setLiveScorePolling(config.liveScorePollingSeconds);
    setOverrides(config.sportOverrides);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ingestion Schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm font-medium">Health check (min)</label>
            <Input
              type="number"
              value={healthCheckMin}
              onChange={(e) => setHealthCheckMin(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Schedule sync (hrs)</label>
            <Input
              type="number"
              value={scheduleSyncHrs}
              onChange={(e) => setScheduleSyncHrs(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Participant sync (hrs)</label>
            <Input
              type="number"
              value={participantSyncHrs}
              onChange={(e) => setParticipantSyncHrs(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Ranking sync (hrs)</label>
            <Input
              type="number"
              value={rankingSyncHrs}
              onChange={(e) => setRankingSyncHrs(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Live score polling (s)</label>
            <Input
              type="number"
              value={liveScorePolling}
              onChange={(e) => setLiveScorePolling(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Per-sport overrides */}
        <div>
          <button
            className="flex items-center gap-2 text-sm font-semibold"
            onClick={() => setShowOverrides(!showOverrides)}
          >
            {showOverrides
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronRight className="h-4 w-4" />}
            Per-Sport Overrides ({overrides.length})
          </button>

          {showOverrides && (
            <div className="mt-3 space-y-3">
              {overrides.map((override, idx) => (
                <div key={override.sport} className="flex items-end gap-3 rounded-md border p-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Sport</label>
                    <select
                      className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={override.sport}
                      onChange={(e) => updateOverride(idx, 'sport', e.target.value)}
                    >
                      {AVAILABLE_SPORTS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Health (min)</label>
                    <Input
                      type="number"
                      className="h-10 w-24"
                      value={override.healthCheckMin}
                      onChange={(e) => updateOverride(idx, 'healthCheckMin', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Schedule (hrs)</label>
                    <Input
                      type="number"
                      className="h-10 w-24"
                      value={override.scheduleSyncHrs}
                      onChange={(e) => updateOverride(idx, 'scheduleSyncHrs', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Participants (hrs)</label>
                    <Input
                      type="number"
                      className="h-10 w-24"
                      value={override.participantSyncHrs}
                      onChange={(e) => updateOverride(idx, 'participantSyncHrs', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Ranking (hrs)</label>
                    <Input
                      type="number"
                      className="h-10 w-24"
                      value={override.rankingSyncHrs}
                      onChange={(e) => updateOverride(idx, 'rankingSyncHrs', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Live score (s)</label>
                    <Input
                      type="number"
                      className="h-10 w-24"
                      value={override.liveScorePollingSeconds}
                      onChange={(e) => updateOverride(idx, 'liveScorePollingSeconds', Number(e.target.value))}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => removeOverride(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addOverride}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Sport Override
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>Reset</Button>
          <Button onClick={async () => {
            await adminUpdateIngestionSchedule({ client, body: { healthCheckIntervalMinutes: healthCheckMin, scheduleSyncIntervalHours: scheduleSyncHrs, participantSyncIntervalHours: participantSyncHrs, rankingSyncIntervalHours: rankingSyncHrs, liveScorePollingIntervalSeconds: liveScorePolling } });
          }}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Dunning Schedule Section ───────────────────────────────────────────────────

function DunningScheduleSection() {
  const { data: config } = useDunningConfig();
  const [retryAttempts, setRetryAttempts] = useState<RetryAttempt[]>(config.retryAttempts);
  const [gracePeriod, setGracePeriod] = useState(config.gracePeriodDays);
  const [degradedPeriod, setDegradedPeriod] = useState(config.degradedPeriodDays);
  const [cancellationThreshold, setCancellationThreshold] = useState(config.cancellationThresholdDays);
  const [notifyOnRetry, setNotifyOnRetry] = useState(config.notifyOnRetry);
  const [notifyOnGraceStart, setNotifyOnGraceStart] = useState(config.notifyOnGraceStart);
  const [notifyOnDegradation, setNotifyOnDegradation] = useState(config.notifyOnDegradation);
  const [notifyBeforeCancellation, setNotifyBeforeCancellation] = useState(config.notifyBeforeCancellation);

  function updateRetry(index: number, field: keyof RetryAttempt, value: string | number) {
    setRetryAttempts((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }

  function addRetry() {
    const maxDay = retryAttempts.length > 0
      ? Math.max(...retryAttempts.map((r) => r.day))
      : 0;
    setRetryAttempts((prev) => [...prev, { day: maxDay + 2, action: 'Retry payment' }]);
  }

  function removeRetry(index: number) {
    setRetryAttempts((prev) => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setRetryAttempts(config.retryAttempts);
    setGracePeriod(config.gracePeriodDays);
    setDegradedPeriod(config.degradedPeriodDays);
    setCancellationThreshold(config.cancellationThresholdDays);
    setNotifyOnRetry(config.notifyOnRetry);
    setNotifyOnGraceStart(config.notifyOnGraceStart);
    setNotifyOnDegradation(config.notifyOnDegradation);
    setNotifyBeforeCancellation(config.notifyBeforeCancellation);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Dunning Schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Retry attempts table */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">Retry Attempts</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Day</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {retryAttempts.map((attempt, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="px-4 py-2">
                      <Input
                        type="number"
                        className="h-8 w-20"
                        value={attempt.day}
                        onChange={(e) => updateRetry(idx, 'day', Number(e.target.value))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        className="h-8"
                        value={attempt.action}
                        onChange={(e) => updateRetry(idx, 'action', e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => removeRetry(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" className="mt-2" onClick={addRetry}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add Retry
          </Button>
        </div>

        {/* Period settings */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Grace period (days)</label>
            <Input
              type="number"
              value={gracePeriod}
              onChange={(e) => setGracePeriod(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Degraded period (days)</label>
            <Input
              type="number"
              value={degradedPeriod}
              onChange={(e) => setDegradedPeriod(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cancellation threshold (days)</label>
            <Input
              type="number"
              value={cancellationThreshold}
              onChange={(e) => setCancellationThreshold(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Notification toggles */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">Notification Triggers</h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Toggle
              checked={notifyOnRetry}
              onChange={setNotifyOnRetry}
              label="On retry"
            />
            <Toggle
              checked={notifyOnGraceStart}
              onChange={setNotifyOnGraceStart}
              label="Grace start"
            />
            <Toggle
              checked={notifyOnDegradation}
              onChange={setNotifyOnDegradation}
              label="Degradation"
            />
            <Toggle
              checked={notifyBeforeCancellation}
              onChange={setNotifyBeforeCancellation}
              label="Before cancellation"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>Reset</Button>
          <Button onClick={async () => {
            await adminUpdateDunningConfig({ client, body: { retryAttempts: retryAttempts.map((r) => ({ daysAfterFailure: r.day, action: r.action })), gracePeriodDays: gracePeriod, degradedPeriodDays: degradedPeriod, cancellationDays: cancellationThreshold, notifyOnRetry, notifyOnGracePeriodStart: notifyOnGraceStart, notifyOnDegradation, notifyBeforeCancellation } });
          }}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Retention Defaults Section ──────────────────────────────────────────────────

interface RetentionField {
  key: keyof RetentionDefaultsConfig;
  label: string;
  unit: string;
}

const RETENTION_FIELDS: RetentionField[] = [
  { key: 'contestResultRetentionSeasons', label: 'Contest Results', unit: 'seasons' },
  { key: 'rosterHistoryRetentionSeasons', label: 'Roster History', unit: 'seasons' },
  { key: 'activityLogRetentionDays', label: 'Activity Log', unit: 'days' },
  { key: 'payoutRecordRetentionSeasons', label: 'Payout Records', unit: 'seasons' },
  { key: 'chatMessageRetentionDays', label: 'Chat Messages', unit: 'days' },
  { key: 'auditLogRetentionDays', label: 'Audit Log', unit: 'days' },
];

function RetentionDefaultsSection() {
  const { data: config } = useRetentionDefaults();
  const [values, setValues] = useState<RetentionDefaultsConfig>({ ...config });
  const [tenantId, setTenantId] = useState('');
  const [tenantOverride, setTenantOverride] = useState<RetentionDefaultsConfig | null>(null);
  const [showTenantOverrides, setShowTenantOverrides] = useState(false);

  function updateField(key: keyof RetentionDefaultsConfig, value: number) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleInfinite(key: keyof RetentionDefaultsConfig) {
    setValues((prev) => ({
      ...prev,
      [key]: prev[key] === -1 ? 90 : -1,
    }));
  }

  function reset() {
    setValues({ ...config });
  }

  async function lookupTenant() {
    if (!tenantId.trim()) return;
    const { data: override } = await adminGetTenantRetentionOverride({ client, path: { tenantId } });
    setTenantOverride(override ?? null);
  }

  async function clearTenantOverride() {
    await adminClearTenantRetentionOverride({ client, path: { tenantId } });
    setTenantOverride(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Retention Defaults</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {RETENTION_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium">
                {field.label} ({field.unit})
              </label>
              <div className="flex items-center gap-2">
                {values[field.key] === -1 ? (
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    Infinite
                  </div>
                ) : (
                  <Input
                    type="number"
                    min={1}
                    value={values[field.key]}
                    onChange={(e) => updateField(field.key, Number(e.target.value))}
                  />
                )}
              </div>
              <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={values[field.key] === -1}
                  onChange={() => toggleInfinite(field.key)}
                  className="h-3.5 w-3.5 rounded border-gray-300"
                />
                Infinite (never delete)
              </label>
            </div>
          ))}
        </div>

        {/* Tenant Override Lookup */}
        <div>
          <button
            className="flex items-center gap-2 text-sm font-semibold"
            onClick={() => setShowTenantOverrides(!showTenantOverrides)}
          >
            {showTenantOverrides
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronRight className="h-4 w-4" />}
            Tenant Overrides
          </button>

          {showTenantOverrides && (
            <div className="mt-3 space-y-3 rounded-md border p-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-sm font-medium">Tenant ID</label>
                  <Input
                    placeholder="Enter tenant ID to look up"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={lookupTenant}>
                  Look Up
                </Button>
              </div>

              {tenantId && tenantOverride === null && (
                <p className="text-sm text-muted-foreground">
                  No override set — this tenant uses platform defaults.
                </p>
              )}

              {tenantOverride && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {RETENTION_FIELDS.map((field) => (
                      <div key={field.key}>
                        <label className="mb-1 block text-xs font-medium">
                          {field.label}
                        </label>
                        <Input
                          type="number"
                          className="h-8"
                          value={tenantOverride[field.key]}
                          onChange={(e) =>
                            setTenantOverride((prev) =>
                              prev ? { ...prev, [field.key]: Number(e.target.value) } : prev,
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={clearTenantOverride}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Clear Override
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (tenantOverride) {
                          await adminSetTenantRetentionOverride({ client, path: { tenantId }, body: tenantOverride });
                        }
                      }}
                    >
                      Save Override
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>Reset</Button>
          <Button onClick={async () => {
            await adminUpdateRetentionDefaults({ client, body: values });
          }}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function Component() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Server className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Platform Configuration</h1>
      </div>

      <PollIntervalsSection />
      <IngestionScheduleSection />
      <DunningScheduleSection />
      <RetentionDefaultsSection />
    </div>
  );
}
