import { Link } from 'react-router-dom';
import {
  getManageSectionDefinition,
  type ManageSectionKey,
} from './manage-navigation';

type RootAdminManageScaffoldPageProps = {
  sectionKey: ManageSectionKey;
};

export function RootAdminManageScaffoldPage({
  sectionKey,
}: RootAdminManageScaffoldPageProps) {
  const section = getManageSectionDefinition(sectionKey);

  return (
    <section
      className="space-y-6"
      data-testid={`root-admin-manage-scaffold-page-${sectionKey}`}
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Manage
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          {section.title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          {section.description}
        </p>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {section.availability === 'live' ? (
          <p className="text-sm text-muted-foreground">
            This section already has a dedicated surface. Use the page navigation
            above if you need to switch areas.
          </p>
        ) : section.availability === 'legacy' ? (
          <>
            <p className="text-sm text-muted-foreground">
              This section is now routed through its own canonical `/manage/*`
              destination, but the dedicated extraction work has not fully landed
              yet. Use the legacy manage surface for the live controls during the
              transition.
            </p>
            {section.legacyHref ? (
              <Link
                className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
                data-testid={`root-admin-manage-scaffold-legacy-${sectionKey}`}
                to={section.legacyHref}
              >
                Open legacy manage surface
              </Link>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This section is waiting on backend work before the dedicated admin
            page can become functional. The route is staged now so navigation can
            converge cleanly when the contract lands.
          </p>
        )}
      </section>
    </section>
  );
}
