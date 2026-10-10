import type { ReactNode } from 'react';

/**
 * What a Manage page is for, and its page-wide actions, under the title the layout already
 * shows. A page uses this instead of a second header of its own.
 */
export function ManagePageIntro({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">{children}</p>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
