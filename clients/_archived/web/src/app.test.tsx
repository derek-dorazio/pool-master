import { render } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('mounts without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });
});
