import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, total, limit, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / limit);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  if (total <= limit) return null;

  return (
    <div className="flex items-center justify-between py-3">
      <p className="text-sm text-gray-500">
        Показано {from}–{to} из {total}
      </p>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} className="btn-secondary btn-sm">
          <ChevronLeft className="w-4 h-4" />
          Назад
        </button>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className="btn-secondary btn-sm">
          Вперёд
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
