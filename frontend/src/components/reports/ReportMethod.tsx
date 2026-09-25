import { Info } from 'lucide-react';
import type { ReportResult } from '../../types';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { formatDateTime } from '../../../../shared/utils/formatters';

interface ReportMethodProps {
  /** Что именно считается — `method` из каталога. */
  method: string;
  /** Оговорки сервера словами владельца. */
  notes?: string[];
}

/** Блок «Методика»: одно объяснение из каталога + оговорки конкретного расчёта. */
export function ReportMethod({ method, notes }: ReportMethodProps) {
  return (
    <Card padding="none">
      <CardHeader as="h3" dense icon={Info} iconTone="info" title="Методика" divider={false} />
      <div className="px-4 pb-4 text-sm leading-relaxed text-ink-2">
        <p>{method}</p>
        {notes && notes.length > 0 && (
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

interface ReportCaptionProps {
  result: ReportResult;
  timeZone?: string | null;
}

/** Подпись под отчётом: когда сформирован, в каком филиале, усечена ли таблица. */
export function ReportCaption({ result, timeZone }: ReportCaptionProps) {
  const scope =
    result.meta?.scope === 'all' || !result.meta?.pointName ? 'вся компания' : `филиал «${result.meta.pointName}»`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-3">
      <span>
        Сформирован {formatDateTime(result.generatedAt, timeZone)} · {scope}
      </span>
      {result.meta?.truncated && (
        <Badge tone="warn">Показаны первые {result.meta.rowLimit ?? result.rows.length} строк</Badge>
      )}
    </div>
  );
}
