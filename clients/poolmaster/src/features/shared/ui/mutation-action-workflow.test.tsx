import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { Toaster } from "./toaster";
import {
  useMutationActionWorkflow,
  type MutationActionWorkflowOptions,
} from "./mutation-action-workflow";
import { QueryKeys } from '@/lib/query-keys';

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
  const cancelSpy = vi.spyOn(queryClient, "cancelQueries");

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
      </div>
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
      <Toaster />
    </QueryClientProvider>,
  );

  return { cancelSpy, invalidateSpy, queryClient };
}

describe("pool-master-pjr.4: shared mutation action workflow", () => {
  it("rule: runs an action, invalidates configured queries, closes, navigates, and shows success toast", async () => {
    const action = vi.fn().mockResolvedValue({ id: "updated" });
    const onClose = vi.fn();
    const navigate = vi.fn();
    const onSuccess = vi.fn();
    const { invalidateSpy } = renderWorkflow({
      action,
      invalidateQueries: [QueryKeys.leagues.list],
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
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: QueryKeys.leagues.list }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: "updated" }, "payload"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ id: "updated" }, "payload");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("The action completed.")).toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("idle");
  });

  it("cancels a read of an invalidated list still in flight before invalidating it, so its pre-save answer is not kept as fresh", async () => {
    const action = vi.fn().mockResolvedValue({ id: "updated" });
    const { cancelSpy, invalidateSpy } = renderWorkflow({
      action,
      invalidateQueries: [QueryKeys.leagues.list],
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: QueryKeys.leagues.list }));
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: QueryKeys.leagues.list });
    expect(cancelSpy.mock.invocationCallOrder[0]).toBeLessThan(invalidateSpy.mock.invocationCallOrder[0]);
  });

  it("keeps the success toast on screen after the component that saved unmounts, as when a save closes its dialog", async () => {
    const queryClient = new QueryClient();
    function Saver() {
      const workflow = useMutationActionWorkflow({ action: () => Promise.resolve("ok"), successToast: { title: "Profile saved" } });
      return <button onClick={() => void workflow.run()} type="button">Save</button>;
    }
    function Page({ showSaver }: { showSaver: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          {showSaver ? <Saver /> : null}
          <Toaster />
        </QueryClientProvider>
      );
    }
    const { rerender } = render(<Page showSaver />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Profile saved")).toBeInTheDocument();
    rerender(<Page showSaver={false} />);
    expect(screen.getByText("Profile saved")).toBeInTheDocument();
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
    expect(await screen.findByText("Try again.")).toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("idle");
  });

  it("builds the toast and the lists to refresh from what the action returned, and shows no toast when the builder gives none", async () => {
    const action = vi.fn().mockResolvedValue({ id: "league-1", quiet: false });
    const invalidateQueries = vi.fn().mockResolvedValue([QueryKeys.leagues.list]);
    const { invalidateSpy } = renderWorkflow({
      action,
      invalidateQueries,
      successToast: (data: { id: string }, variables) => ({ title: `Saved ${data.id} from ${String(variables)}` }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Saved league-1 from payload")).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({ id: "league-1", quiet: false }, "payload");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: QueryKeys.leagues.list });
  });

  it("shows no success toast when the toast builder returns nothing, and stays open when closeOnSuccess is off", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    renderWorkflow({
      action: () => Promise.resolve("ok"),
      closeOnSuccess: false,
      onClose,
      onSuccess,
      successToast: () => null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("ok", "payload"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("app-toast")).not.toBeInTheDocument();
  });

  it("treats a thrown non-Error as a failure, building the error toast from it, or showing none when the builder gives none", async () => {
    const onError = vi.fn();
    renderWorkflow({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test: an action that rejects with a bare string.
      action: () => Promise.reject("timed out"),
      errorToast: (error, variables) => ({ title: `${error.message} (${String(variables)})`, tone: "danger" }),
      onError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("timed out (payload)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Action failed");
    expect(onError).toHaveBeenCalledWith(new Error("timed out"), "payload");
  });

  it("shows no error toast when the error toast builder returns nothing, but still reports the failure", async () => {
    renderWorkflow({
      action: () => Promise.reject(new Error("Nope")),
      errorToast: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Action failed");
    expect(screen.queryByTestId("app-toast")).not.toBeInTheDocument();
  });
});
