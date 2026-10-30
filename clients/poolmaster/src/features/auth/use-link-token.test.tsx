import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useLinkToken } from './use-link-token';

function TokenProbe() {
  const token = useLinkToken();
  const location = useLocation();
  return (
    <>
      <output aria-label="Token">{token ?? 'none'}</output>
      <output aria-label="Current address">{`${location.pathname}${location.search}${location.hash}`}</output>
    </>
  );
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TokenProbe />
    </MemoryRouter>,
  );
}

describe('useLinkToken', () => {
  it('reads the token from the link and clears it from the address, keeping the path and query', async () => {
    renderAt('/reset-password?from=email#token=link-token-123');

    expect(screen.getByLabelText('Token')).toHaveTextContent('link-token-123');
    expect(await screen.findByText('/reset-password?from=email')).toBeInTheDocument();
    expect(screen.getByLabelText('Token')).toHaveTextContent('link-token-123');
  });

  it('has no token when the link carries none, or only a blank one', () => {
    renderAt('/undo-email-change#token=%20');

    expect(screen.getByLabelText('Token')).toHaveTextContent('none');
  });

  it('leaves an address without a fragment as it is', () => {
    renderAt('/undo-email-change');

    expect(screen.getByLabelText('Token')).toHaveTextContent('none');
    expect(screen.getByLabelText('Current address')).toHaveTextContent('/undo-email-change');
  });
});
