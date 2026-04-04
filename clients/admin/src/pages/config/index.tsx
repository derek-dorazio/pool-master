import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import {
  Settings2,
  FileCode2,
  Bell,
  Server,
  ArrowRight,
} from 'lucide-react';

interface ConfigCard {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  items: string[];
}

const configSections: ConfigCard[] = [
  {
    to: '/config/templates',
    icon: <FileCode2 className="h-6 w-6" />,
    title: 'Templates',
    description: 'Scoring & selection template management',
    items: ['Scoring templates', 'Selection templates', 'Sport-specific configs'],
  },
  {
    to: '/config/notifications',
    icon: <Bell className="h-6 w-6" />,
    title: 'Notifications',
    description: 'Notification templates, push triggers, channels, rate limits',
    items: ['Push triggers', 'Notification templates', 'Channel defaults', 'Rate limits'],
  },
  {
    to: '/config/platform',
    icon: <Server className="h-6 w-6" />,
    title: 'Platform',
    description: 'Poll intervals, ingestion schedules, dunning, and retention defaults',
    items: ['Poll intervals', 'Ingestion schedules', 'Dunning configuration', 'Retention defaults'],
  },
];

export function Component() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings2 className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Configuration</h1>
      </div>
      <p className="text-muted-foreground">
        Manage platform configuration, templates, notifications, and system settings.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {configSections.map((section) => (
          <Card
            key={section.to}
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => navigate(section.to)}
          >
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {section.icon}
                </div>
                <h2 className="text-lg font-semibold">{section.title}</h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                {section.description}
              </p>
              <ul className="mb-4 space-y-1">
                {section.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-1 text-sm font-medium text-primary">
                Manage
                <ArrowRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
