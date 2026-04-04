import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Bell, RotateCcw, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  client,
  adminUpdatePushTrigger,
  adminUpdateNotificationTemplate,
  adminUpdateRateLimitConfig,
  adminUpdateDigestConfig,
} from '@/lib/api';
import {
  usePushTriggers,
  useNotificationTemplates,
  useChannelDefaults,
  useRateLimits,
  useDigestConfig,
  useDigestPreview,
} from '@/hooks/use-config-api';
import type {
  PushTrigger,
  Priority,
  NotificationTemplate,
  Channel,
  NotificationCategory,
  CollapseRule,
  SendDay,
} from '@/hooks/use-config-api';

// ── Shared Toggle ──────────────────────────────────────────────────────────────

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

function priorityBadge(priority: Priority) {
  switch (priority) {
    case 'high':
      return <Badge className="bg-red-100 text-red-800 text-xs">High</Badge>;
    case 'normal':
      return <Badge variant="outline" className="text-xs">Normal</Badge>;
    case 'low':
      return <Badge className="bg-gray-100 text-gray-600 text-xs">Low</Badge>;
  }
}

// ── Push Triggers Section ──────────────────────────────────────────────────────

function PushTriggersSection() {
  const { data: triggers = [] } = usePushTriggers();
  const [toggleState, setToggleState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    triggers.forEach((t) => { initial[t.id] = t.enabled; });
    return initial;
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PushTrigger>>({});

  function handleToggle(id: string, value: boolean) {
    setToggleState((prev) => ({ ...prev, [id]: value }));
  }

  function startEdit(trigger: PushTrigger) {
    setEditingId(trigger.id);
    setEditForm({ title: trigger.title, body: trigger.body, priority: trigger.priority, sound: trigger.sound });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Push Triggers</CardTitle>
        <Button variant="outline" size="sm">
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Reset All to Defaults
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Event Type</th>
                <th className="px-4 py-3 text-left font-medium">Title</th>
                <th className="px-4 py-3 text-center font-medium">Priority</th>
                <th className="px-4 py-3 text-left font-medium">Sound</th>
                <th className="px-4 py-3 text-center font-medium">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr
                  key={t.id}
                  className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => editingId !== t.id && startEdit(t)}
                >
                  <td className="px-4 py-3 font-mono text-xs">{t.eventType}</td>
                  <td className="px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3 text-center">{priorityBadge(t.priority)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.sound}</td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={toggleState[t.id] ?? t.enabled}
                      onChange={(v) => handleToggle(t.id, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editingId && (
          <div className="border-t bg-muted/20 p-4">
            <h4 className="mb-3 text-sm font-semibold">Edit Trigger</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Title</label>
                <Input
                  value={editForm.title ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Body</label>
                <Input
                  value={editForm.body ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Priority</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={editForm.priority ?? 'normal'}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                >
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Sound</label>
                <Input
                  value={editForm.sound ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, sound: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
              <Button size="sm" onClick={async () => {
                if (editingId) {
                  const trigger = triggers.find((t) => t.id === editingId);
                  if (trigger) {
                    await adminUpdatePushTrigger({
                      client,
                      path: { eventType: trigger.eventType },
                      body: {
                        ...editForm,
                        priority: editForm.priority === 'low' ? 'normal' : editForm.priority,
                      },
                    });
                  }
                }
                cancelEdit();
              }}>
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Notification Templates Section ─────────────────────────────────────────────

function NotificationTemplatesSection() {
  const { data: templates = [] } = useNotificationTemplates();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<NotificationTemplate>>({});

  function toggleExpand(template: NotificationTemplate) {
    if (expandedId === template.id) {
      setExpandedId(null);
      setEditForm({});
    } else {
      setExpandedId(template.id);
      setEditForm({
        pushTitle: template.pushTitle,
        pushBody: template.pushBody,
        emailSubject: template.emailSubject,
        emailBodyPreview: template.emailBodyPreview,
        inAppTitle: template.inAppTitle,
        inAppBody: template.inAppBody,
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notification Templates</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3 text-left font-medium">Event Type</th>
                <th className="px-4 py-3 text-left font-medium">Push Title</th>
                <th className="px-4 py-3 text-left font-medium">Email Subject</th>
                <th className="px-4 py-3 text-left font-medium">In-App Title</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <>
                  <tr
                    key={t.id}
                    className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => toggleExpand(t)}
                  >
                    <td className="px-4 py-3">
                      {expandedId === t.id
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{t.eventType}</td>
                    <td className="px-4 py-3">{t.pushTitle}</td>
                    <td className="px-4 py-3">{t.emailSubject}</td>
                    <td className="px-4 py-3">{t.inAppTitle}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm">
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Reset to Default
                      </Button>
                    </td>
                  </tr>
                  {expandedId === t.id && (
                    <tr key={`${t.id}-edit`} className="border-b bg-muted/20">
                      <td colSpan={6} className="p-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="mb-1 block text-xs font-medium">Push Title</label>
                            <Input
                              value={editForm.pushTitle ?? ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, pushTitle: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">Push Body</label>
                            <Input
                              value={editForm.pushBody ?? ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, pushBody: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">Email Subject</label>
                            <Input
                              value={editForm.emailSubject ?? ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, emailSubject: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">Email Body Preview</label>
                            <Input
                              value={editForm.emailBodyPreview ?? ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, emailBodyPreview: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">In-App Title</label>
                            <Input
                              value={editForm.inAppTitle ?? ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, inAppTitle: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">In-App Body</label>
                            <Input
                              value={editForm.inAppBody ?? ''}
                              onChange={(e) => setEditForm((f) => ({ ...f, inAppBody: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setExpandedId(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={async () => {
                            if (expandedId) {
                              const template = templates.find((t) => t.id === expandedId);
                              if (template) {
                                await adminUpdateNotificationTemplate({
                                  client,
                                  path: { eventType: template.eventType },
                                  body: {
                                    pushTitle: editForm.pushTitle,
                                    pushBody: editForm.pushBody,
                                    emailSubject: editForm.emailSubject,
                                    emailText: editForm.emailBodyPreview,
                                    inAppTitle: editForm.inAppTitle,
                                    inAppBody: editForm.inAppBody,
                                  },
                                });
                              }
                            }
                            setExpandedId(null);
                          }}>
                            Save
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Channel Defaults Section ───────────────────────────────────────────────────

const ALL_CHANNELS: Channel[] = ['push', 'email', 'sms', 'in_app'];

function channelLabel(ch: Channel): string {
  switch (ch) {
    case 'push': return 'Push';
    case 'email': return 'Email';
    case 'sms': return 'SMS';
    case 'in_app': return 'In-App';
  }
}

function ChannelDefaultsSection() {
  const { data: defaults = [] } = useChannelDefaults();
  const [channels, setChannels] = useState<Record<NotificationCategory, Channel[]>>(() => {
    const initial: Record<string, Channel[]> = {};
    defaults.forEach((d) => { initial[d.category] = [...d.channels]; });
    return initial as Record<NotificationCategory, Channel[]>;
  });
  const [editingCategory, setEditingCategory] = useState<NotificationCategory | null>(null);

  function toggleChannel(category: NotificationCategory, channel: Channel) {
    setChannels((prev) => {
      const current = prev[category] ?? [];
      const next = current.includes(channel)
        ? current.filter((c) => c !== channel)
        : [...current, channel];
      return { ...prev, [category]: next };
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Channel Defaults</CardTitle>
        <Button variant="outline" size="sm">
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Reset Defaults
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Channels</th>
              </tr>
            </thead>
            <tbody>
              {defaults.map((d) => (
                <tr
                  key={d.category}
                  className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setEditingCategory(
                    editingCategory === d.category ? null : d.category,
                  )}
                >
                  <td className="px-4 py-3 font-medium">{d.category}</td>
                  <td className="px-4 py-3">
                    {editingCategory === d.category ? (
                      <div className="flex items-center gap-3">
                        {ALL_CHANNELS.map((ch) => (
                          <label key={ch} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={(channels[d.category] ?? []).includes(ch)}
                              onChange={() => toggleChannel(d.category, ch)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            {channelLabel(ch)}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        {(channels[d.category] ?? []).map((ch) => (
                          <Badge key={ch} variant="outline" className="text-xs">
                            {channelLabel(ch)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Rate Limits Section ────────────────────────────────────────────────────────

function RateLimitsSection() {
  const { data: config } = useRateLimits();
  const safeConfig = config ?? {
    pushPerHour: 0,
    emailPerDay: 0,
    smsPerDay: 0,
    dedupWindowSeconds: 0,
    collapseRules: [],
  };
  const [pushPerHour, setPushPerHour] = useState(safeConfig.pushPerHour);
  const [emailPerDay, setEmailPerDay] = useState(safeConfig.emailPerDay);
  const [smsPerDay, setSmsPerDay] = useState(safeConfig.smsPerDay);
  const [dedupWindow, setDedupWindow] = useState(safeConfig.dedupWindowSeconds);
  const [collapseRules, setCollapseRules] = useState<CollapseRule[]>(safeConfig.collapseRules);

  function updateRule(index: number, field: keyof CollapseRule, value: string | number) {
    setCollapseRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }

  function resetAll() {
    setPushPerHour(safeConfig.pushPerHour);
    setEmailPerDay(safeConfig.emailPerDay);
    setSmsPerDay(safeConfig.smsPerDay);
    setDedupWindow(safeConfig.dedupWindowSeconds);
    setCollapseRules(safeConfig.collapseRules);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Rate Limits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Push per hour</label>
            <Input
              type="number"
              value={pushPerHour}
              onChange={(e) => setPushPerHour(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email per day</label>
            <Input
              type="number"
              value={emailPerDay}
              onChange={(e) => setEmailPerDay(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">SMS per day</label>
            <Input
              type="number"
              value={smsPerDay}
              onChange={(e) => setSmsPerDay(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Dedup window (s)</label>
            <Input
              type="number"
              value={dedupWindow}
              onChange={(e) => setDedupWindow(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold">Collapse Rules</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Event Type</th>
                  <th className="px-4 py-2 text-left font-medium">Max per Hour</th>
                  <th className="px-4 py-2 text-left font-medium">Window (min)</th>
                </tr>
              </thead>
              <tbody>
                {collapseRules.map((rule, idx) => (
                  <tr key={rule.eventType} className="border-b">
                    <td className="px-4 py-2 font-mono text-xs">{rule.eventType}</td>
                    <td className="px-4 py-2">
                      <Input
                        type="number"
                        className="h-8 w-24"
                        value={rule.maxPerHour}
                        onChange={(e) => updateRule(idx, 'maxPerHour', Number(e.target.value))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        type="number"
                        className="h-8 w-24"
                        value={rule.windowMinutes}
                        onChange={(e) => updateRule(idx, 'windowMinutes', Number(e.target.value))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={resetAll}>Reset</Button>
          <Button onClick={async () => {
            await adminUpdateRateLimitConfig({ client, body: { pushPerHour, emailPerDay, smsPerDay, dedupWindowSeconds: dedupWindow, collapseRules } });
          }}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Weekly Digest Section ────────────────────────────────────────────────────

const SEND_DAYS: SendDay[] = [
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
];

function WeeklyDigestSection() {
  const { data: config } = useDigestConfig();
  const { data: digestPreview = '' } = useDigestPreview();
  const safeConfig = config ?? {
    subjectTemplate: '',
    headerTemplate: '',
    footerTemplate: '',
    includeStandings: false,
    includeHighlights: false,
    includeUpcomingEvents: false,
    lookbackDays: 0,
    sendDay: 'MONDAY' as SendDay,
    sendHourUtc: 0,
    enabled: false,
  };
  const [subjectTemplate, setSubjectTemplate] = useState(safeConfig.subjectTemplate);
  const [headerTemplate, setHeaderTemplate] = useState(safeConfig.headerTemplate);
  const [footerTemplate, setFooterTemplate] = useState(safeConfig.footerTemplate);
  const [includeStandings, setIncludeStandings] = useState(safeConfig.includeStandings);
  const [includeHighlights, setIncludeHighlights] = useState(safeConfig.includeHighlights);
  const [includeUpcomingEvents, setIncludeUpcomingEvents] = useState(safeConfig.includeUpcomingEvents);
  const [lookbackDays, setLookbackDays] = useState(safeConfig.lookbackDays);
  const [sendDay, setSendDay] = useState<SendDay>(safeConfig.sendDay);
  const [sendHourUtc, setSendHourUtc] = useState(safeConfig.sendHourUtc);
  const [enabled, setEnabled] = useState(safeConfig.enabled);
  const [showPreview, setShowPreview] = useState(false);

  function reset() {
    setSubjectTemplate(safeConfig.subjectTemplate);
    setHeaderTemplate(safeConfig.headerTemplate);
    setFooterTemplate(safeConfig.footerTemplate);
    setIncludeStandings(safeConfig.includeStandings);
    setIncludeHighlights(safeConfig.includeHighlights);
    setIncludeUpcomingEvents(safeConfig.includeUpcomingEvents);
    setLookbackDays(safeConfig.lookbackDays);
    setSendDay(safeConfig.sendDay);
    setSendHourUtc(safeConfig.sendHourUtc);
    setEnabled(safeConfig.enabled);
    setShowPreview(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Weekly Digest</CardTitle>
        <div className="flex items-center gap-3">
          <Toggle checked={enabled} onChange={setEnabled} />
          <span className="text-sm text-muted-foreground">
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Template fields */}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Subject Template</label>
            <Input
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
              placeholder="Weekly Recap — {{league_name}}"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Available placeholder: {'{{league_name}}'}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Header Template</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={headerTemplate}
              onChange={(e) => setHeaderTemplate(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Footer Template</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={footerTemplate}
              onChange={(e) => setFooterTemplate(e.target.value)}
            />
          </div>
        </div>

        {/* Content toggles */}
        <div>
          <h4 className="mb-3 text-sm font-semibold">Content Sections</h4>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Toggle checked={includeStandings} onChange={setIncludeStandings} />
              Include Standings
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Toggle checked={includeHighlights} onChange={setIncludeHighlights} />
              Include Highlights
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Toggle checked={includeUpcomingEvents} onChange={setIncludeUpcomingEvents} />
              Include Upcoming Events
            </label>
          </div>
        </div>

        {/* Schedule settings */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Lookback Days</label>
            <Input
              type="number"
              min={1}
              max={30}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Send Day</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={sendDay}
              onChange={(e) => setSendDay(e.target.value as SendDay)}
            >
              {SEND_DAYS.map((day) => (
                <option key={day} value={day}>
                  {day.charAt(0) + day.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Send Hour (UTC, 0-23)</label>
            <Input
              type="number"
              min={0}
              max={23}
              value={sendHourUtc}
              onChange={(e) => setSendHourUtc(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Preview */}
        <div>
          <Button
            variant="outline"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="mr-2 h-4 w-4" />
            {showPreview ? 'Hide Preview' : 'Preview Digest'}
          </Button>

          {showPreview && (
            <Card className="mt-3 bg-muted/30">
              <CardContent className="p-4">
                <h4 className="mb-2 text-sm font-semibold">Digest Preview</h4>
                <pre className="whitespace-pre-wrap rounded-md bg-background p-4 text-xs font-mono leading-relaxed">
                  {digestPreview}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>Reset</Button>
          <Button onClick={async () => {
            await adminUpdateDigestConfig({ client, body: { subjectTemplate, headerTemplate, footerTemplate, includeStandings, includeHighlights, includeUpcomingEvents, lookbackDays, sendDay, sendHourUtc, enabled } });
          }}>
            Save
          </Button>
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
        <Bell className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Notification Configuration</h1>
      </div>

      <PushTriggersSection />
      <NotificationTemplatesSection />
      <ChannelDefaultsSection />
      <RateLimitsSection />
      <WeeklyDigestSection />
    </div>
  );
}
