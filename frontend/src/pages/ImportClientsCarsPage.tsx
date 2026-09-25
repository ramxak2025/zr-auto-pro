import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  Users,
  Car as CarIcon,
  RefreshCw,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { importsApi } from '../api/services';
import { formatPhone } from '../../../shared/validation/phone';
import { formatVin } from '../../../shared/utils/vin';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { useAuth } from '../contexts/AuthContext';
import { useVinEnabled } from '../hooks/useVinEnabled';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Checkbox } from '../ui/Checkbox';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Field } from '../ui/Field';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Select } from '../ui/Select';
import { StatCard } from '../ui/StatCard';
import { cn } from '../ui/cn';
import { toneChip, toneSoft, type Tone } from '../ui/tokens';
import type {
  ImportRowInput,
  ImportPreviewResponse,
  ImportConfirmResponse,
  ImportConfirmRequest,
  ImportClientGroup,
  ImportPlannedCar,
  ImportRowIssue,
  ImportIssueKind,
} from '../../../shared/api/types';

// ── Local additive API types (замена/пропуск дублей) ─────────────────────
// The backend physically returns/accepts these extra fields; they are typed
// locally instead of in shared/api/types.ts to keep this change page-scoped
// (shared/ is being edited concurrently by another workstream).
type DuplicateAction = 'replace' | 'skip';

interface ImportRowInputV2 extends ImportRowInput {
  /** «Комментарий» column — stored on the client card. */
  clientComment?: string | null;
}

interface ImportClientGroupV2 extends ImportClientGroup {
  /** Canonical phone as it will be stored: «+7 (988) 444-44-85». */
  phoneDisplay?: string;
  kind?: 'new' | 'duplicatePhone';
  existingClientName?: string | null;
  existingClientPhone?: string | null;
  fileFullName?: string | null;
  fileComment?: string | null;
}

interface ImportPreviewResponseV2 extends Omit<ImportPreviewResponse, 'groups'> {
  groups: ImportClientGroupV2[];
}

interface ImportConfirmRequestV2 extends ImportConfirmRequest {
  duplicateDefault?: DuplicateAction;
  decisions?: Array<{ phoneKey: string; action: DuplicateAction }>;
}

interface ImportConfirmResponseV2 extends ImportConfirmResponse {
  replacedClientIds?: string[];
  summary: ImportConfirmResponse['summary'] & {
    clientsReplaced?: number;
    duplicatesSkipped?: number;
  };
}

// ── Field keys we'll feed to the backend ─────────────────────────────────
type CanonicalField =
  | 'sourceRow'
  | 'clientName'
  | 'phone'
  | 'phoneRaw'
  | 'carPlate'
  | 'carModel'
  | 'carVin'
  | 'clientComment'
  | 'notes'
  | 'originalClientText';

const FIELD_LABELS: Record<CanonicalField, string> = {
  sourceRow: '№ строки в файле',
  clientName: 'Имя клиента',
  phone: 'Телефон (нормализованный)',
  phoneRaw: 'Телефон (как в файле)',
  carPlate: 'Госномер',
  carModel: 'Марка и модель авто',
  carVin: 'VIN',
  clientComment: 'Комментарий клиента',
  notes: 'Пометки качества данных',
  originalClientText: 'Исходный текст клиента',
};

// Полный порядок полей; «VIN» показывается только при включённой опции
// (171) — при выключенной мастер маппинга байт-в-байт прежний.
const FIELD_ORDER: CanonicalField[] = [
  'sourceRow',
  'clientName',
  'phone',
  'phoneRaw',
  'carPlate',
  'carModel',
  'carVin',
  'clientComment',
  'notes',
  'originalClientText',
];

const EMPTY_COLUMN_MAP: Record<CanonicalField, number> = {
  sourceRow: -1,
  clientName: -1,
  phone: -1,
  phoneRaw: -1,
  carPlate: -1,
  carModel: -1,
  carVin: -1,
  clientComment: -1,
  notes: -1,
  originalClientText: -1,
};

// Auto-detect a column index for each canonical field by header keyword.
function detectColumnMapping(headers: string[]): Record<CanonicalField, number> {
  const lower = headers.map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase(),
  );
  const map: Record<CanonicalField, number> = { ...EMPTY_COLUMN_MAP };
  lower.forEach((h, i) => {
    if (!h) return;
    if (map.sourceRow < 0 && /(source.?row|номер.?строк|row.?num|^№$|^id$)/.test(h)) map.sourceRow = i;
    else if (map.originalClientText < 0 && /(original.?client|raw.?client|original|raw|исходн)/.test(h)) {
      map.originalClientText = i;
    } else if (map.clientName < 0 && /(client.?name|client_name|^name$|имя|клиент|фио|fio|full.?name)/.test(h)) {
      map.clientName = i;
    } else if (
      map.phone < 0 &&
      /(^phone$|phone_(?:n|norm)|телефон.?норм|phone$|телефон)/.test(h) &&
      !/raw|^источн/.test(h)
    ) {
      map.phone = i;
    } else if (map.phoneRaw < 0 && /(phone_raw|phone.?raw|phoneraw|телефон.?сыр|raw.?phone)/.test(h)) {
      map.phoneRaw = i;
    } else if (map.carVin < 0 && /(^vin$|\bvin\b|car_vin|car.?vin|vin.?код|^вин$|вин.?код|вин.?номер)/.test(h)) {
      // 171 — «VIN» / «car_vin» из шаблона сервера. Раньше проверки госномера и
      // модели: «VIN авто» иначе ушёл бы в марку/модель по слову «авто».
      map.carVin = i;
    } else if (map.carPlate < 0 && /(plate|госном|номер.?авт|car_plate|плашк)/.test(h)) {
      map.carPlate = i;
    } else if (map.carModel < 0 && /(model|марк|car_model|car.?make|модель|авто)/.test(h)) {
      map.carModel = i;
    } else if (map.clientComment < 0 && /(коммент|^comment|client.?comment)/.test(h)) {
      // Must run before `notes` — its /комм/ would swallow «Комментарий».
      map.clientComment = i;
    } else if (map.notes < 0 && /(note|пометк|комм|warn|issue|качеств)/.test(h)) {
      map.notes = i;
    }
  });

  // Two-phone-column heuristic: if we found phoneRaw but not phone, prefer phoneRaw → phone too.
  if (map.phone < 0 && map.phoneRaw >= 0) {
    map.phone = map.phoneRaw;
  }
  return map;
}

// Format an issue kind into a human-readable group title.
const ISSUE_LABELS: Record<ImportIssueKind, string> = {
  no_phone: 'Без телефона',
  invalid_phone: 'Невалидный телефон',
  no_name: 'Без имени',
  no_plate: 'Без госномера',
  invalid_plate: 'Невалидный госномер',
  foreign_plate: 'Иностранный/нестандартный номер',
  unclear_car_model: 'Модель не определена',
  plate_belongs_to_other_client: 'Госномер у другого клиента',
  duplicate_in_file: 'Повтор в файле',
  multiple_name_candidates: 'Несколько имён на один телефон',
  name_conflict_same_phone: 'Конфликт имени',
  // 171 — колонка VIN (учитывается только при включённой опции «VIN-код автомобиля»).
  invalid_vin: 'VIN не распознан',
  duplicate_vin: 'VIN уже занят или повторяется',
};

// `duplicate_phone` is emitted by the backend for duplicate-skips — it is not
// part of the shared ImportIssueKind union (kept page-local, see header note).
const EXTRA_ISSUE_LABELS: Record<string, string> = {
  duplicate_phone: 'Дубль по телефону (пропущен)',
};
function issueLabel(kind: string): string {
  return ISSUE_LABELS[kind as ImportIssueKind] || EXTRA_ISSUE_LABELS[kind] || kind;
}

// Pretty-print an already-stored phone; leaves foreign / unusual numbers as is
// (formatPhone assumes the RU 11-digit shape).
function displayPhone(p?: string | null): string {
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  return digits.length === 11 && (digits[0] === '7' || digits[0] === '8') ? formatPhone(p) : p;
}

const SEVERITY: Record<ImportIssueKind, 'error' | 'warning'> = {
  no_phone: 'error',
  invalid_phone: 'error',
  no_plate: 'warning',
  invalid_plate: 'warning',
  no_name: 'warning',
  foreign_plate: 'warning',
  unclear_car_model: 'warning',
  plate_belongs_to_other_client: 'error',
  duplicate_in_file: 'warning',
  multiple_name_candidates: 'warning',
  name_conflict_same_phone: 'warning',
  invalid_vin: 'warning',
  duplicate_vin: 'warning',
};

type Step = 'upload' | 'mapping' | 'preview' | 'done';
const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Загрузка' },
  { key: 'mapping', label: 'Колонки' },
  { key: 'preview', label: 'Проверка' },
  { key: 'done', label: 'Готово' },
];

/** Пять первых строк файла — «как мы их прочитали» по текущему маппингу. */
interface SampleRow {
  idx: number;
  cells: Partial<Record<CanonicalField, string>>;
}

export default function ImportClientsCarsPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const vinEnabled = useVinEnabled();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<CanonicalField, number>>(() => ({ ...EMPTY_COLUMN_MAP }));
  const [allowForeignPlates, setAllowForeignPlates] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponseV2 | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [result, setResult] = useState<ImportConfirmResponseV2 | null>(null);

  // Duplicate decisions: global default + per-group overrides (key = phoneKey).
  const [dupDefault, setDupDefault] = useState<DuplicateAction>('skip');
  const [dupOverrides, setDupOverrides] = useState<Record<string, DuplicateAction>>({});

  // Поля мастера: VIN — только при включённой опции.
  const fields = useMemo(() => (vinEnabled ? FIELD_ORDER : FIELD_ORDER.filter((f) => f !== 'carVin')), [vinEnabled]);

  // ─── Permission gate ──────────────────────────────────────────────────────
  // Импорт создаёт/меняет клиентов и авто — backend imports/ гейтится ключом
  // clients_edit (волна Битрикс24; байпас superadmin/director — внутри
  // hasPermission, admin — по матрице роли).
  const canImport = hasPermission('clients_edit');

  // ─── Desktop-only gate ────────────────────────────────────────────────────
  // Import is a desktop workflow (file picker, big mapping table, large preview
  // tables). On phones we surface a friendly "open on desktop" screen instead
  // of a broken layout.
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ─── File parsing ─────────────────────────────────────────────────────────
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';

    const parseSheet = (data: ArrayBuffer | string, type: 'array' | 'string') => {
      try {
        const input = type === 'array' ? new Uint8Array(data as ArrayBuffer) : (data as string);
        const wb = XLSX.read(input as never, { type, raw: false, cellDates: false, codepage: 65001, FS: ';' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
          toast.error('Файл не содержит листов');
          return;
        }
        const sheet = wb.Sheets[sheetName];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });
        if (rows.length < 2) {
          toast.error('Файл пустой или содержит только заголовок');
          return;
        }
        // Find header row: scan first 5 rows for the one with most non-empty cells.
        let headerIdx = 0;
        let bestNonEmpty = rows[0].filter(Boolean).length;
        for (let i = 1; i < Math.min(rows.length, 5); i++) {
          const n = rows[i].filter(Boolean).length;
          if (n > bestNonEmpty) {
            bestNonEmpty = n;
            headerIdx = i;
          }
        }
        const hdr = rows[headerIdx].map((c) => String(c ?? ''));
        const data2 = rows.slice(headerIdx + 1);
        const detected = detectColumnMapping(hdr);
        setHeaders(hdr);
        setRawRows(data2);
        setColumnMap(detected);
        setStep('mapping');
        toast.success(`Найдено строк: ${data2.length.toLocaleString('ru-RU')}`);
      } catch (err) {
        toast.error(`Ошибка чтения файла: ${err instanceof Error ? err.message : 'неизвестно'}`);
      }
    };

    if (isCsv) {
      const readAs = (encoding: string) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = (ev.target?.result as string) || '';
          if (encoding === 'utf-8' && /�/.test(text)) {
            readAs('windows-1251');
            return;
          }
          parseSheet(text, 'string');
        };
        reader.onerror = () => toast.error('Не удалось прочитать файл');
        reader.readAsText(file, encoding);
      };
      readAs('utf-8');
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => parseSheet(ev.target?.result as ArrayBuffer, 'array');
      reader.onerror = () => toast.error('Не удалось прочитать файл');
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  }

  // ─── Build payload from columnMap ─────────────────────────────────────────
  function buildPayload(): ImportRowInputV2[] {
    return rawRows.map((row, idx) => {
      const cell = (i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
      const sourceRowFromCol = cell(columnMap.sourceRow);
      const sourceRowParsed = parseInt(sourceRowFromCol, 10);
      return {
        sourceRow: Number.isFinite(sourceRowParsed) && sourceRowParsed > 0 ? sourceRowParsed : idx + 2,
        clientName: cell(columnMap.clientName) || null,
        phone: cell(columnMap.phone) || null,
        phoneRaw: cell(columnMap.phoneRaw) || null,
        carPlate: cell(columnMap.carPlate) || null,
        carModel: cell(columnMap.carModel) || null,
        // 171 — VIN уходит только при включённой опции; сервер нормализует сам.
        ...(vinEnabled ? { carVin: cell(columnMap.carVin) || null } : {}),
        clientComment: cell(columnMap.clientComment) || null,
        notes: cell(columnMap.notes) || null,
        originalClientText: cell(columnMap.originalClientText) || null,
      };
    });
  }

  async function runPreview() {
    if (columnMap.phone < 0 && columnMap.phoneRaw < 0) {
      toast.error('Укажите колонку с телефоном');
      return;
    }
    if (columnMap.clientName < 0) {
      toast.error('Укажите колонку с именем клиента');
      return;
    }
    setPreviewing(true);
    try {
      const rows = buildPayload();
      const res = await importsApi.previewClientsCars({ rows, options: { allowForeignPlates } });
      setPreview(res.data as ImportPreviewResponseV2);
      setDupOverrides({});
      setDupDefault('skip');
      setStep('preview');
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err) || (err instanceof Error ? err.message : 'Не удалось получить предпросмотр'));
    } finally {
      setPreviewing(false);
    }
  }

  async function runConfirm() {
    if (!preview) return;
    setConfirming(true);
    try {
      const rows = buildPayload();
      // Explicit decision for every duplicate group: override ?? global default.
      const decisions = duplicateGroups.map((g) => ({
        phoneKey: g.phoneKey,
        action: dupOverrides[g.phoneKey] ?? dupDefault,
      }));
      const payload: ImportConfirmRequestV2 = {
        rows,
        options: { allowForeignPlates },
        duplicateDefault: dupDefault,
        decisions,
      };
      const res = await importsApi.confirmClientsCars(payload);
      const data = res.data as ImportConfirmResponseV2;
      setResult(data);
      setStep('done');
      const replaced = data.summary.clientsReplaced ?? 0;
      toast.success(
        `Импорт завершён: создано ${data.summary.clientsWillCreate} клиентов` +
          (replaced > 0 ? `, обновлено ${replaced}` : '') +
          `, авто: ${data.summary.carsWillCreate}.`,
      );
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err) || (err instanceof Error ? err.message : 'Не удалось выполнить импорт'));
    } finally {
      setConfirming(false);
    }
  }

  // Real Excel (.xlsx) template, generated client-side with SheetJS.
  // Headers match what detectColumnMapping() auto-detects, so a filled
  // template maps 1:1 without manual column matching. The legacy CSV
  // endpoint (GET /imports/clients-cars/template) still works untouched.
  function downloadTemplate() {
    try {
      const headers = ['Имя клиента*', 'Телефон*', 'Госномер', 'Марка и модель', 'Комментарий'];
      const examples = [
        ['Иванов Иван', '+7 (999) 123-45-67', 'А123ВС77', 'Toyota Camry', 'Постоянный клиент'],
        ['Дмитриев Дмитрий', '89887654321', 'В456ЕК05', 'Lada Priora', ''],
        ['Петров Пётр', '9001112233', '', '', 'Клиент без авто — можно оставить госномер пустым'],
      ];
      const cols = [{ wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 44 }];
      if (vinEnabled) {
        // 171 — колонка VIN после марки/модели; распознаётся автодетектом («VIN»).
        headers.splice(4, 0, 'VIN');
        examples[0].splice(4, 0, 'XTA219010K0123456');
        examples[1].splice(4, 0, '');
        examples[2].splice(4, 0, '');
        cols.splice(4, 0, { wch: 20 });
      }
      const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
      ws['!cols'] = cols;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');
      XLSX.writeFile(wb, 'Шаблон импорта клиентов Autexa.xlsx');
    } catch {
      toast.error('Не удалось сформировать шаблон');
    }
  }

  function reset() {
    setStep('upload');
    setHeaders([]);
    setRawRows([]);
    setPreview(null);
    setResult(null);
    setFileName('');
    setDupOverrides({});
    setDupDefault('skip');
  }

  // ─── Derived: issue grouping ──────────────────────────────────────────────
  const issuesByKind = useMemo(() => {
    const map = new Map<ImportIssueKind, ImportRowIssue[]>();
    if (!preview) return map;
    for (const issue of preview.issues) {
      const arr = map.get(issue.kind) || [];
      arr.push(issue);
      map.set(issue.kind, arr);
    }
    return map;
  }, [preview]);

  const skippedByKind = useMemo(() => {
    const map = new Map<ImportIssueKind, Array<{ sourceRow: number; reason: ImportIssueKind; message: string }>>();
    if (!preview) return map;
    for (const s of preview.skippedRows) {
      const arr = map.get(s.reason) || [];
      arr.push(s);
      map.set(s.reason, arr);
    }
    return map;
  }, [preview]);

  // Duplicate-phone groups — the user chooses «Заменить» / «Пропустить» per row.
  const duplicateGroups = useMemo(() => (preview?.groups || []).filter((g) => !!g.existingClientId), [preview]);

  // Plate conflicts (car already belongs to ANOTHER client) — informational:
  // such cars are never re-attached or duplicated, they are always skipped.
  const plateConflicts = useMemo(() => {
    const out: Array<{ sourceRow: number; plate: string; owner: string; groupName: string }> = [];
    for (const g of preview?.groups || []) {
      for (const c of g.cars) {
        if (c.conflictsWithClientId) {
          out.push({
            sourceRow: c.sourceRow,
            plate: c.plateDisplay,
            owner: c.conflictsWithClientName || 'другой клиент',
            groupName: g.fullName,
          });
        }
      }
    }
    return out;
  }, [preview]);

  const sampleRows = useMemo<SampleRow[]>(
    () =>
      rawRows.slice(0, 5).map((row, idx) => {
        const cells: Partial<Record<CanonicalField, string>> = {};
        for (const f of fields) {
          const i = columnMap[f];
          cells[f] = i >= 0 ? String(row[i] ?? '') : '';
        }
        return { idx, cells };
      }),
    [rawRows, columnMap, fields],
  );

  const headerOptions = useMemo(
    () => [
      { value: '-1', label: '— не использовать —' },
      ...headers.map((h, i) => ({ value: String(i), label: h || `(колонка ${i + 1})` })),
    ],
    [headers],
  );

  if (!canImport) {
    return (
      <div className="space-y-5">
        <PageHeader backTo="/clients" title="Импорт клиентов и авто" />
        <Card>
          <EmptyState
            icon={Upload}
            title="Импорт недоступен"
            description="Импорт доступен директору, администратору или владельцу сервиса — нужно право на редактирование клиентов."
            action={{ label: 'К списку клиентов', onClick: () => navigate('/clients') }}
          />
        </Card>
      </div>
    );
  }

  if (isMobileViewport) {
    return (
      <div className="space-y-5">
        <PageHeader backTo="/clients" title="Импорт клиентов и авто" />
        <Card>
          <EmptyState
            icon={FileSpreadsheet}
            title="Откройте на компьютере"
            description="Импорт больших Excel/CSV-файлов с сопоставлением колонок неудобен на телефоне. Откройте Autexa на ноутбуке или ПК — раздел появится в «Клиентах»."
            action={{ label: 'Назад к клиентам', onClick: () => navigate('/clients') }}
          />
        </Card>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        backTo="/clients"
        icon={Upload}
        title="Импорт клиентов и авто"
        subtitle="Excel или CSV → клиенты и их автомобили"
        actions={
          <Button
            variant="secondary"
            icon={Download}
            onClick={downloadTemplate}
            title={`Excel-файл с колонками: имя, телефон, госномер, марка и модель${vinEnabled ? ', VIN' : ''}, комментарий`}
          >
            Скачать шаблон (Excel)
          </Button>
        }
      />

      {/* Stepper */}
      <ol className="grid grid-cols-4 gap-2" aria-label="Шаги импорта">
        {STEPS.map((s, i) => {
          const isCurrent = i === stepIndex;
          const isPast = i < stepIndex;
          return (
            <li
              key={s.key}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded-lg border text-xs font-semibold',
                isCurrent
                  ? 'border-accent bg-accent text-white'
                  : isPast
                    ? 'border-accent/30 bg-accent-soft text-accent-text'
                    : 'border-line bg-surface text-ink-3',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-2xs tabular-nums',
                  isCurrent ? 'bg-white/20' : isPast ? 'bg-accent/15' : 'bg-surface-3',
                )}
                aria-hidden="true"
              >
                {isPast ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s.label}
            </li>
          );
        })}
      </ol>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card padding="md">
          <div className="mx-auto max-w-lg py-6 text-center">
            <span className={cn('mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl', toneChip.accent)}>
              <FileSpreadsheet className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 className="text-md font-semibold text-ink">Загрузите файл с клиентами и авто</h2>
            <p className="mt-2 text-sm text-ink-3">
              Excel (.xlsx, .xls) или CSV. Один телефон с разными госномерами — это один клиент с несколькими авто.
              Сотрудников и пользователей не импортируем.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              aria-label="Файл импорта"
              onChange={handleFileChange}
            />
            <Button icon={Upload} onClick={() => fileInputRef.current?.click()} className="mt-6">
              Выбрать файл
            </Button>
            <p className="mt-6 text-xs text-ink-3">
              Проще всего — скачать шаблон Excel (кнопка сверху) и вставить данные в колонки: имя, телефон, госномер,
              марка и модель{vinEnabled ? ', VIN' : ''}, комментарий. Если названия колонок другие — на следующем шаге
              сопоставите вручную.
            </p>
          </div>
        </Card>
      )}

      {/* Step 2: Mapping */}
      {step === 'mapping' && (
        <Card padding="none">
          <CardHeader
            icon={FileSpreadsheet}
            title="Сопоставьте колонки"
            subtitle={`Файл «${fileName}» — строк: ${rawRows.length.toLocaleString('ru-RU')}, колонок: ${headers.length}`}
            actions={
              <Button variant="secondary" icon={RefreshCw} onClick={reset}>
                Другой файл
              </Button>
            }
          />
          <CardBody>
            <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
              {fields.map((field) => {
                const required = field === 'clientName' || field === 'phone';
                const selectId = `map-${field}`;
                return (
                  <Field key={field} label={FIELD_LABELS[field]} htmlFor={selectId} required={required} inline>
                    <Select
                      id={selectId}
                      value={String(columnMap[field])}
                      onChange={(e) => setColumnMap((prev) => ({ ...prev, [field]: parseInt(e.target.value, 10) }))}
                      options={headerOptions}
                    />
                  </Field>
                );
              })}
            </div>

            {/* Sample preview */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-ink">Первые 5 строк — как мы их прочитали</h3>
              <DataTable
                dense
                caption="Предпросмотр первых строк файла"
                rows={sampleRows}
                rowKey={(r) => r.idx}
                columns={fields.map(
                  (f) =>
                    ({
                      key: f,
                      header: FIELD_LABELS[f],
                      truncate: true,
                      width: f === 'sourceRow' ? 90 : 180,
                      render: (r: SampleRow) =>
                        r.cells[f] ? (
                          <span className={cn(f === 'carVin' && 'font-mono text-xs')} title={r.cells[f]}>
                            {r.cells[f]}
                          </span>
                        ) : (
                          <span className="text-ink-4">—</span>
                        ),
                    }) satisfies DataTableColumn<SampleRow>,
                )}
              />
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4 md:flex-row md:items-center md:justify-between">
              <Checkbox
                checked={allowForeignPlates}
                onChange={(e) => setAllowForeignPlates(e.target.checked)}
                label="Импортировать иностранные и нестандартные номера"
                description="Такие авто создаются с предупреждением"
              />
              <Button icon={CheckCircle2} onClick={runPreview} loading={previewing}>
                Проверить и показать предпросмотр
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact label="Всего строк" value={preview.summary.totalRows} icon={FileSpreadsheet} />
            <StatCard
              compact
              label="Клиентов"
              value={preview.summary.clientsWillCreate}
              hint={`новых · уже есть: ${preview.summary.clientsWillReuse}`}
              icon={Users}
              tone="accent"
            />
            <StatCard
              compact
              label="Автомобилей"
              value={preview.summary.carsWillCreate}
              hint={`новых · уже есть: ${preview.summary.carsAlreadyExist}`}
              icon={CarIcon}
            />
            <StatCard
              compact
              label="Пропущено строк"
              value={preview.summary.rowsSkipped}
              hint={`ошибок: ${preview.summary.errors}`}
              icon={XCircle}
              tone={preview.summary.rowsSkipped > 0 ? 'warn' : 'neutral'}
            />
          </div>

          {/* Duplicates: «Заменить» / «Пропустить» decisions */}
          {duplicateGroups.length > 0 && (
            <Card padding="none">
              <CardHeader
                icon={Users}
                iconTone="warn"
                title={`Уже есть в базе: ${duplicateGroups.length} ${duplicateGroups.length === 1 ? 'клиент' : 'клиентов'}`}
                subtitle="«Заменить» — обновить имя и комментарий данными из файла и добавить новые авто; история сохраняется. «Пропустить» — оставить без изменений."
                actions={
                  <SegmentedControl
                    aria-label="Действие для всех дублей"
                    size="sm"
                    value={dupDefault}
                    onChange={(v) => {
                      setDupDefault(v);
                      setDupOverrides({});
                    }}
                    options={[
                      { value: 'replace', label: 'Заменить все' },
                      { value: 'skip', label: 'Пропустить все' },
                    ]}
                  />
                }
              />
              <DataTable
                bare
                dense
                caption="Клиенты, которые уже есть в базе"
                rows={duplicateGroups}
                rowKey={(g) => g.phoneKey}
                maxHeight="24rem"
                rowClassName={(g) =>
                  (dupOverrides[g.phoneKey] ?? dupDefault) === 'replace' ? '[&>td]:bg-accent-soft/40' : undefined
                }
                columns={[
                  {
                    key: 'file',
                    header: 'В файле',
                    render: (g) => (
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">
                          {g.fileFullName || <span className="font-normal text-ink-3">без имени</span>}
                        </span>
                        <span className="block text-xs tabular-nums text-ink-3">{g.phoneDisplay || g.phoneKey}</span>
                      </span>
                    ),
                  },
                  {
                    key: 'existing',
                    header: 'Уже в базе',
                    render: (g) => (
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{g.existingClientName || 'Клиент'}</span>
                        <span className="block text-xs tabular-nums text-ink-3">
                          {displayPhone(g.existingClientPhone) || g.phoneDisplay || g.phoneKey}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'newCars',
                    header: 'Новых авто',
                    numeric: true,
                    width: 110,
                    render: (g) => {
                      const n = g.cars.filter((c) => !c.existsForCurrentClient && !c.conflictsWithClientId).length;
                      return n > 0 ? `+${n}` : <span className="text-ink-4">—</span>;
                    },
                  },
                  {
                    key: 'action',
                    header: 'Действие',
                    interactive: true,
                    width: 160,
                    align: 'right',
                    render: (g) => (
                      <Select
                        size="sm"
                        aria-label={`Действие для ${g.existingClientName || g.phoneKey}`}
                        value={dupOverrides[g.phoneKey] ?? dupDefault}
                        onChange={(e) =>
                          setDupOverrides((prev) => ({
                            ...prev,
                            [g.phoneKey]: e.target.value as DuplicateAction,
                          }))
                        }
                        options={[
                          { value: 'replace', label: 'Заменить' },
                          { value: 'skip', label: 'Пропустить' },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          )}

          {/* Plate conflicts — cars owned by ANOTHER client are never re-attached */}
          {plateConflicts.length > 0 && (
            <Card padding="none">
              <CardHeader
                icon={CarIcon}
                iconTone="bad"
                title={`Госномер уже у другого клиента: ${plateConflicts.length}`}
                subtitle="Эти авто прикреплены к другим клиентам и не будут перенесены или продублированы — строки пропускаются"
              />
              <CardBody padding="sm">
                <ul className="max-h-48 space-y-1 overflow-auto rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
                  {plateConflicts.map((p, i) => (
                    <li key={i}>
                      <span className="font-mono text-ink-3">#{p.sourceRow}</span> · Госномер{' '}
                      <span className="font-mono">{p.plate}</span> (в файле — {p.groupName}) уже у клиента «{p.owner}»
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Issue groups */}
          <Card padding="none" className="divide-y divide-line">
            <IssueGroup
              title="Пропущенные строки"
              icon={XCircle}
              total={preview.skippedRows.length}
              by={skippedByKind}
              tone="bad"
            />
            <IssueGroup
              title="Предупреждения"
              icon={AlertTriangle}
              total={preview.issues.filter((i) => SEVERITY[i.kind] === 'warning').length}
              by={issuesByKind}
              filter={(k) => SEVERITY[k] === 'warning'}
              tone="warn"
            />
            <IssueGroup
              title="Ошибки уровня строки"
              icon={XCircle}
              total={preview.issues.filter((i) => SEVERITY[i.kind] === 'error').length}
              by={issuesByKind}
              filter={(k) => SEVERITY[k] === 'error'}
              tone="bad"
            />
          </Card>

          {/* Sample of grouped clients */}
          <Card padding="none">
            <CardHeader
              icon={Users}
              title="Первые 20 клиентов после группировки"
              subtitle={
                preview.groups.length > 20
                  ? `… и ещё ${preview.groups.length - 20} — в файле ${preview.groups.length} клиентов`
                  : `Всего клиентов в файле: ${preview.groups.length}`
              }
            />
            <DataTable
              bare
              dense
              caption="Клиенты после группировки по телефону"
              rows={preview.groups.slice(0, 20)}
              rowKey={(g) => g.phoneKey}
              columns={[
                {
                  key: 'name',
                  header: 'Имя',
                  render: (g) => <span className="font-medium text-ink">{g.fullName}</span>,
                },
                {
                  key: 'phone',
                  header: 'Телефон',
                  width: 170,
                  render: (g) => <span className="tabular-nums">{g.phoneDisplay || g.phoneKey}</span>,
                },
                {
                  key: 'status',
                  header: 'Статус',
                  width: 130,
                  render: (g) =>
                    g.existingClientId ? (
                      <Badge tone="warn" size="sm">
                        Уже есть
                      </Badge>
                    ) : (
                      <Badge tone="ok" size="sm">
                        Будет создан
                      </Badge>
                    ),
                },
                {
                  key: 'cars',
                  header: 'Автомобили',
                  render: (g) =>
                    g.cars.length === 0 ? (
                      <span className="text-ink-4">нет авто</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {g.cars.map((c, i) => (
                          <PlannedCarChip key={i} car={c} vinEnabled={vinEnabled} />
                        ))}
                      </span>
                    ),
                },
              ]}
            />
          </Card>

          {/* Actions */}
          <Card padding="md" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-ink-2">
              Проверьте предупреждения{duplicateGroups.length > 0 ? ' и решения по дублям выше' : ''}. После
              «Подтвердить импорт» данные будут записаны в базу. Дубликаты не создаются
              {duplicateGroups.length > 0 ? ' — по каждому сработает выбранное действие' : ''}.
            </p>
            <div className="flex flex-shrink-0 gap-2">
              <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep('mapping')}>
                Изменить колонки
              </Button>
              <Button icon={CheckCircle2} onClick={() => setConfirmImportOpen(true)} loading={confirming}>
                Подтвердить импорт
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && result && (
        <Card padding="md">
          <div className="py-4 text-center">
            <span className={cn('mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full', toneChip.ok)}>
              <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 className="text-md font-semibold text-ink">Импорт завершён</h2>
            <p className="mt-1 text-xs text-ink-3">
              Запись в журнале импорта: <span className="font-mono">{result.importRunId}</span>
            </p>
          </div>

          <div className="mx-auto mt-4 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard
              compact
              label="Создано клиентов"
              value={result.summary.clientsWillCreate}
              icon={Users}
              tone="ok"
            />
            <StatCard compact label="Обновлено" value={result.summary.clientsReplaced ?? 0} icon={RefreshCw} />
            <StatCard compact label="Дублей пропущено" value={result.summary.duplicatesSkipped ?? 0} icon={Users} />
            <StatCard compact label="Создано авто" value={result.summary.carsWillCreate} icon={CarIcon} tone="ok" />
            <StatCard
              compact
              label="Пропущено строк"
              value={result.summary.rowsSkipped}
              icon={XCircle}
              tone={result.summary.rowsSkipped > 0 ? 'warn' : 'neutral'}
            />
          </div>

          {result.skipped.length > 0 && (
            <details className="mx-auto mt-5 max-w-3xl rounded-lg border border-line bg-surface-2 px-4 py-3 text-left">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                Подробнее по пропущенным ({result.skipped.length})
              </summary>
              <ul className="mt-3 max-h-72 space-y-1 overflow-auto text-xs text-ink-2">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono text-ink-3">#{s.sourceRow}</span> · [{issueLabel(s.reason)}] {s.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" icon={Upload} onClick={reset}>
              Импортировать ещё файл
            </Button>
            <Link to="/clients" className={buttonClasses()}>
              <Users className="h-4 w-4" aria-hidden="true" />
              Перейти к клиентам
            </Link>
          </div>
        </Card>
      )}

      {/* Confirm import — irreversible DB write, routed through the styled dialog */}
      <ConfirmDialog
        isOpen={confirmImportOpen}
        onClose={() => setConfirmImportOpen(false)}
        onConfirm={runConfirm}
        title="Импортировать данные?"
        message="Клиенты и их автомобили будут сохранены в вашей базе согласно выбранным решениям по дублям. Продолжить?"
        confirmText="Импортировать"
        variant="primary"
      />
    </div>
  );
}

// ─── Small bits ──────────────────────────────────────────────────────────────

/** Чип запланированного авто: госномер + (при включённой опции) VIN моноширинно. */
function PlannedCarChip({ car, vinEnabled }: { car: ImportPlannedCar; vinEnabled: boolean }) {
  const tone: Tone = car.conflictsWithClientId
    ? 'bad'
    : car.existsForCurrentClient
      ? 'warn'
      : car.isForeign
        ? 'info'
        : 'ok';
  const hint = car.conflictsWithClientId
    ? 'госномер у другого клиента'
    : car.existsForCurrentClient
      ? 'уже есть у клиента'
      : car.isForeign
        ? 'иностранный номер'
        : 'будет создано';
  return (
    <span
      className={cn('inline-flex max-w-full flex-col rounded-md px-2 py-0.5 text-2xs leading-4', toneSoft[tone])}
      title={`${car.makeModel}${car.rawModel ? ` (в файле: ${car.rawModel})` : ''} — ${hint}`}
    >
      <span className="font-mono font-semibold tabular-nums">{car.plateDisplay}</span>
      {vinEnabled && car.vin && <span className="font-mono tabular-nums opacity-80">{formatVin(car.vin)}</span>}
    </span>
  );
}

function IssueGroup({
  title,
  icon: Icon,
  total,
  by,
  filter,
  tone,
}: {
  title: string;
  icon: LucideIcon;
  total: number;
  by: Map<
    ImportIssueKind,
    Array<{ sourceRow: number; message: string; kind?: ImportIssueKind; reason?: ImportIssueKind }>
  >;
  filter?: (k: ImportIssueKind) => boolean;
  tone: 'bad' | 'warn';
}) {
  const entries = Array.from(by.entries()).filter(([k]) => (filter ? filter(k) : true));
  const iconChip = (
    <span
      className={cn(
        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
        total === 0 ? toneChip.neutral : toneChip[tone],
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
  if (total === 0) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
        <span className="flex items-center gap-3">
          {iconChip}
          <span className="font-medium text-ink">{title}</span>
        </span>
        <span className="text-ink-3">нет</span>
      </div>
    );
  }
  return (
    <details className="group px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3">
          {iconChip}
          <span className="font-medium text-ink">{title}</span>
          <Badge tone={tone} size="sm">
            {total}
          </Badge>
        </span>
        <span className="text-xs text-ink-3 group-open:hidden">Показать</span>
        <span className="hidden text-xs text-ink-3 group-open:inline">Скрыть</span>
      </summary>
      <div className="mt-3 space-y-3 pl-11">
        {entries.map(([kind, items]) => (
          <div key={kind} className="text-xs">
            <p className="mb-1 font-semibold text-ink-2">
              {issueLabel(kind)} <span className="font-normal text-ink-3">({items.length})</span>
            </p>
            <ul className="max-h-48 space-y-1 overflow-auto rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
              {items.slice(0, 50).map((it, i) => (
                <li key={i}>
                  <span className="font-mono text-ink-3">#{it.sourceRow}</span> · {it.message}
                </li>
              ))}
              {items.length > 50 && <li className="text-ink-3">… и ещё {items.length - 50}</li>}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
