/**
 * Небольшие диалоги страницы склада: удаление папки, перемещение в папку,
 * массовое удаление с подтверждением словом, предпросмотр импорта.
 */
import { useState } from 'react';
import { AlertTriangle, FolderOpen, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { DEFAULT_UNIT, unitLabel } from '../../utils/units';
import { countLabel } from './format';

// ─── Удаление папки ──────────────────────────────────────────────────────────

export interface DeleteFolderTarget {
  id: string;
  name: string;
  path: string;
}

export function DeleteFolderDialog({
  target,
  onClose,
  onDeleteOnly,
  onDeleteWithContents,
}: {
  target: DeleteFolderTarget | null;
  onClose: () => void;
  /** Удалить только папку (товары переедут в корень). Только для папок с записью в warehouse_categories. */
  onDeleteOnly: (target: DeleteFolderTarget) => void;
  /** Удалить папку вместе с товарами (в корзину). */
  onDeleteWithContents: (target: DeleteFolderTarget) => void;
}) {
  const optionCls = cn(
    'flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-card',
    'transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
    focusRing,
  );
  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Удалить папку"
      description={target ? `Что сделать с папкой «${target.name}»?` : undefined}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      }
    >
      {target && (
        <div className="space-y-3">
          {/* Option 1 — keep products, drop the folder. Backend supports this
              only for folders that have a real warehouse_categories row;
              "path-only" folders (inferred from product.category) need the
              path-soft-delete fallback below. */}
          {target.id ? (
            <button type="button" onClick={() => onDeleteOnly(target)} className={optionCls}>
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Удалить только папку</span>
                <span className="mt-0.5 block text-xs text-ink-3">Товары внутри переедут в корень склада</span>
              </span>
            </button>
          ) : null}
          <button type="button" onClick={() => onDeleteWithContents(target)} className={cn(optionCls, 'border-bad/30')}>
            <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-bad-soft text-bad">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">Удалить вместе с товарами</span>
              <span className="mt-0.5 block text-xs text-ink-3">
                Товары попадут в корзину, можно будет восстановить
              </span>
            </span>
          </button>
        </div>
      )}
    </Modal>
  );
}

// ─── Переместить в папку ─────────────────────────────────────────────────────

export function MoveToFolderModal({
  isOpen,
  onClose,
  currentPathStr,
  activePath,
  allCategoryPaths,
  onMove,
  pending,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentPathStr: string;
  activePath: string[];
  allCategoryPaths: string[];
  onMove: (category: string) => void;
  pending: boolean;
}) {
  const [newFolderName, setNewFolderName] = useState('');
  const rowCls = cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50',
    focusRing,
  );
  const createAndMove = () => {
    if (!newFolderName.trim()) return;
    const target = activePath.length > 0 ? `${activePath.join('/')}/${newFolderName.trim()}` : newFolderName.trim();
    onMove(target);
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Переместить в папку" description="Выбранные товары сменят папку">
      <div className="max-h-[60vh] space-y-1 overflow-y-auto">
        {currentPathStr !== '' && (
          <button type="button" onClick={() => onMove('')} disabled={pending} className={rowCls}>
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
            <span className="font-medium text-ink-2">Без папки (корень склада)</span>
          </button>
        )}
        {allCategoryPaths
          .filter((path) => path !== currentPathStr)
          .map((path) => {
            const depth = path.split('/').length - 1;
            return (
              <button
                key={path}
                type="button"
                onClick={() => onMove(path)}
                disabled={pending}
                className={rowCls}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                <FolderOpen className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate font-medium text-ink">{path}</span>
              </button>
            );
          })}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <Field
          label="Новая папка"
          htmlFor="move-new-folder"
          hint={activePath.length > 0 ? `Внутри «${activePath.join('/')}»` : undefined}
        >
          <div className="flex gap-2">
            <Input
              id="move-new-folder"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createAndMove();
                }
              }}
              placeholder="Название папки"
              autoComplete="off"
            />
            <Button variant="secondary" onClick={createAndMove} disabled={!newFolderName.trim() || pending}>
              Переместить
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ─── Массовое удаление (в корзину) ───────────────────────────────────────────

const CONFIRM_WORD = 'согласен';

export function BulkDeleteModal({
  mode,
  onClose,
  warehouseName,
  productCount,
  folderCount,
  onConfirm,
  pending,
}: {
  /** 'selection' — выбранные товары и папки; 'all' — весь склад; null — закрыто. */
  mode: 'selection' | 'all' | null;
  onClose: () => void;
  warehouseName?: string;
  productCount: number;
  folderCount: number;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Modal isOpen={!!mode} onClose={onClose} title="Удаление в корзину" size="sm">
      {mode && (
        <BulkDeleteBody
          key={mode}
          isAll={mode === 'all'}
          warehouseName={warehouseName}
          productCount={productCount}
          folderCount={folderCount}
          onClose={onClose}
          onConfirm={onConfirm}
          pending={pending}
        />
      )}
    </Modal>
  );
}

function BulkDeleteBody({
  isAll,
  warehouseName,
  productCount,
  folderCount,
  onClose,
  onConfirm,
  pending,
}: {
  isAll: boolean;
  warehouseName?: string;
  productCount: number;
  folderCount: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const [text, setText] = useState('');
  const canConfirm = text.trim().toLowerCase() === CONFIRM_WORD && !pending;
  return (
    <div className="space-y-4">
      <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-bad/20 bg-bad-soft p-3.5">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-bad" aria-hidden="true" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-bad-text">
            {isAll
              ? `Удалить весь товар${warehouseName ? ` со склада «${warehouseName}»` : ''}?`
              : 'Удалить выбранное?'}
          </p>
          <p className="mt-1 text-bad-text">
            В корзину переедет{' '}
            <span className="font-semibold">{countLabel(productCount, ['товар', 'товара', 'товаров'])}</span>
            {folderCount > 0 && (
              <>
                {' '}
                и <span className="font-semibold">{countLabel(folderCount, ['папка', 'папки', 'папок'])}</span>
              </>
            )}
            .
          </p>
        </div>
      </div>

      <Field
        label={
          <>
            Для подтверждения введите слово <span className="font-semibold text-ink">{CONFIRM_WORD}</span>
          </>
        }
        htmlFor="bulk-delete-confirm"
        hint="Всё удаляется в корзину — восстановить можно"
      >
        <Input
          id="bulk-delete-confirm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canConfirm) onConfirm();
          }}
          placeholder={CONFIRM_WORD}
          autoComplete="off"
        />
      </Field>

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Отмена
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={!canConfirm} loading={pending}>
          В корзину
        </Button>
      </div>
    </div>
  );
}

// ─── Предпросмотр импорта ────────────────────────────────────────────────────

export interface ImportRow {
  name: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit: string;
}

export function ImportPreviewModal({
  rows,
  onClose,
  onConfirm,
  importing,
}: {
  rows: ImportRow[] | null;
  onClose: () => void;
  onConfirm: () => void;
  importing: boolean;
}) {
  const shown = (rows ?? []).slice(0, 50);
  return (
    <Modal
      isOpen={!!rows}
      onClose={onClose}
      title="Импорт товаров"
      description="Поддерживаются Excel (.xlsx, .xls) и CSV. Колонки определяются по заголовку; папки — через «/»"
      size="4xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            Отмена
          </Button>
          <Button onClick={onConfirm} loading={importing}>
            Импортировать
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          Найдено{' '}
          <span className="font-semibold tabular-nums text-ink">
            {countLabel(rows?.length ?? 0, ['товар', 'товара', 'товаров'])}
          </span>
          . Товары с совпадающими названиями будут обновлены.
        </p>
        <div className="table-container max-h-80 overflow-auto">
          <table className="table table-dense min-w-[640px]">
            <caption className="sr-only">Строки для импорта</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 z-10">
                  Название
                </th>
                <th scope="col" className="sticky top-0 z-10 w-40">
                  Папка
                </th>
                <th scope="col" className="sticky top-0 z-10 w-16">
                  Ед.
                </th>
                <th scope="col" className="num sticky top-0 z-10 w-24">
                  Продажа
                </th>
                <th scope="col" className="num sticky top-0 z-10 w-24">
                  Закупка
                </th>
                <th scope="col" className="num sticky top-0 z-10 w-24">
                  Остаток
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item, idx) => (
                <tr key={idx}>
                  <td className="font-medium text-ink">{item.name}</td>
                  <td className="text-ink-3">{item.category || '—'}</td>
                  <td className="text-ink-3">{unitLabel(item.unit) !== DEFAULT_UNIT ? unitLabel(item.unit) : '—'}</td>
                  <td className="num">{item.sellPrice || 0}</td>
                  <td className="num">{item.costPrice || 0}</td>
                  <td className="num">{item.stock || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(rows?.length ?? 0) > 50 && (
          <p className="text-center text-xs text-ink-3">
            … и ещё {countLabel((rows?.length ?? 0) - 50, ['товар', 'товара', 'товаров'])}
          </p>
        )}
      </div>
    </Modal>
  );
}
