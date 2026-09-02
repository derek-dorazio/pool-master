import { memo, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "./class-names";

/** Keeps a keyboard drag on the vertical axis without pulling in @dnd-kit/modifiers. */
const RESTRICT_TO_VERTICAL: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

type SortableApi = ReturnType<typeof useSortable>;

/**
 * Spread onto the focusable drag handle. Carries @dnd-kit's `attributes`
 * (role / tabindex / aria-*), its pointer+keyboard `listeners`, and
 * `ref={setActivatorNodeRef}` so post-drop focus returns to the handle rather
 * than the non-focusable `<li>`. The listener keys are left untyped (@dnd-kit's
 * `SyntheticListenerMap` index signature conflicts with `attributes.role`).
 */
export type SortableListDragHandleProps = SortableApi["attributes"] &
  Record<string, unknown> & {
    ref: SortableApi["setActivatorNodeRef"];
  };

export type SortableListRenderArgs = {
  dragHandleProps: SortableListDragHandleProps;
  isDragging: boolean;
  index: number;
};

export type SortableListProps<T extends { id: string }> = {
  items: T[];
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T, args: SortableListRenderArgs) => ReactNode;
  "aria-label": string;
  className?: string;
  itemClassName?: string;
};

const SortableRow = memo(function SortableRow<T extends { id: string }>({
  index,
  item,
  itemClassName,
  renderItem,
}: {
  index: number;
  item: T;
  itemClassName?: string;
  renderItem: SortableListProps<T>["renderItem"];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <li
      className={cn(itemClassName, isDragging && "opacity-70")}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {renderItem(item, {
        dragHandleProps: {
          ...attributes,
          ...(listeners ?? {}),
          ref: setActivatorNodeRef,
        },
        isDragging,
        index,
      })}
    </li>
  );
}) as <T extends { id: string }>(props: {
  index: number;
  item: T;
  itemClassName?: string;
  renderItem: SortableListProps<T>["renderItem"];
}) => ReactNode;

/**
 * plans/124 §6.4 — a keyboard-accessible single-column sortable list built on
 * `@dnd-kit`. `@dnd-kit` is the only mainstream DnD library with a first-class
 * keyboard sensor, which `rules/react-ui-rules.md` §8 requires; native HTML5
 * drag events are not keyboard accessible. Consumers still provide an explicit
 * non-drag reorder affordance (up/down buttons) — drag is an accelerator.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  "aria-label": ariaLabel,
  className,
  itemClassName,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) {
      return;
    }
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={[RESTRICT_TO_VERTICAL]}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul aria-label={ariaLabel} className={cn("space-y-2", className)}>
          {items.map((item, index) => (
            <SortableRow
              index={index}
              item={item}
              itemClassName={itemClassName}
              key={item.id}
              renderItem={renderItem}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
