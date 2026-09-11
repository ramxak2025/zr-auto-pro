import { Inject, Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { ClientsService } from '../clients/clients.service';
import { normalizePhone, phoneSearchKey } from '../common/normalize-phone';
import { normalizePlate } from './normalize-plate';
import { ImportRowInputDto } from './dto/import-clients-cars.dto';

// ─── Issue codes (kept in sync with shared/api/types.ts ImportIssueKind) ────
// `duplicate_phone` is backend-additive: older web bundles render unknown
// kinds via the `ISSUE_LABELS[kind] || kind` fallback, so it is safe to emit.
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
  | 'name_conflict_same_phone'
  | 'duplicate_phone';

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
  /**
   * Group identity = last-10-digit national phone key (mirrors
   * `phoneSearchKey` / migration 104/108). Decisions reference this key.
   */
  phoneKey: string;
  /** Canonical phone as it will be stored: «+7 (988) 444-44-85». */
  phoneDisplay: string;
  fullName: string;
  /** 'duplicatePhone' when a client with the same phone key already exists. */
  kind: 'new' | 'duplicatePhone';
  existingClientId: string | null;
  existingClientName: string | null;
  existingClientPhone: string | null;
  /** Name/comment as provided by the FILE (used by «Заменить»). */
  fileFullName: string | null;
  fileComment: string | null;
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
  /** Confirm-only: duplicates updated in place («Заменить»). */
  clientsReplaced?: number;
  /** Confirm-only: duplicates left untouched («Пропустить»). */
  duplicatesSkipped?: number;
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
  /** Clients updated in place by a «Заменить» decision. */
  replacedClientIds: string[];
  skipped: SkippedRow[];
}

export interface DuplicateDecisions {
  /** Fallback for duplicate groups without an explicit decision. */
  defaultAction?: 'replace' | 'skip';
  decisions?: Array<{ phoneKey: string; action: 'replace' | 'skip' }>;
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

// Format-agnostic phone key expression — the SAME expression the rest of the
// app dedups/searches on (clients.service, migrations 104 + 108's
// uq_clients_tenant_phone_key). Mirrors `phoneSearchKey` in JS.
const PHONE_KEY_SQL = `right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)`;

/**
 * Canonical STORED phone form — mirrors what the rest of the app writes:
 * the web/mobile client forms run the number through formatPhone
 * (shared/validation/phone.ts) and ClientsService.create stores that string
 * verbatim, i.e. «+7 (988) 444-44-85». Russian numbers (11 digits starting
 * with 7 after the 8→7 conversion, or bare 10-digit nationals) get that
 * exact shape; anything else (foreign / unusual length) is stored compact:
 * «+995555111222». Matching is key-based either way — this only makes the
 * stored form uniform.
 */
function canonicalStoredPhone(raw: string): string {
  const normalized = normalizePhone(raw || ''); // '+' + digits, 8→7 for 11-digit RU
  const digits = normalized.replace(/\D/g, '');
  const national = digits.length === 11 && digits[0] === '7' ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (national) {
    return `+7 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8, 10)}`;
  }
  return normalized;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger('ImportsService');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    // 161 — «на каком филиале виден клиент» решает ОДИН источник
    // (ClientsService.separatePointFor), а не копия правила в импорте.
    private readonly clients: ClientsService,
  ) {}

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
    actorPoint?: string | null,
  ): Promise<PlanResult> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException({ message: 'Нет строк для импорта' });
    }
    return this.planImport(tenantID, rows, options, await this.clients.separatePointFor(tenantID, actorPoint));
  }

  // ─── Confirm ──────────────────────────────────────────────────────────────
  async confirm(
    tenantID: string,
    userId: string | undefined,
    rows: ImportRowInputDto[],
    options: { allowForeignPlates: boolean },
    duplicates?: DuplicateDecisions,
    // 163 — филиал приезжает ОТДЕЛЬНЫМ аргументом: userId здесь ещё и автор
    // импорта (пишется в карточку), и одним полем эти две роли не покрыть.
    actorPoint?: string | null,
  ): Promise<ConfirmResult> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException({ message: 'Нет строк для импорта' });
    }

    // 161 — филиал автора: новые клиенты рождаются на нём, а карточки чужих
    // филиалов не должны попадать ни в переиспользование, ни в сообщения.
    // 163 — это филиал СЕССИИ автора, из токена.
    const separatePoint = await this.clients.separatePointFor(tenantID, actorPoint);

    // Re-plan from scratch — never trust client-side preview.
    const plan = await this.planImport(tenantID, rows, options, separatePoint);

    // Duplicate handling mode:
    //  - legacy (no decisions at all): old behaviour — reuse the existing
    //    client silently and attach its new cars (keeps an already-open older
    //    web bundle working);
    //  - decisions: per-group «replace» (update-in-place) / «skip» (untouched)
    //    with `duplicateDefault` as the fallback.
    const legacyMode = !duplicates || (duplicates.defaultAction === undefined && duplicates.decisions === undefined);
    const defaultAction: 'replace' | 'skip' = duplicates?.defaultAction ?? 'skip';
    // When an explicit decisions array is provided (the web UI always sends
    // one entry per duplicate it SHOWED), it is authoritative: a duplicate
    // that is NOT in the list appeared between dry-run and apply — the user
    // never reviewed it, so it must never be overwritten (skip + count),
    // even when duplicateDefault = 'replace'.
    const hasExplicitDecisions = Array.isArray(duplicates?.decisions);
    const decisionByKey = new Map<string, 'replace' | 'skip'>();
    for (const d of duplicates?.decisions ?? []) decisionByKey.set(d.phoneKey, d.action);

    const createdClientIds: string[] = [];
    const reusedClientIds: string[] = [];
    const replacedClientIds: string[] = [];
    const createdCarIds: string[] = [];
    const skippedAtConfirm: SkippedRow[] = [];

    const dbClient = await this.pool.connect();
    try {
      await dbClient.query('BEGIN');

      for (const group of plan.groups) {
        let clientId = group.existingClientId;

        if (clientId) {
          // Duplicate detected by the confirm-time re-plan.
          if (legacyMode) {
            reusedClientIds.push(clientId);
          } else {
            const explicit = decisionByKey.get(group.phoneKey);
            const unseen = hasExplicitDecisions && explicit === undefined;
            const action = explicit ?? (unseen ? 'skip' : defaultAction);
            if (action === 'skip') {
              skippedAtConfirm.push({
                sourceRow: group.sourceRows[0],
                reason: 'duplicate_phone',
                message: unseen
                  ? `Клиент с телефоном ${group.phoneDisplay} появился в базе во время импорта — пропущен`
                  : `Клиент «${group.existingClientName || ''}» (${group.phoneDisplay}) уже есть в базе — пропущен по вашему выбору`,
              });
              continue; // fully untouched: no field updates, no cars
            }
            // «Заменить» = UPDATE-IN-PLACE. Same id — checks / долги / бонусы
            // keep pointing at the client. Only overwrite what the file
            // actually provides; also canonicalize the stored phone (same
            // last-10 key, so uq_clients_tenant_phone_key is unaffected).
            const { rowCount } = await dbClient.query(
              `UPDATE clients
                  SET full_name = COALESCE(NULLIF($1, ''), full_name),
                      comment   = COALESCE(NULLIF($2, ''), comment),
                      phone     = $3
                WHERE id = $4 AND tenant_id = $5`,
              [group.fileFullName || '', group.fileComment || '', group.phoneDisplay, clientId, tenantID],
            );
            if (rowCount === 0) {
              // Client vanished between plan and txn — recreate it below.
              clientId = null;
            } else {
              replacedClientIds.push(clientId);
            }
          }
        }

        if (!clientId) {
          // Re-check inside the transaction — concurrent inserts could exist.
          // Key-based (mig 104/108): a client stored as «+7 (988) 444-44-85»
          // must be found for the file's «89884444485».
          // 161 — перепроверка тем же предикатом видимости, что и планирование:
          // клиент, появившийся во время импорта НА ЧУЖОМ филиале, не должен
          // быть переиспользован (машины уехали бы в невидимую карточку).
          const existingParams: unknown[] = [tenantID, group.phoneKey];
          const existingPointWhere = this.clients.separatePointWhere(null, separatePoint, existingParams);
          const { rows: existing } = await dbClient.query(
            `SELECT id, full_name, phone FROM clients
             WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = $2${existingPointWhere} LIMIT 1`,
            existingParams,
          );
          if (existing.length > 0) {
            // Appeared after the dry-run — the user never reviewed this
            // duplicate, so never overwrite it: count as a duplicate-skip.
            if (legacyMode) {
              clientId = existing[0].id as string;
              reusedClientIds.push(clientId);
            } else {
              skippedAtConfirm.push({
                sourceRow: group.sourceRows[0],
                reason: 'duplicate_phone',
                message: `Клиент с телефоном ${group.phoneDisplay} появился в базе во время импорта — пропущен`,
              });
              continue;
            }
          } else {
            const inserted = await this.insertClientWithSavepoint(dbClient, {
              tenantID,
              fullName: group.fullName || 'Клиент',
              phone: group.phoneDisplay,
              comment: group.fileComment,
              pointId: separatePoint,
            });
            if (!inserted) {
              // Race between dry-run and apply: uq_clients_tenant_phone_key
              // fired (23505). Graceful: count as duplicate-skip, keep going.
              skippedAtConfirm.push({
                sourceRow: group.sourceRows[0],
                reason: 'duplicate_phone',
                message: `Клиент с телефоном ${group.phoneDisplay} появился в базе во время импорта — пропущен`,
              });
              continue;
            }
            clientId = inserted;
            createdClientIds.push(clientId);
          }
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
            // Store the canonical plate key without spaces / separators.
            // Display formatting happens in the UI; the DB stores the compact
            // form so search / dedup / API responses are uniform.
            [car.plateKey || car.plateDisplay, car.makeModel, comment, clientId, tenantID],
          );
          createdCarIds.push(insCar[0].id);
        }
      }

      // Audit row.
      const skippedCount = plan.skippedRows.length + skippedAtConfirm.length;
      const duplicatesSkipped = skippedAtConfirm.filter((s) => s.reason === 'duplicate_phone').length;
      const auditPayload = {
        skipped: [...plan.skippedRows, ...skippedAtConfirm],
        issues: plan.issues,
        options,
        duplicates: legacyMode
          ? { mode: 'legacy' }
          : {
              mode: 'decisions',
              defaultAction,
              explicitDecisions: decisionByKey.size,
              replaced: replacedClientIds.length,
              skipped: duplicatesSkipped,
            },
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
          // The audit column counts every existing client the run touched or
          // deliberately attached to — reused (legacy) + replaced.
          reusedClientIds.length + replacedClientIds.length,
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
        clientsWillReuse: reusedClientIds.length + replacedClientIds.length,
        carsWillCreate: createdCarIds.length,
        rowsSkipped: skippedCount,
        clientsReplaced: replacedClientIds.length,
        duplicatesSkipped,
      };

      return {
        importRunId,
        summary,
        createdClientIds,
        createdCarIds,
        reusedClientIds,
        replacedClientIds,
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

  /**
   * INSERT a client behind a SAVEPOINT so a unique-violation on
   * uq_clients_tenant_phone_key (a dry-run → apply race) rolls back just this
   * statement instead of poisoning the whole import transaction.
   * Returns the new client id, or null when the phone key already exists.
   */
  private async insertClientWithSavepoint(
    db: PoolClient,
    params: {
      tenantID: string;
      fullName: string;
      phone: string;
      comment: string | null;
      /** 161 — филиал автора импорта (раздельный режим); null = общая база. */
      pointId: string | null;
    },
  ): Promise<string | null> {
    await db.query('SAVEPOINT sp_import_client');
    try {
      const { rows } = await db.query(
        `INSERT INTO clients (full_name, phone, comment, tenant_id, point_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [params.fullName, params.phone, params.comment, params.tenantID, params.pointId],
      );
      await db.query('RELEASE SAVEPOINT sp_import_client');
      return rows[0].id as string;
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT sp_import_client');
      const e = err as { code?: string; constraint?: string };
      if (e?.code === '23505' && e?.constraint === 'uq_clients_tenant_phone_key') {
        return null;
      }
      throw err;
    }
  }

  // ─── Core: build plan from rows + tenant state ────────────────────────────
  private async planImport(
    tenantID: string,
    rows: ImportRowInputDto[],
    options: { allowForeignPlates: boolean },
    separatePoint: string | null = null,
  ): Promise<PlanResult> {
    const issues: RowIssue[] = [];
    const skippedRows: SkippedRow[] = [];

    // Step 1: per-row classification.
    interface ClassifiedRow {
      sourceRow: number;
      /** Last-10-digit national key — group identity + DB dedup key. */
      phoneKey: string;
      /** Canonical stored form: «+7 (988) 444-44-85». */
      phoneCanonical: string;
      clientName: string;
      clientComment: string | null;
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
        // Group by the last-10 key so «79884444485», «89884444485» and
        // «9884444485» collapse into ONE group — the same identity the DB
        // unique index (migration 108) enforces. Grouping by the full
        // normalized string used to split those into separate groups and
        // the second INSERT then blew up the whole transaction with 23505.
        phoneKey: phoneSearchKey(phoneInput),
        phoneCanonical: canonicalStoredPhone(phoneInput),
        clientName: normalizeClientName(row.clientName),
        clientComment: (row.clientComment || '').trim() || null,
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
    // Match by the last-10-digit key — clients created through the web form
    // are stored as «+7 (988) 444-44-85», so the old exact `phone = '+7…'`
    // compare missed them (and the INSERT then collided with
    // uq_clients_tenant_phone_key). Uses idx_clients_phone_core (mig 104).
    const phoneKeys = Array.from(byPhone.keys());
    const { rows: existingClients } = await this.pool.query<{
      id: string;
      full_name: string;
      phone: string;
      key: string;
      point_id: string | null;
    }>(
      `SELECT id, full_name, phone, point_id, ${PHONE_KEY_SQL} AS key
       FROM clients WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = ANY($2::text[])`,
      [tenantID, phoneKeys],
    );
    const existingClientByPhone = new Map<string, { id: string; fullName: string; phone: string }>();
    // 161 — телефоны, занятые карточками ЧУЖОГО филиала (раздельный режим).
    // Уникальный индекс uq_clients_tenant_phone_key тенантный, поэтому такой
    // клиент физически существует, но импортирующему НЕ ВИДЕН. Нельзя ни
    // переиспользовать его (машины уехали бы в невидимую карточку), ни назвать
    // по имени (это и есть утечка чужой базы). Строку честно пропускаем с
    // нейтральным текстом — молчаливое «создано 0» было бы хуже.
    const blockedPhoneKeys = new Set<string>();
    for (const ec of existingClients) {
      const visible = !separatePoint || ec.point_id === null || ec.point_id === separatePoint;
      if (!visible) {
        blockedPhoneKeys.add(ec.key);
        continue;
      }
      existingClientByPhone.set(ec.key, { id: ec.id, fullName: ec.full_name, phone: ec.phone });
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
        owner_point_id: string | null;
        plate_number: string;
        key: string;
      }>(
        `SELECT ca.id, ca.client_id, cl.full_name AS client_name, cl.point_id AS owner_point_id, ca.plate_number,
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
          {
            id: r.id,
            clientId: r.client_id,
            // 161 — владелец с чужого филиала остаётся БЕЗ ИМЕНИ: сообщение
            // «номер уже привязан к клиенту …» иначе выдавало бы ФИО чужой
            // базы любому, кто загрузит файл с этим госномером.
            clientName:
              !separatePoint || r.owner_point_id === null || r.owner_point_id === separatePoint
                ? r.client_name || ''
                : '',
            plateNumber: r.plate_number,
          },
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
      // 161 — номер занят карточкой другого филиала: ни создать (уникальный
      // индекс тенантный), ни переиспользовать (карточка невидима). Честный
      // пропуск с текстом, который объясняет владельцу, что делать.
      if (blockedPhoneKeys.has(phoneKey)) {
        for (const r of rowsForPhone) {
          skippedRows.push({
            sourceRow: r.sourceRow,
            reason: 'duplicate_phone',
            message:
              `Телефон ${r.phoneCanonical} уже занят карточкой другого филиала — строка пропущена. ` +
              'Попросите владельца перевести клиента на ваш филиал или включить общую базу клиентов.',
          });
        }
        continue;
      }
      const allNames = rowsForPhone.map((r) => r.clientName).filter(Boolean);
      const { name: pickedName, multiple } = pickClientName(allNames);
      const existing = existingClientByPhone.get(phoneKey);
      const finalName = existing?.fullName || pickedName || 'Клиент';
      const phoneCanonical = rowsForPhone[0].phoneCanonical;
      const fileComment = rowsForPhone.map((r) => r.clientComment).find((c) => !!c) || null;

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
              // Пустое clientName = владелец с чужого филиала (161): имя не
              // раскрываем, текст остаётся понятным.
              message: existingCar.clientName
                ? `Госномер ${r.plate.display} уже привязан к клиенту "${existingCar.clientName}" — пропущен`
                : `Госномер ${r.plate.display} уже привязан к клиенту другого филиала — пропущен`,
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
        phoneDisplay: phoneCanonical,
        fullName: finalName,
        kind: existing ? 'duplicatePhone' : 'new',
        existingClientId: existing?.id || null,
        existingClientName: existing?.fullName || null,
        existingClientPhone: existing?.phone || null,
        fileFullName: pickedName || null,
        fileComment,
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
