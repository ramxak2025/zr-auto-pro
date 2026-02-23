import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Product } from '../types';

/**
 * Responsive virtual grid for product cards.
 *
 * Instead of rendering all 1000+ products at once,
 * only renders visible rows + a small overscan buffer.
 * This reduces DOM nodes from ~1000 to ~30 and dramatically
 * improves scroll FPS on mobile.
 */

interface VirtualProductGridProps {
  products: Product[];
  renderItem: (product: Product, index: number) => React.ReactNode;
  /** Estimated row height in px (default: 260) */
  estimateRowHeight?: number;
}

function useColumns(): number {
  // Match Tailwind breakpoints: grid-cols-2 / md:grid-cols-3 / lg:grid-cols-4
  if (typeof window === 'undefined') return 2;
  const w = window.innerWidth;
  if (w >= 1024) return 4;
  if (w >= 768) return 3;
  return 2;
}

export default function VirtualProductGrid({
  products,
  renderItem,
  estimateRowHeight = 260,
}: VirtualProductGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = useColumns();

  const rows = useMemo(() => {
    const result: Product[][] = [];
    for (let i = 0; i < products.length; i += columns) {
      result.push(products.slice(i, i + columns));
    }
    return result;
  }, [products, columns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => {
      // Scroll parent is the <main> element
      return parentRef.current?.closest('main') ?? null;
    },
    estimateSize: () => estimateRowHeight,
    overscan: 3,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // If < 30 items, don't virtualize (overhead not worth it)
  if (products.length < 30) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product, i) => renderItem(product, i))}
      </div>
    );
  }

  return (
    <div ref={parentRef}>
      <div
        style={{
          height: `${totalHeight}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 pb-3">
                {row.map((product, colIndex) => (
                  <div key={product.id}>
                    {renderItem(product, virtualRow.index * columns + colIndex)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
