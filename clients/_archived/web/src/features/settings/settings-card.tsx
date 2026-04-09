import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SettingsCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  badge?: string;
}

export function SettingsCard({ title, description, icon: Icon, href, badge }: SettingsCardProps) {
  return (
    <Link to={href} className="block">
      <Card className="transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CardContent className="flex items-start gap-4 p-6">
          <div className="rounded-md bg-muted p-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              {badge && (
                <Badge variant="default" className="text-xs">
                  {badge}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
