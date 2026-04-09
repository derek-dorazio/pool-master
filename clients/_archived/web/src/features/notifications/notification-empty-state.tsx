import { BellOff } from 'lucide-react';

interface NotificationEmptyStateProps {
  category?: string;
}

export function NotificationEmptyState({ category }: NotificationEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <BellOff className="h-12 w-12 text-muted-foreground/40" />
      {category ? (
        <>
          <p className="mt-4 text-sm font-medium">No {category} notifications</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a different category or check back later.
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">You're all caught up!</p>
          <p className="mt-1 text-xs text-muted-foreground">
            We'll notify you when something happens.
          </p>
        </>
      )}
    </div>
  );
}
