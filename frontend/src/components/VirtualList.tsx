import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Generic virtual list for rendering large collections efficiently.
 * Used in GlobalInventoryForm and GlobalWriteoffForm where there can be
 * hundreds of product items in a scrollable container.
 */

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Estimated item height in px (default: 72) */
  estimateSize?: number;
  /** CSS class for the scroll container */
  className?: string;
  /** Key extractor */
  getKey?: (item: T, index: number) => string | number;
}

export default function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 72,
  className = '',
  getKey,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // Skip virtualization for small lists
  if (items.length < 30) {
    return (
      <div className={className}>
        {items.map((item, i) => (
          <div key={getKey ? getKey(item, i) : i}>
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ overflow: 'auto' }}
    >
      <div
        style={{
          height: `${totalHeight}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          return (
            <div
              key={getKey ? getKey(item, virtualItem.index) : virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
