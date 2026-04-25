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
        <p className="text-sm text-muted-foreground">
          This section already has a dedicated surface. Use the page navigation
          above if you need to switch areas.
        </p>
      </section>
    </section>
  );
}
