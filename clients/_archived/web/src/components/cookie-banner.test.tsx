import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CookieBanner } from './cookie-banner';

describe('CookieBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders when no consent stored', () => {
    render(<CookieBanner />);
    expect(screen.getByTestId('cookie-banner')).toBeInTheDocument();
    expect(screen.getByTestId('cookie-accept-all')).toBeInTheDocument();
    expect(screen.getByTestId('cookie-necessary')).toBeInTheDocument();
  });

  it('does not render when consent already stored', () => {
    localStorage.setItem('poolmaster_cookie_consent', 'all');
    const { container } = render(<CookieBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('hides after clicking Accept All', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);
    await user.click(screen.getByTestId('cookie-accept-all'));
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
    expect(localStorage.getItem('poolmaster_cookie_consent')).toBe('all');
  });

  it('hides after clicking Necessary Only', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);
    await user.click(screen.getByTestId('cookie-necessary'));
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
    expect(localStorage.getItem('poolmaster_cookie_consent')).toBe('necessary');
  });
});
