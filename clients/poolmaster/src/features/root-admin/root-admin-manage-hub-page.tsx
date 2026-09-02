import { LinkButton, Tile } from '@/features/shared/ui';
import {
  MANAGE_SECTION_GROUP_ORDER,
  getManageSectionsByGroup,
} from './manage-navigation';

export function RootAdminManageHubPage() {
  return (
    <section className="space-y-8" data-testid="root-admin-manage-hub-page">
      {MANAGE_SECTION_GROUP_ORDER.map((group) => {
        const sections = getManageSectionsByGroup(group.group);

        if (sections.length === 0) {
          return null;
        }

        return (
          <section
            className="space-y-4"
            data-testid={`root-admin-manage-group-${group.group}`}
            key={group.group}
          >
            <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {group.title}
            </h2>

            <div className="grid gap-4 xl:grid-cols-2">
              {sections.map((section) => (
                <Tile key={section.key}>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">
                      {section.title}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {section.description}
                    </p>
                  </div>

                  <div className="mt-5">
                    <LinkButton
                      data-testid={`root-admin-manage-link-${section.key}`}
                      to={section.to}
                      variant="subtle"
                    >
                      Open {section.title}
                    </LinkButton>
                  </div>
                </Tile>
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}
