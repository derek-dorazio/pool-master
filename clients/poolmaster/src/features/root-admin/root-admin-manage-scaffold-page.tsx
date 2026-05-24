import { Alert, PageHeader, Tile } from '@/features/shared/ui';
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
      <PageHeader
        description={section.description}
        eyebrow="Manage"
        title={section.title}
      />

      <Tile>
        <Alert>
          This section already has a dedicated surface. Use the page navigation
          above if you need to switch areas.
        </Alert>
      </Tile>
    </section>
  );
}
