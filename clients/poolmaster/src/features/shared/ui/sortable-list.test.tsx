import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SortableList } from './sortable-list';

// plans/124 §6.4 / react-ui-rules §8 — keyboard-accessible sortable list.

type Item = { id: string; label: string };

function Harness() {
  const [items, setItems] = useState<Item[]>([
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ]);
  return (
    <>
      <p data-testid="order">{items.map((i) => i.id).join(',')}</p>
      <SortableList
        aria-label="Test list"
        items={items}
        onReorder={(orderedIds) =>
          setItems((current) =>
            orderedIds.map((id) => current.find((item) => item.id === id)!),
          )
        }
        renderItem={(item, { dragHandleProps }) => (
          <div>
            <button data-testid={`handle-${item.id}`} type="button" {...dragHandleProps}>
              drag {item.label}
            </button>
          </div>
        )}
      />
    </>
  );
}

describe('pool-master-dyb SortableList', () => {
  it('pool-master-dyb renders its items in order with an aria-labelled list', () => {
    render(<Harness />);
    const list = screen.getByRole('list', { name: 'Test list' });
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId('order')).toHaveTextContent('a,b,c');
  });

  it('pool-master-dyb wires the @dnd-kit keyboard/pointer drag affordance onto each handle', () => {
    // The actual drag move needs layout APIs jsdom does not implement; deterministic
    // reorder coverage lives on the consumer's up/down + "Move to tier" controls
    // (golf-tier-board / golf-tier-board-utils tests). Here we assert the handle
    // exposes the sortable a11y contract so the keyboard path exists.
    render(<Harness />);
    const handle = screen.getByTestId('handle-a');
    expect(handle).toHaveAttribute('role', 'button');
    expect(handle).toHaveAttribute('aria-roledescription', 'sortable');
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-describedby');
  });
});
