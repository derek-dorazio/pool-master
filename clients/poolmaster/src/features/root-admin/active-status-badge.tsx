import { StatusBadge } from "@/features/shared/ui";

/** An "Active" or "Inactive" grid cell as a badge, shared by the leagues and users lists. */
export function ActiveStatusBadge({ status }: { status: "Active" | "Inactive" }) {
  return <StatusBadge tone={status === "Active" ? "active" : "inactive"}>{status}</StatusBadge>;
}
