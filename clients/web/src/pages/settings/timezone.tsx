import { useState, useMemo } from 'react';
import { usePreferencesStore } from '@/stores/preferences-store';
import { formatTime, getTimezoneAbbr } from '@/lib/format-time';
import { TIMEZONES, getTimezonesByRegion, searchTimezones } from '@/lib/timezones';
import { cn } from '@/lib/utils';

const AUTO_DETECT = '__auto__';

function detectTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function Component() {
  const prefs = usePreferencesStore();

  const [selectedTz, setSelectedTz] = useState<string>(() => {
    const detected = detectTimezone();
    return prefs.timezone === detected ? AUTO_DETECT : prefs.timezone;
  });
  const [dateFormat, setDateFormat] = useState(prefs.dateFormat);
  const [timeFormat, setTimeFormat] = useState(prefs.timeFormat);
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(prefs.firstDayOfWeek);
  const [tzSearch, setTzSearch] = useState('');
  const [saved, setSaved] = useState(false);

  const resolvedTz = selectedTz === AUTO_DETECT ? detectTimezone() : selectedTz;

  const filteredTimezones = useMemo(() => {
    if (tzSearch.trim()) return searchTimezones(tzSearch);
    return null; // use grouped view
  }, [tzSearch]);

  const groupedTimezones = useMemo(() => getTimezonesByRegion(), []);

  function handleSave() {
    prefs.setTimezone(resolvedTz);
    prefs.setDateFormat(dateFormat);
    prefs.setTimeFormat(timeFormat);
    prefs.setFirstDayOfWeek(firstDayOfWeek);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const now = new Date();

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Timezone & Locale</h1>
        <p className="text-muted-foreground mt-1">
          Set your timezone, date format, and locale preferences so deadlines and schedules display correctly.
        </p>
      </div>

      {/* Timezone Picker */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Timezone</h2>

        {/* Search */}
        <input
          type="text"
          placeholder="Search timezones..."
          value={tzSearch}
          onChange={(e) => setTzSearch(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />

        <div className="max-h-64 overflow-y-auto rounded-md border border-input bg-background">
          {/* Auto-detect option */}
          <button
            type="button"
            onClick={() => setSelectedTz(AUTO_DETECT)}
            className={cn(
              'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors',
              selectedTz === AUTO_DETECT && 'bg-accent font-medium',
            )}
          >
            Auto-detect ({detectTimezone()})
          </button>

          {filteredTimezones ? (
            // Search results (flat list)
            filteredTimezones.map((tz) => (
              <button
                key={tz.iana}
                type="button"
                onClick={() => setSelectedTz(tz.iana)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors',
                  selectedTz === tz.iana && 'bg-accent font-medium',
                )}
              >
                {tz.label}
                <span className="ml-2 text-muted-foreground text-xs">{tz.iana}</span>
              </button>
            ))
          ) : (
            // Grouped view
            Object.entries(groupedTimezones).map(([region, tzList]) => (
              <div key={region}>
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/50 sticky top-0">
                  {region}
                </div>
                {tzList.map((tz) => (
                  <button
                    key={tz.iana}
                    type="button"
                    onClick={() => setSelectedTz(tz.iana)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors',
                      selectedTz === tz.iana && 'bg-accent font-medium',
                    )}
                  >
                    {tz.label}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Current: {resolvedTz} ({getTimezoneAbbr(resolvedTz, now)})
        </p>
      </section>

      {/* Date Format */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Date Format</h2>
        <div className="space-y-2">
          {([
            ['MDY', 'MM/DD/YYYY', '03/28/2026'],
            ['DMY', 'DD/MM/YYYY', '28/03/2026'],
            ['YMD', 'YYYY-MM-DD', '2026-03-28'],
          ] as const).map(([code, label, example]) => (
            <label
              key={code}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors',
                dateFormat === code ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
              )}
            >
              <input
                type="radio"
                name="dateFormat"
                value={code}
                checked={dateFormat === code}
                onChange={() => setDateFormat(code)}
                className="accent-primary"
              />
              <span className="text-sm">{label}</span>
              <span className="text-xs text-muted-foreground ml-auto">{example}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Time Format */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Time Format</h2>
        <div className="space-y-2">
          {([
            ['12H', '12-hour', '7:00 PM'],
            ['24H', '24-hour', '19:00'],
          ] as const).map(([code, label, example]) => (
            <label
              key={code}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors',
                timeFormat === code ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
              )}
            >
              <input
                type="radio"
                name="timeFormat"
                value={code}
                checked={timeFormat === code}
                onChange={() => setTimeFormat(code)}
                className="accent-primary"
              />
              <span className="text-sm">{label}</span>
              <span className="text-xs text-muted-foreground ml-auto">{example}</span>
            </label>
          ))}
        </div>
      </section>

      {/* First Day of Week */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">First Day of Week</h2>
        <div className="space-y-2">
          {([
            ['SUNDAY', 'Sunday'],
            ['MONDAY', 'Monday'],
          ] as const).map(([code, label]) => (
            <label
              key={code}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors',
                firstDayOfWeek === code ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
              )}
            >
              <input
                type="radio"
                name="firstDayOfWeek"
                value={code}
                checked={firstDayOfWeek === code}
                onChange={() => setFirstDayOfWeek(code)}
                className="accent-primary"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Format Preview */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Preview</h2>
        <div className="rounded-md border border-input bg-muted/30 p-4 space-y-2 text-sm">
          <PreviewRow
            label="Short date"
            dateFormat={dateFormat}
            timeFormat={timeFormat}
            timezone={resolvedTz}
            format="DATE_SHORT"
          />
          <PreviewRow
            label="Long date"
            dateFormat={dateFormat}
            timeFormat={timeFormat}
            timezone={resolvedTz}
            format="DATE_LONG"
          />
          <PreviewRow
            label="Time"
            dateFormat={dateFormat}
            timeFormat={timeFormat}
            timezone={resolvedTz}
            format="TIME"
          />
          <PreviewRow
            label="Short datetime"
            dateFormat={dateFormat}
            timeFormat={timeFormat}
            timezone={resolvedTz}
            format="DATETIME_SHORT"
          />
          <PreviewRow
            label="Full datetime"
            dateFormat={dateFormat}
            timeFormat={timeFormat}
            timezone={resolvedTz}
            format="DATETIME_LONG"
          />
        </div>
      </section>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save Preferences
        </button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
        )}
      </div>
    </div>
  );
}

/**
 * Preview row that temporarily overrides the store to render with selected settings.
 */
function PreviewRow({
  label,
  dateFormat,
  timeFormat,
  timezone,
  format,
}: {
  label: string;
  dateFormat: 'MDY' | 'DMY' | 'YMD';
  timeFormat: '12H' | '24H';
  timezone: string;
  format: 'DATE_SHORT' | 'DATE_LONG' | 'TIME' | 'DATETIME_SHORT' | 'DATETIME_LONG';
}) {
  const now = new Date();
  const hour12 = timeFormat === '12H';

  let options: Intl.DateTimeFormatOptions;
  switch (format) {
    case 'DATE_SHORT':
      options = dateFormat === 'YMD'
        ? { year: 'numeric', month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric' };
      break;
    case 'DATE_LONG':
      options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      break;
    case 'TIME':
      options = { hour: 'numeric', minute: '2-digit', hour12 };
      break;
    case 'DATETIME_SHORT':
      options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12 };
      break;
    case 'DATETIME_LONG':
      options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12,
        timeZoneName: 'short',
      };
      break;
  }

  const formatted = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(now);

  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{formatted}</span>
    </div>
  );
}
