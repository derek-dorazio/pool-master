import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftStatus } from '@poolmaster/shared/domain';
import { CommissionerControls } from './commissioner-controls';

const {
  pauseMutate,
  resumeMutate,
  extendMutate,
  undoMutate,
  skipMutate,
} = vi.hoisted(() => ({
  pauseMutate: vi.fn(),
  resumeMutate: vi.fn(),
  extendMutate: vi.fn(),
  undoMutate: vi.fn(),
  skipMutate: vi.fn(),
}));

vi.mock('./hooks/use-draft', () => ({
  usePauseDraft: () => ({ mutate: pauseMutate, isPending: false }),
  useResumeDraft: () => ({ mutate: resumeMutate, isPending: false }),
  useExtendDraft: () => ({ mutate: extendMutate, isPending: false }),
  useUndoDraft: () => ({ mutate: undoMutate, isPending: false }),
  useSkipDraft: () => ({ mutate: skipMutate, isPending: false }),
}));

describe('DraftRoom CommissionerControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders live commissioner actions for commissioner users', () => {
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.LIVE}
        isCommissioner
      />,
    );

    expect(screen.getByText('Commissioner Controls')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Resume/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add 60s/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Undo/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Skip/i })).toBeEnabled();
  });

  it('switches to resume action when the draft is paused', () => {
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.PAUSED}
        isCommissioner
      />,
    );

    expect(screen.getByRole('button', { name: /Pause/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Resume/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Add 60s/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Undo/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Skip/i })).toBeDisabled();
  });

  it('calls the pause mutation', async () => {
    const user = userEvent.setup();
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.LIVE}
        isCommissioner
      />,
    );

    await user.click(screen.getByRole('button', { name: /Pause/i }));
    expect(pauseMutate).toHaveBeenCalled();
  });

  it('calls the resume mutation', async () => {
    const user = userEvent.setup();
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.PAUSED}
        isCommissioner
      />,
    );

    await user.click(screen.getByRole('button', { name: /Resume/i }));
    expect(resumeMutate).toHaveBeenCalled();
  });

  it('calls the extend mutation with sixty seconds', async () => {
    const user = userEvent.setup();
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.LIVE}
        isCommissioner
      />,
    );

    await user.click(screen.getByRole('button', { name: /Add 60s/i }));
    expect(extendMutate).toHaveBeenCalledWith(60);
  });

  it('calls the undo mutation', async () => {
    const user = userEvent.setup();
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.LIVE}
        isCommissioner
      />,
    );

    await user.click(screen.getByRole('button', { name: /Undo/i }));
    expect(undoMutate).toHaveBeenCalled();
  });

  it('calls the skip mutation', async () => {
    const user = userEvent.setup();
    render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.LIVE}
        isCommissioner
      />,
    );

    await user.click(screen.getByRole('button', { name: /Skip/i }));
    expect(skipMutate).toHaveBeenCalled();
  });

  it('hides the panel for non-commissioners', () => {
    const { container } = render(
      <CommissionerControls
        draftId="draft-1"
        draftStatus={DraftStatus.LIVE}
        isCommissioner={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
