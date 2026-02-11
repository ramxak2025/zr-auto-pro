import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}

export default function Pagination({
  page,
  total,
  limit,
  onChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  // Build visible page numbers with ellipsis
  function getPageNumbers(): (number | 'ellipsis')[] {
    const pages: (number | 'ellipsis')[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    // Always show first page
    pages.push(1);

    if (page > 3) {
      pages.push('ellipsis');
    }

    // Window around current page
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (page < totalPages - 2) {
      pages.push('ellipsis');
    }

    // Always show last page
    pages.push(totalPages);

    return pages;
  }

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between py-3">
      {/* Info text */}
      <p className="text-sm text-gray-500">
        Showing{' '}
        <span className="font-medium text-gray-700">{from}</span>
        {' - '}
        <span className="font-medium text-gray-700">{to}</span>
        {' of '}
        <span className="font-medium text-gray-700">{total}</span>
      </p>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {/* Previous */}
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Page numbers */}
        {getPageNumbers().map((p, idx) =>
          p === 'ellipsis' ? (
            <span
              key={`ellipsis-${idx}`}
              className="flex h-9 w-9 items-center justify-center text-sm text-gray-400"
            >
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {p}
            </button>
          ),
        )}

        {/* Next */}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
