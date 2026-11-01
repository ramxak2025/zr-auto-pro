import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { supplierInvoicesApi, productsApi, warehousesApi, purchaseOrdersApi } from '../../api/services';
import { createSessionBoundClient } from '../../api/axios';
import { readStoredToken } from '../../utils/sessionToken';
import { newUuid } from '../../utils/uuid';
import { useTenantTimezone } from '../../hooks/useTenantTimezone';
import { unitLabel } from '../../utils/units';
import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import type { ConfirmSupplierInvoice, SupplierInvoiceDocument } from '../../../../shared/api/supplierInvoices';
import {
  manualInvoicePayload,
  type ManualInvoiceDraft,
  invoiceReviewWarnings,
  invoiceReceiptPayload,
  invoiceRowDrafts,
  invoiceUnitMismatch,
  invoiceWarningLabel,
  isReceivableProduct,
  type InvoiceRowDrafts,
} from '../../../../shared/utils/supplierInvoiceReview';
import { formatDayKey, formatMoney } from '../../../../shared/utils/formatters';
import type { Product, PurchaseOrder } from '../../types';
import ProductPickerDrawer from '../checks/ProductPickerDrawer';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import { Button, Field, Input, Select } from '../../ui';

function PrivatePage({ url, index, full = false }: { url: string; index: number; full?: boolean }) {
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true,
      objectUrl = '';
    const controller = new AbortController();
    const token = readStoredToken();
    setImage('');
    setFailed(false);
    if (!/^\/api\/supplier-invoices\/[a-f0-9-]+\/pages\/[a-f0-9-]+$/i.test(url)) {
      setFailed(true);
      return;
    }
    void createSessionBoundClient(token)
      .get<Blob>(url.slice(4), { responseType: 'blob', signal: controller.signal })
      .then((response) => {
        if (!current || token !== readStoredToken()) return;
        objectUrl = URL.createObjectURL(response.data);
        setImage(objectUrl);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return (
    <div
      className={
        full
          ? 'flex min-h-60 w-full items-center justify-center rounded-lg bg-surface-2'
          : 'flex h-32 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2'
      }
    >
      {image ? (
        <a href={image} target="_blank" rel="noreferrer" aria-label={`Открыть страницу ${index + 1}`}>
          <img
            src={image}
            alt={`Страница накладной ${index + 1}`}
            className={full ? 'max-h-[75vh] w-full object-contain' : 'h-32 w-24 object-contain'}
          />
        </a>
      ) : (
        <span className="px-2 text-center text-xs text-ink-3">
          {failed ? 'Не удалось открыть страницу' : 'Загрузка…'}
        </span>
      )}
    </div>
  );
}

export default function SupplierInvoiceDialog({
  isOpen,
  supplierId,
  supplierName,
  onClose,
  onReceived,
}: {
  isOpen: boolean;
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  onReceived: (deliveryId: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const renderToken = readStoredToken();
  const timezone = useTenantTimezone();
  const today = formatDayKey(new Date(), timezone);
  const queryClient = useQueryClient();
  const key = `autexa.invoice-review.v1:${JSON.stringify([user?.tenantId, user?.id, user?.currentPointId, supplierId])}`;
  const [document, setDocument] = useState<SupplierInvoiceDocument | null>(null);
  const [rows, setRows] = useState<InvoiceRowDrafts>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [date, setDate] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pickerLine, setPickerLine] = useState<string | null>(null);
  const [manualPicking, setManualPicking] = useState(false),
    [manual, setManual] = useState<ManualInvoiceDraft | null>(null);
  const [sourcePage, setSourcePage] = useState<{ url: string; index: number } | null>(null);
  const [pending, setPending] = useState<ConfirmSupplierInvoice | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pageDelete, setPageDelete] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => newUuid());
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const sequence = useRef({ value: 0 }),
    busyRef = useRef(false),
    dateTouched = useRef(false),
    submitted = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const docRef = useRef(document);
  docRef.current = document;
  const {
    data: products = [],
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ['products', 'invoice-review', supplierId],
    queryFn: () => loadProductCatalog(productsApi.getAll),
    enabled: isOpen,
    staleTime: 0,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    enabled: isOpen,
  });
  const { data: orders = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', 'invoice-review', supplierId],
    queryFn: async () => (await purchaseOrdersApi.list({ supplierId, status: 'ordered' })).data.data,
    enabled: isOpen,
  });
  const catalog = products.filter((product) => isReceivableProduct(product, warehouses));
  const apply = useCallback((next: SupplierInvoiceDocument) => {
    setDocument(next);
    setManual((current) =>
      current?.pending && next.lines.some((line) => line.manualRequestId === current.requestId) ? null : current,
    );
    setRows((previous) => invoiceRowDrafts(next, previous));
    if (next.status === 'review' && !dateTouched.current) setDate(next.date?.slice(0, 10) ?? '');
  }, []);
  const run = useCallback(
    async (label: string, action: (isCurrent: () => boolean) => Promise<void>) => {
      if (busyRef.current || renderToken !== readStoredToken()) return;
      const attempt = ++sequence.current.value,
        token = readStoredToken();
      const isCurrent = () => attempt === sequence.current.value && token === readStoredToken();
      busyRef.current = true;
      setBusy(label);
      setError('');
      try {
        await action(isCurrent);
      } catch (cause) {
        if (isCurrent()) {
          const message = (cause as { response?: { data?: { message?: string } } }).response?.data?.message;
          setError(
            message ||
              (cause instanceof Error ? cause.message : 'Ответ пока не получен. Обновите статус или повторите запрос.'),
          );
        }
      } finally {
        if (attempt === sequence.current.value) {
          busyRef.current = false;
          setBusy('');
        }
      }
    },
    [renderToken],
  );
  useEffect(() => {
    if (!isOpen) {
      setPickerLine(null);
      setManualPicking(false);
      setSourcePage(null);
      setConfirmOpen(false);
      sequence.current.value++;
      busyRef.current = false;
      setBusy('');
      return;
    }
    setRestoredKey(null);
    dateTouched.current = false;
    submitted.current = false;
    setDate('');
    setReceivedAt('');
    setDocument(null);
    setManual(null);
    setRows({});
    setPending(null);
    setRequestId(newUuid());
    let saved: {
      documentId?: string;
      rows?: InvoiceRowDrafts;
      date?: string;
      receivedAt?: string;
      requestId?: string;
      pending?: ConfirmSupplierInvoice;
      manual?: ManualInvoiceDraft;
      submitted?: boolean;
    } = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      setError('Не удалось восстановить черновик накладной.');
    }
    if (saved.rows) setRows(saved.rows);
    if (saved.date) {
      dateTouched.current = true;
      setDate(saved.date);
    }
    if (saved.receivedAt) setReceivedAt(saved.receivedAt);
    if (saved.requestId) setRequestId(saved.requestId);
    if (saved.pending) setPending(saved.pending);
    if (saved.manual) setManual(saved.manual);
    submitted.current = !!saved.submitted;
    if (saved.documentId) {
      const documentId = saved.documentId;
      void run('Восстанавливаем накладную…', async (current) => {
        const result = await supplierInvoicesApi.get(documentId);
        if (current()) apply(result.data);
      });
    }
    setRestoredKey(key);
    const generation = sequence.current;
    return () => {
      generation.value++;
      busyRef.current = false;
    };
  }, [isOpen, key, run, apply]);
  useEffect(() => {
    if (!isOpen || restoredKey !== key || !document) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          documentId: document.id,
          rows,
          date,
          receivedAt,
          requestId,
          pending,
          manual,
          submitted: submitted.current,
        }),
      );
    } catch {
      setError('Черновик не сохранён на устройстве. Не закрывайте форму до завершения приёмки.');
    }
  }, [isOpen, restoredKey, key, document, rows, date, receivedAt, requestId, pending, manual]);
  useEffect(() => {
    if (!isOpen || document?.status !== 'processing') return;
    const timer = window.setInterval(() => {
      if (!busyRef.current)
        void run('Проверяем результат…', async (current) => {
          const result = await supplierInvoicesApi.get(document.id);
          if (current()) apply(result.data);
        });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isOpen, document?.id, document?.status, run, apply]);
  const upload = (files: File[]) =>
    void run('Загружаем страницы…', async (current) => {
      if (!files.length) return;
      if (
        files.length + (document?.pages.length ?? 0) > 8 ||
        files.some((file) => file.size > 10 * 1024 * 1024 || !file.type.startsWith('image/'))
      )
        throw new Error('Добавьте до 8 фотографий накладной, каждая до 10 МБ.');
      let next = docRef.current;
      if (!next) {
        next = (await supplierInvoicesApi.prepare(supplierId)).data;
        if (!current()) return;
        apply(next);
      }
      for (const file of files) {
        if (!current()) return;
        const body = new FormData();
        body.append('file', file);
        next = (await supplierInvoicesApi.uploadPage(next.id, body)).data;
        if (current()) apply(next);
      }
    });
  const map = (lineId: string, product: Product, remember: boolean) =>
    void run('Сопоставляем товар…', async (current) => {
      if (!document) return;
      if (!isReceivableProduct(product, warehouses)) throw new Error('Выберите обычный товар для приёмки.');
      const result = await supplierInvoicesApi.mapLine(document.id, lineId, {
        expectedVersion: document.version,
        productId: product.id,
        remember,
      });
      if (current()) {
        apply(result.data);
        if (remember) toast.success('Название запомнено для этого поставщика');
        setRows((previous) => ({ ...previous, [lineId]: { ...previous[lineId], unitAcknowledged: false } }));
      }
    });
  const openConfirmation = () => {
    try {
      if (!document) return;
      if (manual) throw new Error('Завершите добавление товара или отмените новую строку.');
      const body =
        pending ??
        invoiceReceiptPayload(document, rowsRef.current, {
          date,
          receivedAt: receivedAt || undefined,
          today,
          requestId,
          products: catalog,
          warehouses,
          unitLabel,
        });
      setPending(body);
      setConfirmOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверьте строки.');
    }
  };
  const confirm = () =>
    void run('Принимаем накладную…', async (current) => {
      if (!document || !pending) return;
      submitted.current = true;
      // Persist the exact request before dispatch; retry always sends this frozen body.
      localStorage.setItem(
        key,
        JSON.stringify({
          documentId: document.id,
          rows,
          date,
          receivedAt,
          requestId,
          pending,
          submitted: submitted.current,
        }),
      );
      try {
        const result = await supplierInvoicesApi.confirm(document.id, pending);
        if (!current()) return;
        localStorage.removeItem(key);
        for (const prefix of [
          'supplier',
          'supplier-deliveries',
          'supplier-payments',
          'suppliers',
          'products',
          'purchase-orders',
          'stock-movements',
        ])
          void queryClient.invalidateQueries({ queryKey: [prefix] });
        onReceived(result.data.id);
      } catch (cause) {
        if (!current()) return;
        const latest = await supplierInvoicesApi.get(document.id);
        if (!current()) return;
        apply(latest.data);
        if (latest.data.deliveryId) {
          localStorage.removeItem(key);
          onReceived(latest.data.deliveryId);
          return;
        }
        const status = (cause as { response?: { status?: number } })?.response?.status;
        if (status === 400 || status === 409) {
          submitted.current = false;
          setPending(null);
          setConfirmOpen(false);
          setRequestId(newUuid());
        }
        throw cause;
      }
    });
  const reviewLine = (lineId: string, excluded: boolean) =>
    void run('Обновляем строку…', async (current) => {
      if (!document) return;
      const result = await supplierInvoicesApi.reviewLine(document.id, lineId, {
        expectedVersion: document.version,
        excluded,
      });
      if (current()) apply(result.data);
    });
  const addManual = () =>
    void run('Добавляем товар…', async (current) => {
      if (!document || !manual) return;
      const body = manualInvoicePayload(document, manual),
        frozen = { ...manual, pending: body };
      setManual(frozen);
      localStorage.setItem(
        key,
        JSON.stringify({
          documentId: document.id,
          rows,
          date,
          receivedAt,
          requestId,
          pending,
          submitted: submitted.current,
          manual: frozen,
        }),
      );
      try {
        const result = await supplierInvoicesApi.addManualLine(document.id, body);
        if (current()) {
          apply(result.data);
          setManual(null);
        }
      } catch (cause) {
        if (!current()) return;
        const response = (cause as { response?: { status?: number; data?: { code?: string } } }).response;
        if (
          response?.status === 400 ||
          (response?.status === 409 && response.data?.code !== 'INVOICE_MANUAL_REQUEST_CONFLICT')
        )
          setManual({ ...manual, pending: undefined, requestId: newUuid() });
        throw cause;
      }
    });
  const editable = !busy && !pending && !manual?.pending && document?.status === 'review';
  const activeLines = document?.lines.filter((line) => !line.excluded) ?? [];
  const excludedLines = document?.lines.filter((line) => line.excluded) ?? [];
  const unitRows =
    activeLines.filter((line) => {
      const product = catalog.find((item) => item.id === line.productId);
      return product && invoiceUnitMismatch(line, product, unitLabel);
    }) ?? [];
  const acknowledgeUnits = (checked: boolean) =>
    setRows((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([id, row]) => [
          id,
          unitRows.some((line) => line.id === id) ? { ...row, unitAcknowledged: checked } : row,
        ]),
      ),
    );
  const change = (id: string, patch: Partial<InvoiceRowDrafts[string]>) => {
    const next = { ...rowsRef.current, [id]: { ...rowsRef.current[id], ...patch } };
    rowsRef.current = next;
    setRows(next);
  };
  return (
    <>
      <Modal
        isOpen={isOpen && restoredKey === key}
        onClose={() => {
          if (!pickerLine && !manualPicking && !confirmOpen && !pageDelete && !sourcePage) onClose();
        }}
        title="Проверка накладной"
        description={supplierName}
        size="4xl"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Закрыть
            </Button>
            {document?.deliveryId ? (
              <Button
                onClick={() => {
                  if (document.deliveryId) onReceived(document.deliveryId);
                }}
              >
                Открыть поставку
              </Button>
            ) : (
              <Button
                disabled={!!busy || !!manual || document?.status !== 'review'}
                loading={busy === 'Принимаем накладную…'}
                onClick={openConfirmation}
              >
                {pending ? 'Повторить приёмку' : 'Проверить и принять'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            Фото и распознанные строки — черновик. Остатки и долг изменятся только после подтверждения.
          </p>
          {busy && (
            <p role="status" className="text-sm text-accent-text">
              {busy}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-bad-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              icon={Camera}
              variant="secondary"
              disabled={
                !!busy ||
                !!pending ||
                !!manual?.pending ||
                document?.status === 'processing' ||
                document?.status === 'confirmed'
              }
              onClick={() => fileInput.current?.click()}
            >
              Добавить страницы · {document?.pages.length ?? 0}/8
            </Button>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                upload(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            {document?.pages.length ? (
              <Button
                icon={FileText}
                disabled={
                  !!busy ||
                  !!pending ||
                  !!manual?.pending ||
                  document.status === 'processing' ||
                  document.status === 'confirmed'
                }
                onClick={() =>
                  void run('Распознаём накладную…', async (current) => {
                    setDocument({ ...document, status: 'processing' });
                    const result = await supplierInvoicesApi.extract(document.id, document.version);
                    if (current()) apply(result.data);
                  })
                }
              >
                {document.status === 'error' ? 'Повторить распознавание' : 'Распознать'}
              </Button>
            ) : null}
            {document && (
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() =>
                  void run('Проверяем результат…', async (current) => {
                    const result = await supplierInvoicesApi.get(document.id);
                    if (current()) apply(result.data);
                  })
                }
              >
                Обновить статус
              </Button>
            )}
          </div>
          {document?.status === 'processing' && (
            <p className="text-sm text-ink-2">Обработка продолжается. Можно закрыть окно и вернуться к черновику.</p>
          )}
          {document?.status === 'error' && (
            <p role="alert" className="text-sm text-bad-text">
              Не удалось распознать документ. Фотографии сохранены: повторите попытку или добавьте товары вручную ниже.
            </p>
          )}
          {document?.status === 'duplicate' && (
            <p role="alert" className="text-sm text-warn-text">
              Такая накладная уже загружена.{' '}
              {document.duplicateOf && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run('Открываем накладную…', async (current) => {
                      const sourceId = document.duplicateOf;
                      if (!sourceId) return;
                      const result = await supplierInvoicesApi.get(sourceId);
                      if (current()) apply(result.data);
                    })
                  }
                >
                  Открыть исходную
                </Button>
              )}
            </p>
          )}
          <div className="flex gap-2 overflow-x-auto">
            {document?.pages.map((page) => (
              <div key={page.id} className="space-y-1">
                <PrivatePage url={page.url} index={page.index} />
                {(document.status === 'draft' || document.status === 'error') && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Удалить страницу ${page.index + 1}`}
                    disabled={!!busy || !!pending || !!manual?.pending}
                    onClick={() => setPageDelete(page.id)}
                  >
                    Удалить
                  </Button>
                )}
              </div>
            ))}
          </div>
          {document && !['processing', 'confirmed', 'duplicate'].includes(document.status) && (
            <Button
              variant="secondary"
              disabled={!!busy || !!pending || !!manual?.pending || !!manual}
              onClick={() => setManualPicking(true)}
            >
              Добавить товар вручную
            </Button>
          )}
          {manual && (
            <section className="space-y-3 rounded-xl border border-line p-3">
              <p className="text-sm font-semibold">Добавить вручную: {manual.name}</p>
              <p className="text-xs text-ink-3">
                Строка будет помечена как ручная. Соответствие поставщика не создаётся.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Количество, ${manual.unit}`}>
                  <Input
                    aria-label="Количество добавляемого товара"
                    inputMode="decimal"
                    disabled={!!busy || !!manual.pending}
                    value={manual.quantity}
                    onChange={(event) => setManual({ ...manual, quantity: event.target.value })}
                  />
                </Field>
                <Field label="Закупочная цена за единицу, ₽">
                  <Input
                    aria-label="Цена добавляемого товара"
                    inputMode="decimal"
                    disabled={!!busy || !!manual.pending}
                    value={manual.price}
                    onChange={(event) => setManual({ ...manual, price: event.target.value })}
                  />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button disabled={!!busy} onClick={addManual}>
                  {manual.pending ? 'Повторить добавление' : 'Добавить строку'}
                </Button>
                {!manual.pending && (
                  <Button variant="ghost" disabled={!!busy} onClick={() => setManual(null)}>
                    Не добавлять
                  </Button>
                )}
              </div>
            </section>
          )}
          {document?.status === 'review' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Дата документа · проверьте">
                  <Input
                    type="date"
                    aria-label="Дата документа"
                    value={date}
                    disabled={!editable}
                    onChange={(event) => {
                      dateTouched.current = true;
                      setDate(event.target.value);
                    }}
                  />
                </Field>
                <Field label="Заказ поставщику">
                  <Select
                    aria-label="Заказ поставщику"
                    value={document.orderId ?? ''}
                    disabled={!editable}
                    options={[
                      { value: '', label: 'Без привязки к заказу' },
                      ...orders.map((order) => ({
                        value: order.id,
                        label: `Заказ от ${order.createdAt.slice(0, 10)}`,
                      })),
                    ]}
                    onChange={(event) =>
                      void run('Сверяем заказ…', async (current) => {
                        const result = await supplierInvoicesApi.setOrder(
                          document.id,
                          document.version,
                          event.target.value || null,
                        );
                        if (current()) {
                          apply(result.data);
                          setRows((previous) =>
                            Object.fromEntries(
                              Object.entries(previous).map(([id, row]) => [id, { ...row, orderItemId: '' }]),
                            ),
                          );
                        }
                      })
                    }
                  />
                </Field>
                <Field label="Приход на склад" hint="Дата документа сама не переносит остатки в прошлое">
                  <Input
                    type="date"
                    aria-label="Дата прихода на склад"
                    max={today}
                    value={receivedAt}
                    disabled={!editable}
                    onChange={(event) => setReceivedAt(event.target.value)}
                    placeholder="Сегодня"
                  />
                </Field>
              </div>
              {document.comparison?.missingOrderItemIds.length ? (
                <p className="flex items-center gap-2 text-sm text-warn-text">
                  <AlertTriangle className="h-4 w-4" />В накладной нет {document.comparison.missingOrderItemIds.length}{' '}
                  позиций заказа. Они останутся непринятыми.
                </p>
              ) : null}
              {document.warnings.map((warning) => (
                <p key={warning} className="text-xs text-ink-2">
                  {invoiceWarningLabel(warning)}
                </p>
              ))}
              <p className="text-xs text-ink-3">
                Розница: пусто — сохранить текущую, 0 — установить ноль. Количество вводится в единице выбранного
                товара.
              </p>
              {!!unitRows.length && (
                <label className="flex min-h-11 items-center gap-2 rounded-lg bg-warn-soft/40 p-3 text-sm text-warn-text">
                  <input
                    aria-label="Количество и цены проверены в единицах склада"
                    type="checkbox"
                    disabled={!editable}
                    checked={unitRows.every((line) => rows[line.id]?.unitAcknowledged)}
                    onChange={(event) => acknowledgeUnits(event.target.checked)}
                  />
                  <AlertTriangle className="h-4 w-4" />
                  Количество и цены проверены в единицах склада
                </label>
              )}
              {!!excludedLines.length && (
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-sm text-ink-2">
                    Исключённые строки · {excludedLines.length}
                  </summary>
                  <p className="mt-2 text-xs text-ink-3">Не попадут в поставку. Исходное распознавание сохранено.</p>
                  {excludedLines.map((line) => (
                    <div key={line.id} className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm">{line.name}</span>
                      <Button size="sm" variant="ghost" disabled={!editable} onClick={() => reviewLine(line.id, false)}>
                        Вернуть строку
                      </Button>
                    </div>
                  ))}
                </details>
              )}
              {activeLines.map((line) => {
                const product = catalog.find((item) => item.id === line.productId);
                const draft = rows[line.id];
                const mismatch = !!product && invoiceUnitMismatch(line, product, unitLabel);
                const warnings = invoiceReviewWarnings(document, line, draft);
                const paper =
                  line.origin !== 'manual' && typeof line.sourcePageIndex === 'number'
                    ? document.pages.find((page) => page.index === line.sourcePageIndex)
                    : undefined;
                const suggestion = catalog.find((item) => item.id === line.suggestedProductId);
                return (
                  <section
                    key={line.id}
                    className={`space-y-3 rounded-xl border p-3 ${!product || warnings.length || mismatch ? 'border-warn/40 bg-warn-soft/30' : 'border-line'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-ink">{line.name || 'Название не распознано'}</p>
                        <p className="text-xs text-ink-3">
                          {line.origin === 'manual' ? 'Ручная строка:' : 'В накладной:'} {line.sku || 'без артикула'} ·{' '}
                          {line.unit || 'единица не распознана'}
                        </p>
                      </div>
                      {(!product || warnings.length > 0 || mismatch) && (
                        <span className="flex items-center gap-1 text-xs text-warn-text">
                          <AlertTriangle className="h-4 w-4" />
                          Проверьте строку
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!editable || !hasPermission('suppliers_manage')}
                        onClick={() => setPickerLine(line.id)}
                      >
                        {product ? product.name : 'Выбрать товар из каталога'}
                      </Button>
                      {product && line.origin !== 'manual' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!editable}
                          onClick={() => map(line.id, product, true)}
                        >
                          Запомнить название у поставщика
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={!editable} onClick={() => reviewLine(line.id, true)}>
                        Исключить строку
                      </Button>
                      {paper && (
                        <Button variant="ghost" size="sm" onClick={() => setSourcePage(paper)}>
                          Открыть страницу {paper.index + 1}
                        </Button>
                      )}
                      {line.origin === 'manual' && <span className="text-xs text-accent-text">Добавлено вручную</span>}
                      {!product && suggestion && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!editable}
                          onClick={() => map(line.id, suggestion, false)}
                        >
                          Подтвердить: {suggestion.name}
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field
                        label={`Количество, ${product ? unitLabel(line.productUnit ?? product.unit) : line.unit || 'ед.'}`}
                      >
                        <Input
                          aria-label={`Количество — ${line.name}`}
                          inputMode="decimal"
                          value={draft?.quantity ?? ''}
                          disabled={!editable}
                          onChange={(event) => change(line.id, { quantity: event.target.value })}
                        />
                      </Field>
                      <Field label="Закупочная цена за единицу, ₽">
                        <Input
                          aria-label={`Закупочная цена — ${line.name}`}
                          inputMode="decimal"
                          value={draft?.price ?? ''}
                          disabled={!editable}
                          onChange={(event) => change(line.id, { price: event.target.value })}
                        />
                      </Field>
                      <Field
                        label="Новая розница, ₽"
                        hint={product ? `Текущая: ${formatMoney(product.sellPrice, 2)}` : 'Сначала выберите товар'}
                      >
                        <Input
                          aria-label={`Новая розничная цена — ${line.name}`}
                          inputMode="decimal"
                          value={draft?.sellPrice ?? ''}
                          disabled={!editable}
                          onChange={(event) => change(line.id, { sellPrice: event.target.value })}
                        />
                      </Field>
                    </div>
                    {document.orderId && product && (
                      <Field label="Позиция заказа">
                        <Select
                          value={draft?.orderItemId ?? ''}
                          disabled={!editable}
                          options={[
                            { value: '', label: 'Выберите позицию' },
                            ...(document.comparison?.items
                              .filter((item) => item.productId === product.id)
                              .map((item) => ({
                                value: item.orderItemId,
                                label: `${item.name} · остаток ${item.outstandingQuantity} · ${formatMoney(item.price, 2)}`,
                              })) ?? []),
                          ]}
                          onChange={(event) => change(line.id, { orderItemId: event.target.value })}
                        />
                      </Field>
                    )}
                    {warnings.map((warning) => (
                      <p key={warning} className="text-xs text-warn-text">
                        {invoiceWarningLabel(warning)}
                      </p>
                    ))}
                    {mismatch && (
                      <p className="text-sm text-warn-text">
                        В накладной: {line.unit || '—'} · На складе: {unitLabel(line.productUnit ?? product?.unit)} —
                        проверьте количество
                      </p>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>
      </Modal>
      <ProductPickerDrawer
        open={(!!pickerLine || manualPicking) && restoredKey === key}
        onClose={() => {
          setPickerLine(null);
          setManualPicking(false);
        }}
        products={products.filter((product) => isReceivableProduct(product, warehouses))}
        isLoading={productsLoading}
        isError={productsError}
        onRetry={() => void refetchProducts()}
        priceKind="cost"
        onSelectProduct={(product) => {
          const id = pickerLine;
          setPickerLine(null);
          if (manualPicking) {
            setManualPicking(false);
            setManual({
              productId: product.id,
              name: product.name,
              unit: unitLabel(product.unit),
              quantity: '',
              price: '',
              requestId: newUuid(),
            });
          } else if (id) map(id, product, false);
        }}
      />
      <Modal
        isOpen={confirmOpen && restoredKey === key}
        onClose={() => {
          if (!busy) {
            setConfirmOpen(false);
            if (!submitted.current) setPending(null);
          }
        }}
        title="Принять накладную?"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={!!busy || submitted.current}
              onClick={() => {
                setConfirmOpen(false);
                setPending(null);
              }}
            >
              Назад к строкам
            </Button>
            <Button loading={!!busy} onClick={confirm}>
              Принять в долг
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          Будет создана одна поставка. Остатки увеличатся, сумма добавится в долг поставщику. Дата документа:{' '}
          {pending?.date}. Приход: {pending?.receivedAt || 'сегодня'}.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-bad-text">
            {error}
          </p>
        )}
      </Modal>
      <Modal
        isOpen={!!sourcePage && restoredKey === key}
        onClose={() => setSourcePage(null)}
        title={`Страница накладной ${(sourcePage?.index ?? 0) + 1}`}
        size="4xl"
        footer={
          <Button variant="secondary" onClick={() => setSourcePage(null)}>
            Закрыть страницу
          </Button>
        }
      >
        {sourcePage && <PrivatePage full url={sourcePage.url} index={sourcePage.index} />}
      </Modal>
      <ConfirmDialog
        isOpen={!!pageDelete && restoredKey === key}
        onClose={() => setPageDelete(null)}
        title="Удалить страницу?"
        message="Остальные страницы сохранятся. Перед приёмкой потребуется распознать и проверить строки заново."
        confirmText="Удалить страницу"
        variant="danger"
        onConfirm={() => {
          const id = pageDelete;
          if (!document || !id) return;
          void run('Удаляем страницу…', async (current) => {
            const result = await supplierInvoicesApi.deletePage(document.id, id, document.version);
            if (current()) apply(result.data);
          });
        }}
      />
    </>
  );
}
