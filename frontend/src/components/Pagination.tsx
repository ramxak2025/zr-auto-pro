import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}

/**
 * Пагинация списка: «Показано 21–40 из 512» + Назад/Вперёд. Скрывается, когда
 * всё помещается на одну страницу. Номер страницы держите в URL (?page=),
 * чтобы F5 и «Назад» браузера возвращали на то же место.
 */
export default function Pagination({ page, total, limit, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / limit);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  if (total <= limit) return null;

  return (
    <nav aria-label="Пагинация" className="flex items-center justify-between gap-3 py-3">
      <p className="text-sm tabular-nums text-ink-3">
        Показано {from}–{to} из {total}
      </p>
      <div className="flex items-center gap-2">
        <span className="hidden text-sm tabular-nums text-ink-3 sm:inline" aria-current="page">
          Стр. {page} из {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={ChevronLeft}
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Предыдущая страница"
        >
          Назад
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconRight={ChevronRight}
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Следующая страница"
        >
          Вперёд
        </Button>
      </div>
    </nav>
  );
}
