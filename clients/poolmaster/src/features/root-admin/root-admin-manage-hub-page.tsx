import { Link } from 'react-router-dom';
import { MANAGE_SECTION_DEFINITIONS } from './manage-navigation';

export function RootAdminManageHubPage() {
  return (
    <section
      className="space-y-6"
      data-testid="root-admin-manage-hub-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Root Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Manage
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Choose a focused operational area from the canonical manage hub and
          route directly into the dedicated admin pages for each workflow.
        </p>
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        {MANAGE_SECTION_DEFINITIONS.map((section) => (
          <article
            key={section.key}
            className="rounded-[2rem] border border-border bg-card p-6"
          >
            <div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {section.title}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <Link
                className="inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
                data-testid={`root-admin-manage-link-${section.key}`}
                to={section.to}
              >
                Open {section.title}
              </Link>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
