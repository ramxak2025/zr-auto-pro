import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import type { ReportColumn, ReportRow, ReportSection } from '../../types';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { Card, CardHeader } from '../../ui/Card';
import { Money } from '../../ui/Money';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { cellNumber, formatReportValue, isNumericType, pluralRows } from './reportFormat';
import { headerWidth, minWidthClass, numericHeaderClass } from './tableWidths';

interface ReportTableProps {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  /** Текст пустого состояния (из секции или «За период нет данных»). */
  emptyText?: string;
  caption?: string;
  timeZone?: string | null;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  onRetry?: () => void;
  dense?: boolean;
  /** Таблица уже внутри Card — без собственной рамки. */
  bare?: boolean;
  /** Первая колонка закреплена при горизонтальной прокрутке (широкие таблицы, телефон). */
  stickyFirst?: boolean;
  className?: string;
}

const toneRowCls: Record<string, string> = {
  negative: '[&>td]:bg-bad-soft',
  warning: '[&>td]:bg-warn-soft',
  positive: '[&>td]:bg-ok-soft',
};

function rowKey(row: ReportRow, index: number): string {
  const id = row._id;
  return typeof id === 'string' && id ? `${id}-${index}` : String(index);
}

/**
 * Универсальная таблица ReportResult поверх DataTable: числа справа с
 * табличными цифрами, `signed` — красный/зелёный через Money, `_tone` —
 * подсветка строки, `_href` — ссылка в главной колонке, итого в футере,
 * сортировка по заголовку. Секции и основная таблица рендерятся одним кодом.
 */
export default function ReportTable({
  columns,
  rows,
  totals,
  emptyText = 'За период нет данных',
  caption,
  timeZone,
  isLoading = false,
  isError = false,
  isFetching = false,
  onRetry,
  dense = false,
  bare = false,
  stickyFirst = true,
  className,
}: ReportTableProps) {
  const allLinked = rows.length > 0 && rows.every((r) => typeof r._href === 'string' && r._href);

  const tableColumns = useMemo<DataTableColumn<ReportRow>[]>(
    () =>
      columns.map((col, index) => {
        const numeric = isNumericType(col.type);
        const first = index === 0;
        const render = (row: ReportRow): ReactNode => {
          const raw = row[col.key];
          if (col.type === 'money') {
            const n = cellNumber(raw);
            if (n === null) return <span className="text-ink-3">—</span>;
            return <Money value={n} signed={col.signed} colorize={col.signed} className={cn(first && 'font-medium')} />;
          }
          const text = formatReportValue(raw, col.type, { timeZone, signed: col.signed });
          if (text === '—') return <span className="text-ink-3">—</span>;
          // Ссылка в первой колонке, когда строка ведёт на карточку, а вся
          // таблица кликабельной быть не может (ссылки есть не у всех строк).
          if (first && !allLinked && typeof row._href === 'string' && row._href) {
            return (
              <Link
                to={row._href}
                className={cn('rounded-sm font-medium text-ink hover:text-accent-text', focusRing)}
                onClick={(e) => e.stopPropagation()}
              >
                {text}
              </Link>
            );
          }
          return first ? <span className="font-medium text-ink">{text}</span> : text;
        };
        const footer =
          totals && !isLoading
            ? (() => {
                const value = totals[col.key];
                if (first) return value === null || value === undefined || value === '' ? 'Итого' : String(value);
                if (value === null || value === undefined || value === '') return '';
                if (col.type === 'money') {
                  const n = cellNumber(value);
                  return n === null ? String(value) : <Money value={n} signed={col.signed} colorize={col.signed} />;
                }
                return formatReportValue(value, col.type, { timeZone, signed: col.signed });
              })()
            : undefined;
        // Числовые колонки: предпочтительная ширина под заголовок в одну строку,
        // при нехватке места заголовок переносится, минимум — по длинному слову;
        // только когда минимумы не помещаются, таблица уходит в горизонтальный
        // скролл контейнера (первая колонка закреплена). См. tableWidths.ts.
        const width = numeric ? headerWidth(col.title) : first ? 176 : undefined;
        return {
          key: col.key,
          width,
          header: col.hint ? (
            <abbr title={col.hint} className="cursor-help no-underline">
              {col.title}
            </abbr>
          ) : (
            col.title
          ),
          numeric,
          align: col.align,
          sortable: true,
          sortValue: (row) => {
            const v = row[col.key];
            return numeric ? cellNumber(v) : v;
          },
          primary: first,
          render,
          footer,
          className: cn(
            first && stickyFirst && 'sticky left-0 z-[1] bg-surface',
            first && 'max-w-[14rem] truncate sm:max-w-[20rem]',
          ),
          headerClassName: cn(
            first && stickyFirst && 'left-0 z-20',
            numeric ? numericHeaderClass(col.title) : width !== undefined && minWidthClass(width),
          ),
        };
      }),
    [columns, totals, timeZone, isLoading, allLinked, stickyFirst],
  );

  const empty = !isLoading && !isError && rows.length === 0;

  if (empty) {
    return (
      <p className={cn('px-5 py-8 text-center text-sm text-ink-3', !bare && 'card', className)} role="status">
        {emptyText}
      </p>
    );
  }

  return (
    <DataTable<ReportRow>
      columns={tableColumns}
      rows={rows}
      rowKey={rowKey}
      rowHref={allLinked ? (row) => String(row._href) : undefined}
      rowLabel={allLinked ? (row) => String(row[columns[0]?.key] ?? '') : undefined}
      isLoading={isLoading}
      isError={isError}
      isFetching={isFetching}
      onRetry={onRetry}
      errorTitle="Не удалось загрузить таблицу"
      dense={dense}
      bare={bare}
      caption={caption}
      rowClassName={(row) => (typeof row._tone === 'string' ? toneRowCls[row._tone] : undefined)}
      className={className}
    />
  );
}

interface ReportSectionCardProps {
  section: ReportSection;
  timeZone?: string | null;
  icon?: LucideIcon;
}

/** Дополнительная таблица отчёта («Залежались», «Топ-5 услуг») в карточке. */
export function ReportSectionCard({ section, timeZone, icon }: ReportSectionCardProps) {
  return (
    <Card padding="none" className="overflow-hidden">
      <CardHeader
        as="h3"
        dense
        icon={icon}
        iconTone="neutral"
        title={section.title}
        subtitle={section.description ?? (section.rows.length > 0 ? pluralRows(section.rows.length) : undefined)}
        divider={section.rows.length === 0}
      />
      <ReportTable
        columns={section.columns}
        rows={section.rows}
        totals={section.totals}
        emptyText={section.emptyText ?? 'За период нет данных'}
        timeZone={timeZone}
        caption={section.title}
        dense
        bare
      />
    </Card>
  );
}
