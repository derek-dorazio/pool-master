import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import {
  MutationActionToast,
  useMutationActionWorkflow,
  type MutationActionWorkflowOptions,
} from "./mutation-action-workflow";

function renderWorkflow<TData, TVariables = void>(
  options: MutationActionWorkflowOptions<TData, TVariables>,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  function Harness() {
    const workflow = useMutationActionWorkflow(options);

    return (
      <div>
        <button
          onClick={() => {
            void (workflow.run as (variables?: unknown) => Promise<TData>)("payload").catch(
              () => undefined,
            );
          }}
          type="button"
        >
          Run
        </button>
        <span data-testid="pending">{workflow.isPending ? "pending" : "idle"}</span>
        {workflow.isError ? <span role="alert">Action failed</span> : null}
        <MutationActionToast
          onDismiss={workflow.dismissToast}
          toast={workflow.toast}
        />
      </div>
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );

  return { invalidateSpy, queryClient };
}

describe("pool-master-pjr.4: shared mutation action workflow", () => {
  it("rule: runs an action, invalidates configured queries, closes, navigates, and shows success toast", async () => {
    const action = vi.fn().mockResolvedValue({ id: "updated" });
    const onClose = vi.fn();
    const navigate = vi.fn();
    const onSuccess = vi.fn();
    const { invalidateSpy } = renderWorkflow({
      action,
      invalidateQueries: [["poolmaster", "entity"]],
      navigate,
      onClose,
      onSuccess,
      successToast: {
        title: "Saved",
        description: "The action completed.",
        tone: "success",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(action).toHaveBeenCalledWith("payload"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["poolmaster", "entity"] }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: "updated" }, "payload"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ id: "updated" }, "payload");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("The action completed.")).toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("idle");
  });

  it("rule: preserves error state and emits the configured error toast without closing", async () => {
    const actionError = new Error("Nope");
    const action = vi.fn().mockRejectedValue(actionError);
    const onClose = vi.fn();
    const onError = vi.fn();
    renderWorkflow({
      action,
      errorToast: {
        title: "Action failed",
        description: "Try again.",
        tone: "danger",
      },
      onClose,
      onError,
      successToast: {
        title: "Saved",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(action).toHaveBeenCalledWith("payload"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(actionError, "payload"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Action failed");
    expect(screen.getByText("Try again.")).toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("idle");
  });
});
