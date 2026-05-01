import { LinkButton, Tile } from '@/features/shared/ui';
import { MANAGE_SECTION_DEFINITIONS } from './manage-navigation';

export function RootAdminManageHubPage() {
  return (
    <section
      className="space-y-6"
      data-testid="root-admin-manage-hub-page"
    >
      <section className="grid gap-4 xl:grid-cols-2">
        {MANAGE_SECTION_DEFINITIONS.map((section) => (
          <Tile
            key={section.key}
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
      </section>
    </section>
  );
}
