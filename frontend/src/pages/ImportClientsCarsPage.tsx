import { useState, useEffect, useMemo, useRef, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { importsApi } from '../api/services';
import { formatPhone } from '../../../shared/validation/phone';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import type {
  ImportRowInput,
  ImportPreviewResponse,
  ImportConfirmResponse,
  ImportConfirmRequest,
  ImportClientGroup,
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
  | 'clientComment'
  | 'notes'
  | 'originalClientText';

const FIELD_LABELS: Record<CanonicalField, string> = {
  sourceRow: '№ строки в файле',
  clientName: 'Имя клиента',
  phone: 'Телефон (нормализованный)',
  phoneRaw: 'Телефон (как в файле)',
  carPlate: 'Госномер',
  carModel: 'Марка/модель авто',
  clientComment: 'Комментарий клиента',
  notes: 'Пометки качества данных',
  originalClientText: 'Исходный текст клиента',
};

const FIELD_ORDER: CanonicalField[] = [
  'sourceRow',
  'clientName',
  'phone',
  'phoneRaw',
  'carPlate',
  'carModel',
  'clientComment',
  'notes',
  'originalClientText',
];

// Auto-detect a column index for each canonical field by header keyword.
function detectColumnMapping(headers: string[]): Record<CanonicalField, number> {
  const lower = headers.map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase(),
  );
  const map: Record<CanonicalField, number> = {
    sourceRow: -1,
    clientName: -1,
    phone: -1,
    phoneRaw: -1,
    carPlate: -1,
    carModel: -1,
    clientComment: -1,
    notes: -1,
    originalClientText: -1,
  };
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
};

type Step = 'upload' | 'mapping' | 'preview' | 'done';

export default function ImportClientsCarsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<CanonicalField, number>>(() => ({
    sourceRow: -1,
    clientName: -1,
    phone: -1,
    phoneRaw: -1,
    carPlate: -1,
    carModel: -1,
    clientComment: -1,
    notes: -1,
    originalClientText: -1,
  }));
  const [allowForeignPlates, setAllowForeignPlates] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponseV2 | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ImportConfirmResponseV2 | null>(null);

  // Duplicate decisions: global default + per-group overrides (key = phoneKey).
  const [dupDefault, setDupDefault] = useState<DuplicateAction>('skip');
  const [dupOverrides, setDupOverrides] = useState<Record<string, DuplicateAction>>({});

  // ─── Permission gate ──────────────────────────────────────────────────────
  const canImport = !!user && (user.role === 'director' || user.role === 'admin' || user.role === 'superadmin');

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
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err instanceof Error ? err.message : 'Не удалось получить предпросмотр');
      toast.error(msg);
    } finally {
      setPreviewing(false);
    }
  }

  async function runConfirm() {
    if (!preview) return;
    if (!window.confirm('Импортировать данные в систему? Это действие сохранит клиентов и авто в вашей базе.')) {
      return;
    }
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
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err instanceof Error ? err.message : 'Не удалось выполнить импорт');
      toast.error(msg);
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
        ['Магомедов Магомед', '89887654321', 'В456ЕК05', 'Lada Priora', ''],
        ['Петров Пётр', '9001112233', '', '', 'Клиент без авто — можно оставить госномер пустым'],
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
      ws['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 44 }];
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

  if (!canImport) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Импорт клиентов и автомобилей</h1>
        <p className="text-gray-500">Импорт доступен только директору, администратору или владельцу сервиса.</p>
      </div>
    );
  }

  if (isMobileViewport) {
    return (
      <div className="max-w-md mx-auto py-12 px-4 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
          <FileSpreadsheet className="h-8 w-8 text-primary-600" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Откройте на компьютере</h1>
        <p className="text-sm text-gray-500 mb-6">
          Импорт больших Excel/CSV-файлов с сопоставлением колонок неудобен на телефоне. Откройте Autexa на ноутбуке или
          ПК — там этот раздел появится в «Клиентах».
        </p>
        <button onClick={() => navigate('/clients')} className="btn-primary inline-flex">
          <ArrowLeft className="w-4 h-4" />
          Назад к клиентам
        </button>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/clients')}
            className="p-2 -ml-2 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100"
            title="Назад"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="page-title mb-0">Импорт клиентов и авто</h1>
            <p className="text-sm text-gray-500">Excel/CSV → клиенты и их автомобили</p>
          </div>
        </div>
        <button
          onClick={downloadTemplate}
          className="btn-secondary"
          title="Excel-файл с колонками: имя, телефон, госномер, марка и модель, комментарий"
        >
          <Download className="w-4 h-4" />
          Скачать шаблон (Excel)
        </button>
      </div>

      {/* Stepper */}
      <div className="mb-6 grid grid-cols-4 gap-2">
        {(['upload', 'mapping', 'preview', 'done'] as Step[]).map((s, i) => {
          const labels: Record<Step, string> = {
            upload: '1. Загрузка',
            mapping: '2. Колонки',
            preview: '3. Проверка',
            done: '4. Готово',
          };
          const isCurrent = step === s;
          const isPast =
            (step === 'mapping' && i === 0) || (step === 'preview' && i <= 1) || (step === 'done' && i <= 2);
          return (
            <div
              key={s}
              className={`text-xs font-semibold rounded-lg px-3 py-2 text-center border ${
                isCurrent
                  ? 'bg-primary-600 text-white border-primary-600'
                  : isPast
                    ? 'bg-primary-50 text-primary-700 border-primary-200'
                    : 'bg-gray-50 text-gray-400 border-gray-100'
              }`}
            >
              {labels[s]}
            </div>
          );
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
            <FileSpreadsheet className="h-8 w-8 text-primary-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Загрузите файл с клиентами и авто</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Excel (.xlsx, .xls) или CSV. Один телефон с разными госномерами — это один клиент с несколькими авто.
            Сотрудников/пользователей не импортируем.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleFileChange}
          />
          <button onClick={() => fileInputRef.current?.click()} className="btn-primary inline-flex">
            <Upload className="w-4 h-4" />
            Выбрать файл
          </button>
          <div className="mt-6 text-xs text-gray-400">
            Проще всего — скачать шаблон Excel (кнопка сверху) и вставить данные в колонки: имя, телефон, госномер,
            марка и модель, комментарий. Если названия колонок другие — на следующем шаге сопоставите вручную.
          </div>
        </div>
      )}

      {/* Step 2: Mapping */}
      {step === 'mapping' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Сопоставьте колонки</h2>
              <p className="text-sm text-gray-500">
                Файл «{fileName}» — найдено {rawRows.length.toLocaleString('ru-RU')} строк, {headers.length} колонок.
              </p>
            </div>
            <button onClick={reset} className="btn-secondary">
              <RefreshCw className="w-4 h-4" />
              Другой файл
            </button>
          </div>

          <div className="space-y-3">
            {FIELD_ORDER.map((field) => {
              const required = field === 'clientName' || field === 'phone';
              return (
                <div key={field} className="grid grid-cols-1 md:grid-cols-3 items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">
                    {FIELD_LABELS[field]} {required && <span className="text-red-500">*</span>}
                  </label>
                  <div className="md:col-span-2">
                    <select
                      value={columnMap[field]}
                      onChange={(e) => setColumnMap((prev) => ({ ...prev, [field]: parseInt(e.target.value, 10) }))}
                      className="input"
                    >
                      <option value={-1}>— не использовать —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `(колонка ${i + 1})`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sample preview */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Первые 5 строк (как мы их прочитали)</h3>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {FIELD_ORDER.map((f) => (
                      <th key={f} className="text-left px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                        {FIELD_LABELS[f]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rawRows.slice(0, 5).map((row, ri) => (
                    <tr key={ri} className="hover:bg-gray-50">
                      {FIELD_ORDER.map((f) => {
                        const idx = columnMap[f];
                        const val = idx >= 0 ? String(row[idx] ?? '') : '';
                        return (
                          <td key={f} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate">
                            {val || <span className="text-gray-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={allowForeignPlates}
                onChange={(e) => setAllowForeignPlates(e.target.checked)}
                className="rounded border-gray-300"
              />
              Импортировать иностранные/нестандартные номера (с предупреждением)
            </label>
            <button type="button" onClick={runPreview} disabled={previewing} className="btn-primary">
              {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {previewing ? 'Проверяем…' : 'Проверить и показать предпросмотр'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && previewing && <LoadingSpinner />}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<FileSpreadsheet className="w-5 h-5" />}
              color="bg-blue-50 text-blue-700"
              label="Всего строк"
              value={preview.summary.totalRows}
            />
            <SummaryCard
              icon={<Users className="w-5 h-5" />}
              color="bg-emerald-50 text-emerald-700"
              label="Клиентов будет"
              value={`${preview.summary.clientsWillCreate} новых · ${preview.summary.clientsWillReuse} есть`}
            />
            <SummaryCard
              icon={<CarIcon className="w-5 h-5" />}
              color="bg-indigo-50 text-indigo-700"
              label="Авто"
              value={`${preview.summary.carsWillCreate} новых · ${preview.summary.carsAlreadyExist} есть`}
            />
            <SummaryCard
              icon={<XCircle className="w-5 h-5" />}
              color="bg-rose-50 text-rose-700"
              label="Пропущено"
              value={`${preview.summary.rowsSkipped} (ошибки: ${preview.summary.errors})`}
            />
          </div>

          {/* Duplicates: «Заменить» / «Пропустить» decisions */}
          {duplicateGroups.length > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    Уже есть в базе: {duplicateGroups.length} {duplicateGroups.length === 1 ? 'клиент' : 'клиентов'}
                  </h3>
                  <p className="text-sm text-gray-500 max-w-2xl">
                    «Заменить» — обновить имя и комментарий существующего клиента данными из файла и добавить его новые
                    авто. Клиент не удаляется: история (заказ-наряды, долги, бонусы) сохраняется. «Пропустить» —
                    оставить запись в базе без изменений.
                  </p>
                </div>
                <div
                  className="flex rounded-xl border border-gray-200 overflow-hidden shrink-0"
                  role="group"
                  aria-label="Действие для всех дублей"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDupDefault('replace');
                      setDupOverrides({});
                    }}
                    className={`px-3 py-2 text-xs font-semibold ${
                      dupDefault === 'replace' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Заменить все
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDupDefault('skip');
                      setDupOverrides({});
                    }}
                    className={`px-3 py-2 text-xs font-semibold border-l border-gray-200 ${
                      dupDefault === 'skip' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Пропустить все
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-96 overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">В файле</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">Уже в базе</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">Новых авто</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-700">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {duplicateGroups.map((g) => {
                      const effective = dupOverrides[g.phoneKey] ?? dupDefault;
                      const newCars = g.cars.filter(
                        (c) => !c.existsForCurrentClient && !c.conflictsWithClientId,
                      ).length;
                      return (
                        <tr key={g.phoneKey} className={effective === 'replace' ? 'bg-primary-50/40' : undefined}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">
                              {g.fileFullName || <span className="text-gray-400">без имени</span>}
                            </div>
                            <div className="font-mono text-xs text-gray-500">{g.phoneDisplay || g.phoneKey}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{g.existingClientName || 'Клиент'}</div>
                            <div className="font-mono text-xs text-gray-500">
                              {displayPhone(g.existingClientPhone) || g.phoneDisplay || g.phoneKey}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{newCars > 0 ? `+${newCars}` : '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <select
                              value={effective}
                              onChange={(e) =>
                                setDupOverrides((prev) => ({
                                  ...prev,
                                  [g.phoneKey]: e.target.value as DuplicateAction,
                                }))
                              }
                              className="input !w-auto text-xs py-1"
                              aria-label={`Действие для ${g.existingClientName || g.phoneKey}`}
                            >
                              <option value="replace">Заменить</option>
                              <option value="skip">Пропустить</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Plate conflicts — cars owned by ANOTHER client are never re-attached */}
          {plateConflicts.length > 0 && (
            <div className="bg-white rounded-2xl border border-rose-200 shadow-sm p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-1">
                Госномер уже у другого клиента: {plateConflicts.length}
              </h3>
              <p className="text-sm text-gray-500 mb-3">
                Эти авто прикреплены к другим клиентам и не будут перенесены или продублированы — строки пропускаются.
              </p>
              <div className="max-h-48 overflow-auto rounded-lg bg-gray-50 px-3 py-2 space-y-1 text-xs">
                {plateConflicts.map((p, i) => (
                  <div key={i} className="text-gray-600">
                    <span className="font-mono text-gray-400">#{p.sourceRow}</span> · Госномер{' '}
                    <span className="font-mono">{p.plate}</span> (в файле — {p.groupName}) уже у клиента «{p.owner}»
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Issue groups */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
            <IssueGroup
              title="Пропущенные строки"
              icon={<XCircle className="w-5 h-5 text-rose-600" />}
              total={preview.skippedRows.length}
              by={skippedByKind}
              tone="error"
            />
            <IssueGroup
              title="Предупреждения"
              icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
              total={preview.issues.filter((i) => SEVERITY[i.kind] === 'warning').length}
              by={issuesByKind}
              filter={(k) => SEVERITY[k] === 'warning'}
              tone="warning"
            />
            <IssueGroup
              title="Ошибки уровня строки"
              icon={<XCircle className="w-5 h-5 text-rose-600" />}
              total={preview.issues.filter((i) => SEVERITY[i.kind] === 'error').length}
              by={issuesByKind}
              filter={(k) => SEVERITY[k] === 'error'}
              tone="error"
            />
          </div>

          {/* Sample of grouped clients */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Первые 20 клиентов после группировки</h3>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Имя</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Телефон</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Статус</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Авто</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.groups.slice(0, 20).map((g) => (
                    <tr key={g.phoneKey}>
                      <td className="px-3 py-2 font-medium text-gray-900">{g.fullName}</td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{g.phoneDisplay || g.phoneKey}</td>
                      <td className="px-3 py-2 text-xs">
                        {g.existingClientId ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            Уже есть
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            Будет создан
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {g.cars.length === 0 ? (
                          <span className="text-gray-400">нет авто</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {g.cars.map((c, i) => (
                              <span
                                key={i}
                                className={`inline-block px-2 py-0.5 rounded-md font-mono text-[10px] ${
                                  c.conflictsWithClientId
                                    ? 'bg-rose-50 text-rose-700'
                                    : c.existsForCurrentClient
                                      ? 'bg-amber-50 text-amber-700'
                                      : c.isForeign
                                        ? 'bg-violet-50 text-violet-700'
                                        : 'bg-emerald-50 text-emerald-700'
                                }`}
                                title={`${c.makeModel}${c.rawModel ? ` (raw: ${c.rawModel})` : ''}`}
                              >
                                {c.plateDisplay}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.groups.length > 20 && (
              <p className="text-xs text-gray-400 mt-2">… и ещё {preview.groups.length - 20} клиентов</p>
            )}
          </div>

          {/* Actions */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-gray-600">
              Проверьте предупреждения{duplicateGroups.length > 0 ? ' и решения по дублям выше' : ''}. После
              «Подтвердить импорт» данные будут записаны в базу. Дубликаты не создаются
              {duplicateGroups.length > 0 ? ' — по каждому сработает выбранное действие' : ''}.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('mapping')} className="btn-secondary">
                <ArrowLeft className="w-4 h-4" />
                Изменить колонки
              </button>
              <button onClick={runConfirm} disabled={confirming} className="btn-primary">
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {confirming ? 'Импортируем…' : 'Подтвердить импорт'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && result && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Импорт завершён</h2>
          <p className="text-sm text-gray-500 mb-6">Запись в журнал импорта: {result.importRunId}</p>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-4xl mx-auto mb-6">
            <SummaryCard
              icon={<Users className="w-5 h-5" />}
              color="bg-emerald-50 text-emerald-700"
              label="Создано клиентов"
              value={result.summary.clientsWillCreate}
            />
            <SummaryCard
              icon={<RefreshCw className="w-5 h-5" />}
              color="bg-blue-50 text-blue-700"
              label="Заменено (обновлено)"
              value={result.summary.clientsReplaced ?? 0}
            />
            <SummaryCard
              icon={<Users className="w-5 h-5" />}
              color="bg-amber-50 text-amber-700"
              label="Дублей пропущено"
              value={result.summary.duplicatesSkipped ?? 0}
            />
            <SummaryCard
              icon={<CarIcon className="w-5 h-5" />}
              color="bg-indigo-50 text-indigo-700"
              label="Создано авто"
              value={result.summary.carsWillCreate}
            />
            <SummaryCard
              icon={<XCircle className="w-5 h-5" />}
              color="bg-rose-50 text-rose-700"
              label="Пропущено строк"
              value={result.summary.rowsSkipped}
            />
          </div>

          {result.skipped.length > 0 && (
            <details className="text-left max-w-3xl mx-auto bg-gray-50 rounded-xl border border-gray-100 p-4 mb-6">
              <summary className="cursor-pointer font-medium text-gray-700">
                Подробнее по пропущенным ({result.skipped.length})
              </summary>
              <div className="mt-3 max-h-72 overflow-auto text-xs space-y-1">
                {result.skipped.map((s, i) => (
                  <div key={i} className="text-gray-600">
                    <span className="font-mono text-gray-400">#{s.sourceRow}</span> · [{issueLabel(s.reason)}]{' '}
                    {s.message}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-center gap-2">
            <button onClick={reset} className="btn-secondary">
              <Upload className="w-4 h-4" />
              Импортировать ещё файл
            </button>
            <button onClick={() => navigate('/clients')} className="btn-primary">
              <Users className="w-4 h-4" />
              Перейти к клиентам
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small bits ──────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  color,
  label,
  value,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className={`inline-flex items-center justify-center h-9 w-9 rounded-xl ${color} mb-2`}>{icon}</div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function IssueGroup({
  title,
  icon,
  total,
  by,
  filter,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  total: number;
  by: Map<
    ImportIssueKind,
    Array<{ sourceRow: number; message: string; kind?: ImportIssueKind; reason?: ImportIssueKind }>
  >;
  filter?: (k: ImportIssueKind) => boolean;
  tone: 'error' | 'warning';
}) {
  const entries = Array.from(by.entries()).filter(([k]) => (filter ? filter(k) : true));
  if (total === 0) {
    return (
      <div className="px-5 py-4 flex items-center justify-between text-sm text-gray-400">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-gray-700">{title}</span>
        </div>
        <span>—</span>
      </div>
    );
  }
  return (
    <details className="px-5 py-4">
      <summary className="cursor-pointer flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {icon}
          <span className={`font-medium ${tone === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>{title}</span>
          <span className="text-xs text-gray-400">{total}</span>
        </div>
      </summary>
      <div className="mt-3 space-y-2">
        {entries.map(([kind, items]) => (
          <div key={kind} className="text-xs">
            <div className="font-semibold text-gray-700 mb-1">
              {issueLabel(kind)} <span className="text-gray-400">({items.length})</span>
            </div>
            <div className="max-h-48 overflow-auto rounded-lg bg-gray-50 px-3 py-2 space-y-1">
              {items.slice(0, 50).map((it, i) => (
                <div key={i} className="text-gray-600">
                  <span className="font-mono text-gray-400">#{it.sourceRow}</span> · {it.message}
                </div>
              ))}
              {items.length > 50 && <div className="text-gray-400">… и ещё {items.length - 50}</div>}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
