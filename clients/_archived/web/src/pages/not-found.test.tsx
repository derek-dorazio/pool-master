import { render, screen } from '@testing-library/react';
import { NotFoundPage } from './not-found';

describe('NotFoundPage', () => {
  it('renders "Page Not Found" heading', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { name: 'Page Not Found' })).toBeInTheDocument();
  });

  it('renders descriptive message', () => {
    render(<NotFoundPage />);
    expect(
      screen.getByText(
        'The page you are looking for does not exist. Check the URL or head back to the dashboard.',
      ),
    ).toBeInTheDocument();
  });
});
