import { Inject, Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { normalizePlate } from './normalize-plate';
import { ImportRowInputDto } from './dto/import-clients-cars.dto';

// ─── Issue codes (kept in sync with shared/api/types.ts ImportIssueKind) ────
type ImportIssueKind =
  | 'no_phone'
  | 'invalid_phone'
  | 'no_name'
  | 'no_plate'
  | 'invalid_plate'
  | 'foreign_plate'
  | 'unclear_car_model'
  | 'plate_belongs_to_other_client'
  | 'duplicate_in_file'
  | 'multiple_name_candidates'
  | 'name_conflict_same_phone';

export interface RowIssue {
  sourceRow: number;
  kind: ImportIssueKind;
  message: string;
  existing?: { clientId?: string; clientName?: string; plateNumber?: string };
}

export interface PlannedCar {
  plateKey: string;
  plateDisplay: string;
  makeModel: string;
  rawModel?: string | null;
  isForeign: boolean;
  sourceRow: number;
  existsForCurrentClient?: boolean;
  conflictsWithClientId?: string | null;
  conflictsWithClientName?: string | null;
}

export interface ClientGroup {
  phoneKey: string;
  fullName: string;
  existingClientId: string | null;
  candidateNames: string[];
  sourceRows: number[];
  cars: PlannedCar[];
}

export interface SkippedRow {
  sourceRow: number;
  reason: ImportIssueKind;
  message: string;
}

export interface PreviewSummary {
  totalRows: number;
  uniqueClients: number;
  clientsWillCreate: number;
  clientsWillReuse: number;
  carsWillCreate: number;
  carsAlreadyExist: number;
  rowsSkipped: number;
  errors: number;
  warnings: number;
}

export interface PlanResult {
  summary: PreviewSummary;
  groups: ClientGroup[];
  issues: RowIssue[];
  skippedRows: SkippedRow[];
}

export interface ConfirmResult {
  importRunId: string;
  summary: PreviewSummary;
  createdClientIds: string[];
  createdCarIds: string[];
  reusedClientIds: string[];
  skipped: SkippedRow[];
}

const UNCLEAR_NOTE_MARKERS = ['unclear_car_model', 'no_car_model', 'unclear'];
const FOREIGN_NOTE_MARKERS = ['foreign_plate', 'foreign'];
const NO_NAME_MARKERS = ['no_name'];
const PLACEHOLDER_MAKE_MODEL = 'Не определено';

function isUnclearModelText(model?: string | null): boolean {
  if (!model) return true;
  const trimmed = model.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    trimmed.includes('необходимо добавить') ||
    trimmed === 'unclear' ||
    trimmed.includes('не определ') ||
    trimmed.includes('unknown')
  );
}

function notesIncludesAny(notes: string | null | undefined, markers: string[]): boolean {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

function pickClientName(rawNames: string[]): { name: string; multiple: boolean } {
  const cleaned = rawNames.map((n) => (n || '').trim()).filter((n) => n.length > 0);
  if (cleaned.length === 0) return { name: '', multiple: false };

  // Frequency map → most common, else first
  const freq = new Map<string, number>();
  for (const n of cleaned) freq.set(n, (freq.get(n) || 0) + 1);
  const entries = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  const multiple = freq.size > 1;
  return { name: top[0], multiple };
}

function normalizeClientName(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // ALL CAPS or all-lowercase → title-case each word; otherwise leave as is
  const isAllCaps = trimmed === trimmed.toUpperCase() && /[А-ЯA-Z]/.test(trimmed);
  const isAllLower = trimmed === trimmed.toLowerCase() && /[а-яa-z]/.test(trimmed);
  if (isAllCaps || isAllLower) {
    return trimmed
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ');
  }
  return trimmed;
}

function isValidNormalizedPhone(phone: string): boolean {
  // Canonical Russian-style number: '+' followed by 10–15 digits.
  // Russian numbers normalize to "+7" + 10 digits = 12 chars total.
  return /^\+\d{10,15}$/.test(phone);
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger('ImportsService');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // ─── Template ─────────────────────────────────────────────────────────────
  getClientsCarsTemplate(): string {
    const header = [
      'source_row',
      'client_name',
      'phone',
      'phone_raw',
      'car_plate',
      'car_model',
      'notes',
      'original_client_text',
    ].join(';');
    const sample = [
      [
        '1',
        'Иванов Иван Иванович',
        '+79991234567',
        '8 (999) 123-45-67',
        'А123АА77',
        'Toyota Camry',
        '',
        'Иванов Иван 89991234567 А123АА77 Тойота камри',
      ].join(';'),
      [
        '2',
        'Иванов Иван Иванович',
        '+79991234567',
        '8 (999) 123-45-67',
        'В456ВВ99',
        'Lada Granta',
        'same_phone_different_plate',
        '',
      ].join(';'),
      ['3', 'Петров Пётр', '', '', 'Е789ЕЕ77', 'Kia Rio', 'no_phone', ''].join(';'),
      ['4', 'Сидоров', '+79007770000', '9007770000', 'Х001ХХ50', '', 'unclear_car_model', ''].join(';'),
      ['5', 'Foreign Driver', '+995555111222', '+995 555 111 222', 'BG-3845-PA', 'BMW 3', 'foreign_plate', ''].join(
        ';',
      ),
    ].join('\n');
    return `${header}\n${sample}\n`;
  }

  // ─── Preview ──────────────────────────────────────────────────────────────
  async preview(
    tenantID: string,
    rows: ImportRowInputDto[],
    options: { allowForeignPlates: boolean },
  ): Promise<PlanResult> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException({ message: 'Нет строк для импорта' });
    }
    return this.planImport(tenantID, rows, options);
  }

  // ─── Confirm ──────────────────────────────────────────────────────────────
  async confirm(
    tenantID: string,
    userId: string | undefined,
    rows: ImportRowInputDto[],
    options: { allowForeignPlates: boolean },
  ): Promise<ConfirmResult> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException({ message: 'Нет строк для импорта' });
    }

    // Re-plan from scratch — never trust client-side preview.
    const plan = await this.planImport(tenantID, rows, options);

    const createdClientIds: string[] = [];
    const reusedClientIds: string[] = [];
    const createdCarIds: string[] = [];
    const skippedAtConfirm: SkippedRow[] = [];

    const dbClient = await this.pool.connect();
    try {
      await dbClient.query('BEGIN');

      for (const group of plan.groups) {
        let clientId = group.existingClientId;

        if (!clientId) {
          // Re-check inside the transaction — concurrent inserts could exist.
          const { rows: existing } = await dbClient.query(
            'SELECT id, full_name FROM clients WHERE tenant_id = $1 AND phone = $2 LIMIT 1',
            [tenantID, group.phoneKey],
          );
          if (existing.length > 0) {
            clientId = existing[0].id as string;
            reusedClientIds.push(clientId);
          } else {
            const { rows: ins } = await dbClient.query(
              `INSERT INTO clients (full_name, phone, comment, tenant_id)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [group.fullName || 'Клиент', group.phoneKey, null, tenantID],
            );
            clientId = ins[0].id as string;
            createdClientIds.push(clientId);
          }
        } else {
          reusedClientIds.push(clientId);
        }

        for (const car of group.cars) {
          // Skip cars that already conflict with another client; they're errors,
          // not creates. Preview already flagged them.
          if (car.conflictsWithClientId && car.conflictsWithClientId !== clientId) {
            skippedAtConfirm.push({
              sourceRow: car.sourceRow,
              reason: 'plate_belongs_to_other_client',
              message:
                `Госномер ${car.plateDisplay} уже привязан к клиенту ${car.conflictsWithClientName || ''}`.trim(),
            });
            continue;
          }
          if (!car.plateKey) {
            // Defensive — preview should have filtered this out.
            skippedAtConfirm.push({
              sourceRow: car.sourceRow,
              reason: 'invalid_plate',
              message: 'Не удалось распознать госномер',
            });
            continue;
          }

          // Re-check by exact plate within this client (case-insensitive on the key).
          const { rows: existingCar } = await dbClient.query(
            `SELECT id, client_id FROM cars
             WHERE tenant_id = $1
               AND REPLACE(REPLACE(REPLACE(UPPER(plate_number), ' ', ''), '-', ''), '/', '') = $2
             LIMIT 1`,
            [tenantID, car.plateKey],
          );

          if (existingCar.length > 0) {
            const owner = existingCar[0].client_id;
            if (owner === clientId) {
              // Same client already has this plate → skip (idempotent).
              continue;
            }
            // Belongs to someone else — surface as skipped, do not steal.
            skippedAtConfirm.push({
              sourceRow: car.sourceRow,
              reason: 'plate_belongs_to_other_client',
              message: `Госномер ${car.plateDisplay} уже привязан к другому клиенту`,
            });
            continue;
          }

          // Build comment: preserve raw model when we substituted a placeholder
          // and forward the foreign-plate hint.
          const commentParts: string[] = [];
          if (
            car.makeModel === PLACEHOLDER_MAKE_MODEL &&
            car.rawModel &&
            car.rawModel.trim() &&
            !isUnclearModelText(car.rawModel)
          ) {
            commentParts.push(`Импорт: модель — ${car.rawModel.trim()}`);
          } else if (car.makeModel === PLACEHOLDER_MAKE_MODEL && car.rawModel && car.rawModel.trim()) {
            commentParts.push(`Импорт: исходная модель — "${car.rawModel.trim()}"`);
          }
          if (car.isForeign) {
            commentParts.push('Импорт: иностранный/нестандартный номер');
          }
          const comment = commentParts.length > 0 ? commentParts.join('; ') : null;

          const { rows: insCar } = await dbClient.query(
            `INSERT INTO cars (plate_number, make_model, comment, client_id, tenant_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [car.plateDisplay || car.plateKey, car.makeModel, comment, clientId, tenantID],
          );
          createdCarIds.push(insCar[0].id);
        }
      }

      // Audit row.
      const skippedCount = plan.skippedRows.length + skippedAtConfirm.length;
      const auditPayload = {
        skipped: [...plan.skippedRows, ...skippedAtConfirm],
        issues: plan.issues,
        options,
      };
      const { rows: runRows } = await dbClient.query(
        `INSERT INTO import_runs
         (tenant_id, user_id, kind, total_rows, created_clients, reused_clients, created_cars, skipped_rows, payload)
         VALUES ($1, $2, 'clients_cars', $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id`,
        [
          tenantID,
          userId || null,
          rows.length,
          createdClientIds.length,
          reusedClientIds.length,
          createdCarIds.length,
          skippedCount,
          JSON.stringify(auditPayload),
        ],
      );
      const importRunId = runRows[0].id;

      await dbClient.query('COMMIT');

      const summary: PreviewSummary = {
        ...plan.summary,
        clientsWillCreate: createdClientIds.length,
        clientsWillReuse: reusedClientIds.length,
        carsWillCreate: createdCarIds.length,
        rowsSkipped: skippedCount,
      };

      return {
        importRunId,
        summary,
        createdClientIds,
        createdCarIds,
        reusedClientIds,
        skipped: [...plan.skippedRows, ...skippedAtConfirm],
      };
    } catch (err) {
      await dbClient.query('ROLLBACK');
      this.logger.error(`confirm import error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка импорта. Изменения отменены.' });
    } finally {
      dbClient.release();
    }
  }

  // ─── Core: build plan from rows + tenant state ────────────────────────────
  private async planImport(
    tenantID: string,
    rows: ImportRowInputDto[],
    options: { allowForeignPlates: boolean },
  ): Promise<PlanResult> {
    const issues: RowIssue[] = [];
    const skippedRows: SkippedRow[] = [];

    // Step 1: per-row classification.
    interface ClassifiedRow {
      sourceRow: number;
      phoneKey: string;
      clientName: string;
      plate: ReturnType<typeof normalizePlate>;
      rawCarModel: string | null;
      makeModel: string;
      isUnclearModel: boolean;
      isForeignPlate: boolean;
      hasPlate: boolean;
    }

    const classified: ClassifiedRow[] = [];

    for (const row of rows) {
      // Phone is the single source of truth for client identity. No phone → skip.
      const phoneInput = row.phone || row.phoneRaw || '';
      const normalized = phoneInput ? normalizePhone(phoneInput) : '';

      if (notesIncludesAny(row.notes, ['no_phone'])) {
        skippedRows.push({
          sourceRow: row.sourceRow,
          reason: 'no_phone',
          message: 'Источник пометил строку как no_phone — пропущена',
        });
        continue;
      }
      if (!phoneInput || !normalized) {
        skippedRows.push({
          sourceRow: row.sourceRow,
          reason: 'no_phone',
          message: 'Не указан телефон — пропущена',
        });
        continue;
      }
      if (!isValidNormalizedPhone(normalized) || notesIncludesAny(row.notes, ['invalid_phone'])) {
        skippedRows.push({
          sourceRow: row.sourceRow,
          reason: 'invalid_phone',
          message: `Невалидный телефон: ${phoneInput}`,
        });
        continue;
      }

      // Plate.
      const plate = normalizePlate(row.carPlate || '');
      const rawCarModel = (row.carModel || '').trim() || null;
      const isUnclearModel = isUnclearModelText(rawCarModel) || notesIncludesAny(row.notes, UNCLEAR_NOTE_MARKERS);
      const isForeignPlate =
        !plate.isEmpty && (plate.mode === 'foreign' || notesIncludesAny(row.notes, FOREIGN_NOTE_MARKERS));

      const hasPlate = !plate.isEmpty;

      // Foreign-plate gate.
      if (hasPlate && isForeignPlate && !options.allowForeignPlates) {
        skippedRows.push({
          sourceRow: row.sourceRow,
          reason: 'foreign_plate',
          message: `Иностранный/нестандартный номер ${plate.display} — пропущен (импорт foreign отключён)`,
        });
        continue;
      }

      // Surface name issues but don't block; we'll resolve later.
      if (!row.clientName?.trim() || notesIncludesAny(row.notes, NO_NAME_MARKERS)) {
        issues.push({
          sourceRow: row.sourceRow,
          kind: 'no_name',
          message: 'Имя клиента не указано или помечено как no_name',
        });
      }

      // Surface plate issues as warnings; no plate is allowed (client w/o car can still be created).
      if (!hasPlate && (row.carPlate || row.carModel)) {
        issues.push({
          sourceRow: row.sourceRow,
          kind: 'invalid_plate',
          message: 'Не удалось распознать госномер — авто не будет создан',
        });
      }
      if (hasPlate && !plate.isValidRussian && !isForeignPlate) {
        // RU-looking but didn't pass full validation.
        issues.push({
          sourceRow: row.sourceRow,
          kind: 'invalid_plate',
          message: `Похож на российский номер, но не прошёл проверку: "${row.carPlate}" → "${plate.display}"`,
        });
      }
      if (hasPlate && isForeignPlate) {
        issues.push({
          sourceRow: row.sourceRow,
          kind: 'foreign_plate',
          message: `Иностранный/нестандартный номер: ${plate.display}`,
        });
      }
      if (hasPlate && isUnclearModel) {
        issues.push({
          sourceRow: row.sourceRow,
          kind: 'unclear_car_model',
          message: `Модель не определена; будет создана как "${PLACEHOLDER_MAKE_MODEL}"`,
        });
      }

      const makeModel = isUnclearModel || !rawCarModel ? PLACEHOLDER_MAKE_MODEL : rawCarModel;

      classified.push({
        sourceRow: row.sourceRow,
        phoneKey: normalized,
        clientName: normalizeClientName(row.clientName),
        plate,
        rawCarModel,
        makeModel,
        isUnclearModel,
        isForeignPlate,
        hasPlate,
      });
    }

    if (classified.length === 0) {
      return {
        summary: {
          totalRows: rows.length,
          uniqueClients: 0,
          clientsWillCreate: 0,
          clientsWillReuse: 0,
          carsWillCreate: 0,
          carsAlreadyExist: 0,
          rowsSkipped: skippedRows.length,
          errors: skippedRows.length,
          warnings: issues.length,
        },
        groups: [],
        issues,
        skippedRows,
      };
    }

    // Step 2: group by phone.
    const byPhone = new Map<string, ClassifiedRow[]>();
    for (const c of classified) {
      const arr = byPhone.get(c.phoneKey) || [];
      arr.push(c);
      byPhone.set(c.phoneKey, arr);
    }

    // Step 3: pre-fetch existing clients/cars for these phones.
    const phoneKeys = Array.from(byPhone.keys());
    const { rows: existingClients } = await this.pool.query<{ id: string; full_name: string; phone: string }>(
      `SELECT id, full_name, phone FROM clients WHERE tenant_id = $1 AND phone = ANY($2::text[])`,
      [tenantID, phoneKeys],
    );
    const existingClientByPhone = new Map<string, { id: string; fullName: string }>();
    for (const ec of existingClients) {
      existingClientByPhone.set(ec.phone, { id: ec.id, fullName: ec.full_name });
    }

    // For plates: collect every plate key we plan to write, then look them up.
    const plateKeys = Array.from(new Set(classified.filter((c) => c.hasPlate && c.plate.key).map((c) => c.plate.key)));
    let existingCarsByPlateKey = new Map<
      string,
      { id: string; clientId: string; clientName: string; plateNumber: string }
    >();
    if (plateKeys.length > 0) {
      const { rows: existingCars } = await this.pool.query<{
        id: string;
        client_id: string;
        client_name: string | null;
        plate_number: string;
        key: string;
      }>(
        `SELECT ca.id, ca.client_id, cl.full_name AS client_name, ca.plate_number,
                REPLACE(REPLACE(REPLACE(UPPER(ca.plate_number), ' ', ''), '-', ''), '/', '') AS key
         FROM cars ca
         LEFT JOIN clients cl ON cl.id = ca.client_id
         WHERE ca.tenant_id = $1
           AND REPLACE(REPLACE(REPLACE(UPPER(ca.plate_number), ' ', ''), '-', ''), '/', '') = ANY($2::text[])`,
        [tenantID, plateKeys],
      );
      existingCarsByPlateKey = new Map(
        existingCars.map((r) => [
          r.key,
          { id: r.id, clientId: r.client_id, clientName: r.client_name || '', plateNumber: r.plate_number },
        ]),
      );
    }

    // Step 4: build groups.
    const groups: ClientGroup[] = [];
    let carsAlreadyExist = 0;
    let carsWillCreate = 0;

    // Track plate keys seen earlier in this same import to flag in-file dupes.
    const seenPlatesInFile = new Map<string, { sourceRow: number; phoneKey: string }>();

    for (const [phoneKey, rowsForPhone] of byPhone) {
      const allNames = rowsForPhone.map((r) => r.clientName).filter(Boolean);
      const { name: pickedName, multiple } = pickClientName(allNames);
      const existing = existingClientByPhone.get(phoneKey);
      const finalName = existing?.fullName || pickedName || 'Клиент';

      if (multiple) {
        const distinctNames = Array.from(new Set(allNames));
        for (const r of rowsForPhone) {
          issues.push({
            sourceRow: r.sourceRow,
            kind: 'multiple_name_candidates',
            message: `На один телефон найдено несколько имён: ${distinctNames.join(' / ')}. Будет использовано: "${finalName}"`,
          });
        }
      }
      if (existing && pickedName && pickedName !== existing.fullName) {
        for (const r of rowsForPhone) {
          if (r.clientName && r.clientName !== existing.fullName) {
            issues.push({
              sourceRow: r.sourceRow,
              kind: 'name_conflict_same_phone',
              message: `Существующий клиент по телефону: "${existing.fullName}". Имя из файла "${r.clientName}" игнорируется.`,
              existing: { clientId: existing.id, clientName: existing.fullName },
            });
          }
        }
      }

      // Per-phone car list, deduped by plateKey.
      const seenInGroup = new Set<string>();
      const cars: PlannedCar[] = [];

      for (const r of rowsForPhone) {
        if (!r.hasPlate || !r.plate.key) continue;

        // Same plate already seen for this same client in this file → silent dedup.
        if (seenInGroup.has(r.plate.key)) {
          // Mark as warning so the user sees we collapsed dupes.
          issues.push({
            sourceRow: r.sourceRow,
            kind: 'duplicate_in_file',
            message: `Госномер ${r.plate.display} уже встречался для этого клиента в файле — повтор пропущен`,
          });
          continue;
        }
        seenInGroup.add(r.plate.key);

        // Same plate already used in another phone group earlier in the file.
        const seenElsewhere = seenPlatesInFile.get(r.plate.key);
        if (seenElsewhere && seenElsewhere.phoneKey !== phoneKey) {
          issues.push({
            sourceRow: r.sourceRow,
            kind: 'duplicate_in_file',
            message: `Госномер ${r.plate.display} встречается в файле у разных клиентов (строки ${seenElsewhere.sourceRow} и ${r.sourceRow}) — для текущего клиента пропущен`,
          });
          continue;
        }
        seenPlatesInFile.set(r.plate.key, { sourceRow: r.sourceRow, phoneKey });

        const existingCar = existingCarsByPlateKey.get(r.plate.key);
        const planned: PlannedCar = {
          plateKey: r.plate.key,
          plateDisplay: r.plate.display,
          makeModel: r.makeModel,
          rawModel: r.rawCarModel,
          isForeign: r.isForeignPlate,
          sourceRow: r.sourceRow,
        };

        if (existingCar) {
          if (existing && existingCar.clientId === existing.id) {
            planned.existsForCurrentClient = true;
            carsAlreadyExist++;
          } else {
            planned.conflictsWithClientId = existingCar.clientId;
            planned.conflictsWithClientName = existingCar.clientName;
            issues.push({
              sourceRow: r.sourceRow,
              kind: 'plate_belongs_to_other_client',
              message: `Госномер ${r.plate.display} уже привязан к клиенту "${existingCar.clientName || ''}" — пропущен`,
              existing: {
                clientId: existingCar.clientId,
                clientName: existingCar.clientName,
                plateNumber: existingCar.plateNumber,
              },
            });
          }
        } else {
          carsWillCreate++;
        }

        cars.push(planned);
      }

      groups.push({
        phoneKey,
        fullName: finalName,
        existingClientId: existing?.id || null,
        candidateNames: Array.from(new Set(allNames)),
        sourceRows: rowsForPhone.map((r) => r.sourceRow),
        cars,
      });
    }

    const clientsWillCreate = groups.filter((g) => !g.existingClientId).length;
    const clientsWillReuse = groups.filter((g) => g.existingClientId).length;
    const errors = skippedRows.length + issues.filter((i) => i.kind === 'plate_belongs_to_other_client').length;

    return {
      summary: {
        totalRows: rows.length,
        uniqueClients: groups.length,
        clientsWillCreate,
        clientsWillReuse,
        carsWillCreate,
        carsAlreadyExist,
        rowsSkipped: skippedRows.length,
        errors,
        warnings: issues.length,
      },
      groups,
      issues,
      skippedRows,
    };
  }
}
