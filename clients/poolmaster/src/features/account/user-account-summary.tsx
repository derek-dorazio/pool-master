import { DefinitionList, Tile } from "@/features/shared/ui";

export type UserAccountSummaryProps = {
  email: string;
  memberSince: string;
  method: string;
  name: string;
  role: string;
  status: string;
  username: string;
};

export function UserAccountSummary({
  email,
  memberSince,
  method,
  name,
  role,
  status,
  username,
}: UserAccountSummaryProps) {
  return (
    <>
      <Tile data-testid="user-page-identity-summary" radius="lg">
        <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Account summary
        </div>
        <DefinitionList
          className="mt-4 sm:grid-cols-1"
          items={[
            { id: "name", label: "Name", value: name },
            { id: "email", label: "Email", value: email },
            { id: "username", label: "Username", value: username },
          ]}
        />
      </Tile>

      <Tile data-testid="user-page-account-details" radius="lg">
        <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Account details
        </div>
        <DefinitionList
          className="mt-4"
          items={[
            { id: "member-since", label: "Member since", value: memberSince },
            { id: "status", label: "Status", value: status },
            { id: "role", label: "Role", value: role },
            { id: "method", label: "Method", value: method },
          ]}
        />
      </Tile>
    </>
  );
}
