import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { client, adminCreateAnnouncement } from '@/lib/api';

type AnnouncementType = 'Banner' | 'Notification' | 'Both';
type Severity = 'Info' | 'Warning' | 'Critical';
type Target = 'All Users' | 'Specific Tenants';

interface FormState {
  type: AnnouncementType;
  title: string;
  body: string;
  linkUrl: string;
  linkText: string;
  severity: Severity;
  dismissable: boolean;
  target: Target;
  tenantIds: string;
  startsAt: string;
  endsAt: string;
}

const SEVERITY_COLORS: Record<Severity, { dot: string; bar: string; bg: string }> = {
  Info: { dot: 'bg-blue-500', bar: 'bg-blue-500', bg: 'bg-blue-50 border-blue-200' },
  Warning: { dot: 'bg-yellow-500', bar: 'bg-yellow-500', bg: 'bg-yellow-50 border-yellow-200' },
  Critical: { dot: 'bg-red-500', bar: 'bg-red-500', bg: 'bg-red-50 border-red-200' },
};

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    type: 'Banner',
    title: '',
    body: '',
    linkUrl: '',
    linkText: '',
    severity: 'Info',
    dismissable: true,
    target: 'All Users',
    tenantIds: '',
    startsAt: '',
    endsAt: '',
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePublish() {
    const response = await adminCreateAnnouncement({
      client,
      body: {
        type: form.type === 'Banner' ? 'BANNER' : form.type === 'Notification' ? 'NOTIFICATION' : 'BOTH',
        title: form.title,
        body: form.body,
        linkUrl: form.linkUrl || undefined,
        linkText: form.linkText || undefined,
        severity: form.severity === 'Info' ? 'INFO' : form.severity === 'Warning' ? 'WARNING' : 'CRITICAL',
        dismissable: form.dismissable,
        target: form.target === 'All Users' ? 'ALL_USERS' : 'SPECIFIC_TENANTS',
        targetTenantIds: form.target === 'Specific Tenants'
          ? form.tenantIds.split(',').map((tenantId) => tenantId.trim()).filter(Boolean)
          : undefined,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
      },
    });

    await queryClient.invalidateQueries({ queryKey: ['announcements'] });

    if (response.data?.id) {
      navigate('/announcements');
    }
  }

  const colors = SEVERITY_COLORS[form.severity];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/announcements">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Create Announcement</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Announcement Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Type */}
            <div>
              <label className="mb-2 block text-sm font-medium">Type</label>
              <div className="flex gap-4">
                {(['Banner', 'Notification', 'Both'] as AnnouncementType[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="type"
                      checked={form.type === t}
                      onChange={() => update('type', t)}
                      className="accent-primary"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label htmlFor="announcement-title" className="mb-1 block text-sm font-medium">
                Title <span className="text-red-500">*</span>
              </label>
              <Input
                id="announcement-title"
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Announcement title..."
              />
            </div>

            {/* Body */}
            <div>
              <label htmlFor="announcement-body" className="mb-1 block text-sm font-medium">
                Body <span className="text-red-500">*</span>
              </label>
              <textarea
                id="announcement-body"
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={form.body}
                onChange={(e) => update('body', e.target.value)}
                placeholder="Announcement body text..."
              />
            </div>

            {/* Link */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="announcement-link-url" className="mb-1 block text-sm font-medium">Link URL</label>
                <Input
                  id="announcement-link-url"
                  value={form.linkUrl}
                  onChange={(e) => update('linkUrl', e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label htmlFor="announcement-link-text" className="mb-1 block text-sm font-medium">Link Text</label>
                <Input
                  id="announcement-link-text"
                  value={form.linkText}
                  onChange={(e) => update('linkText', e.target.value)}
                  placeholder="Learn more"
                />
              </div>
            </div>

            {/* Severity */}
            <div>
              <label className="mb-2 block text-sm font-medium">Severity</label>
              <div className="flex gap-4">
                {(['Info', 'Warning', 'Critical'] as Severity[]).map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="severity"
                      checked={form.severity === s}
                      onChange={() => update('severity', s)}
                      className="accent-primary"
                    />
                    <span className={cn('inline-block h-2.5 w-2.5 rounded-full', SEVERITY_COLORS[s].dot)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>

            {/* Dismissable */}
            <div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.dismissable}
                  onChange={(e) => update('dismissable', e.target.checked)}
                  className="accent-primary"
                />
                Dismissable
              </label>
            </div>

            {/* Target */}
            <div>
              <label className="mb-2 block text-sm font-medium">Target</label>
              <div className="flex gap-4">
                {(['All Users', 'Specific Tenants'] as Target[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="target"
                      checked={form.target === t}
                      onChange={() => update('target', t)}
                      className="accent-primary"
                    />
                    {t}
                  </label>
                ))}
              </div>
              {form.target === 'Specific Tenants' && (
                <div className="mt-2">
                  <label htmlFor="announcement-tenant-ids" className="mb-1 block text-sm font-medium">
                    Tenant IDs
                  </label>
                  <Input
                    id="announcement-tenant-ids"
                    value={form.tenantIds}
                    onChange={(e) => update('tenantIds', e.target.value)}
                    placeholder="Comma-separated tenant IDs..."
                  />
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="announcement-starts-at" className="mb-1 block text-sm font-medium">Starts At</label>
                <Input
                  id="announcement-starts-at"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => update('startsAt', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="announcement-ends-at" className="mb-1 block text-sm font-medium">Ends At</label>
                <Input
                  id="announcement-ends-at"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => update('endsAt', e.target.value)}
                />
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!form.title || !form.body}
              data-testid="announcement-publish"
              onClick={handlePublish}
            >
              Publish
            </Button>
          </CardContent>
        </Card>

        {/* Right: Preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {form.title || form.body ? (
                <div className={cn('rounded-lg border overflow-hidden', colors.bg)}>
                  <div className={cn('h-1.5', colors.bar)} />
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        {form.title && (
                          <p className="font-semibold text-sm">{form.title}</p>
                        )}
                        {form.body && (
                          <p className="text-sm text-muted-foreground">{form.body}</p>
                        )}
                        {form.linkUrl && form.linkText && (
                          <a
                            href={form.linkUrl}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {form.linkText}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      {form.dismissable && (
                        <button className="ml-4 text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Fill in the form to see a live preview of your announcement.
                </p>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
