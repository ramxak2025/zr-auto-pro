import { Injectable, Inject, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { userHasPermission } from '../common/guards/permissions.guard';
import { actorPointId, pointCacheSegment, pointFilterSql } from '../common/point-scope';

/**
 * Actor shape (JWT payload subset) needed for the manager-vs-self split.
 * `currentPointId` — филиал СЕССИИ (163): в этом разрезе считается выручка
 * сотрудника, иначе карточка показывала бы деньги всей сети.
 */
type EmployeeActor = {
  userID: string;
  role?: string;
  permissions?: Record<string, boolean>;
  currentPointId?: string | null;
};

// «Менеджер» = держатель матричного ключа 'user_management' (волна «права как
// в Битрикс24», 2026-07; раньше — строковый список director/admin/superadmin):
// может править "private" employee data (KPI targets, owner notes, hire date).
// Остальные по-прежнему правят СВОИ photo + whatsapp (self-ветка не трогается).

// Keys that ONLY a manager can touch on PATCH.
const MANAGER_ONLY_FIELDS = new Set([
  'hireDate',
  'specializations',
  'positionTitle',
  'customTitle',
  'monthlyKpiRevenue',
  'monthlyKpiChecks',
  'ownerNotes',
]);

/** Which heavy aggregates the caller opted into via `?include=`. */
type FullProfileInclude = { heatmap: boolean; timeline: boolean };

/**
 * ЧТО ИМЕННО ВИДИТ ЭТОТ СМОТРЯЩИЙ — решается один раз в fullProfile и едет
 * дальше одним объектом, чтобы правило не расползлось по агрегатам.
 *   pointId     — филиал сессии: в его разрезе считаются ВСЕ денежные и
 *                 чековые агрегаты карточки;
 *   canSeeMoney — право видеть финансы ('profit_view') или «это я сам»;
 *   canSeeNotes — право управления персоналом (личные заметки владельца).
 */
type ProfileView = { pointId: string | null; canSeeMoney: boolean; canSeeNotes: boolean };

/**
 * Parse the raw `?include=` query value (CSV like `heatmap,timeline`) into a
 * resolved include-set. Anything we don't recognise is ignored. `undefined`
 * (no param) → both off, i.e. the LIGHT default profile.
 */
function normalizeInclude(raw?: FullProfileInclude | string | string[]): FullProfileInclude {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { heatmap: !!raw.heatmap, timeline: !!raw.timeline };
  }
  const tokens = new Set<string>();
  const push = (v: string) =>
    v
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .forEach((t) => tokens.add(t));
  if (typeof raw === 'string') push(raw);
  else if (Array.isArray(raw)) raw.forEach((v) => typeof v === 'string' && push(v));
  return { heatmap: tokens.has('heatmap'), timeline: tokens.has('timeline') };
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger('EmployeesService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * КТО ВООБЩЕ ВПРАВЕ СМОТРЕТЬ КАРТОЧКУ СОТРУДНИКА — ОДНО ПРАВИЛО НА ВЕСЬ
   * МОДУЛЬ: держатель 'user_management' ИЛИ сам сотрудник о себе.
   *
   * ЧТО БЫЛО СЛОМАНО (аудит 2026-09). Классовые @UseGuards(JwtAuthGuard,
   * RolesGuard, PermissionsGuard) без @Roles/@RequirePermission на методе
   * пропускают ЛЮБОГО аутентифицированного — оба guard'а по конвенции
   * отвечают «нет требования → пускаем». Поэтому список документов, ВЫДАЧА
   * ФАЙЛА документа (паспорт, трудовой договор) и полный профиль (личные
   * заметки владельца о человеке, выручка за всё время) были открыты всем
   * сотрудникам тенанта. Мастер брал id коллеги из открытого GET /users и
   * скачивал его паспорт.
   *
   * То же правило уже действовало на PATCH /employees/:id и загрузке фото —
   * здесь оно просто перестаёт быть выборочным.
   */
  private assertCanViewEmployee(actor: EmployeeActor, employeeId: string): { isManager: boolean; isSelf: boolean } {
    const isManager = userHasPermission(actor, 'user_management');
    const isSelf = actor.userID === employeeId;
    if (!isManager && !isSelf) {
      throw new ForbiddenException({ message: 'Нет доступа к этому сотруднику' });
    }
    return { isManager, isSelf };
  }

  /** Update an employee's profile fields. Permission split:
   *  - Manager ('user_management' holder) may set any extension field.
   *  - The employee themselves may only update photoUrl + whatsapp on their own row.
   *  Anything outside this matrix is rejected with 403.
   */
  async update(actor: EmployeeActor, tenantID: string, employeeId: string, dto: Record<string, unknown>) {
    const { isManager } = this.assertCanViewEmployee(actor, employeeId);

    const { rows: targetRows } = await this.pool.query('SELECT id FROM users WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      employeeId,
      tenantID,
    ]);
    if (targetRows.length === 0) {
      throw new NotFoundException({ message: 'Сотрудник не найден' });
    }

    // Non-manager actor: drop any disallowed keys silently? No — be strict.
    if (!isManager) {
      for (const k of Object.keys(dto)) {
        if (MANAGER_ONLY_FIELDS.has(k)) {
          throw new ForbiddenException({ message: 'Эти поля может изменить только руководитель' });
        }
      }
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.hireDate !== undefined) {
      sets.push(`hire_date = $${idx++}`);
      vals.push(dto.hireDate ? new Date(String(dto.hireDate)).toISOString().slice(0, 10) : null);
    }
    if (dto.specializations !== undefined) {
      const arr = Array.isArray(dto.specializations)
        ? dto.specializations.filter((x): x is string => typeof x === 'string').slice(0, 30)
        : [];
      sets.push(`specializations = $${idx++}`);
      vals.push(arr);
    }
    if (dto.positionTitle !== undefined) {
      sets.push(`position_title = $${idx++}`);
      vals.push(dto.positionTitle ? String(dto.positionTitle).slice(0, 80) : null);
    }
    if (dto.customTitle !== undefined) {
      sets.push(`custom_title = $${idx++}`);
      vals.push(dto.customTitle ? String(dto.customTitle).slice(0, 80) : null);
    }
    if (dto.monthlyKpiRevenue !== undefined) {
      sets.push(`monthly_kpi_revenue = $${idx++}`);
      vals.push(dto.monthlyKpiRevenue === null ? null : Math.max(0, Number(dto.monthlyKpiRevenue) || 0));
    }
    if (dto.monthlyKpiChecks !== undefined) {
      sets.push(`monthly_kpi_checks = $${idx++}`);
      vals.push(dto.monthlyKpiChecks === null ? null : Math.max(0, Math.floor(Number(dto.monthlyKpiChecks) || 0)));
    }
    if (dto.ownerNotes !== undefined) {
      sets.push(`owner_notes = $${idx++}`);
      vals.push(dto.ownerNotes ? String(dto.ownerNotes).slice(0, 4000) : null);
    }
    if (dto.photoUrl !== undefined) {
      sets.push(`photo_url = $${idx++}`);
      vals.push(dto.photoUrl ? String(dto.photoUrl) : null);
    }
    if (dto.whatsapp !== undefined) {
      sets.push(`whatsapp = $${idx++}`);
      vals.push(dto.whatsapp ? String(dto.whatsapp).slice(0, 32) : null);
    }

    if (sets.length === 0) {
      return this.getProfile(tenantID, employeeId, isManager);
    }

    vals.push(employeeId, tenantID);
    await this.pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}`, vals);

    ttlCache.invalidatePrefix(`employee:${tenantID}:${employeeId}`);
    return this.getProfile(tenantID, employeeId, isManager);
  }

  /**
   * Lightweight profile shape used as the building block for full-profile +
   * update response.
   *
   * `canSeeNotes` — ЛИЧНЫЕ ЗАМЕТКИ ВЛАДЕЛЬЦА О ЧЕЛОВЕКЕ (owner_notes) видит
   * только держатель 'user_management'. Даже сам сотрудник их не видит: это
   * записи руководителя О НЁМ, а не его данные, и правит их тоже только
   * руководитель (MANAGER_ONLY_FIELDS выше). Поле остаётся в ответе всегда
   * (null без права) — форма контракта не меняется.
   */
  async getProfile(tenantID: string, employeeId: string, canSeeNotes = true) {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, role, hire_date, specializations, position_title, custom_title,
              monthly_kpi_revenue, monthly_kpi_checks, owner_notes, photo_url, whatsapp
         FROM users WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [employeeId, tenantID],
    );
    if (rows.length === 0) {
      throw new NotFoundException({ message: 'Сотрудник не найден' });
    }
    const r = rows[0];
    return {
      id: r.id,
      fullName: r.full_name,
      role: r.role,
      hireDate: r.hire_date,
      specializations: Array.isArray(r.specializations) ? r.specializations : [],
      positionTitle: r.position_title,
      customTitle: r.custom_title,
      monthlyKpiRevenue: r.monthly_kpi_revenue !== null ? parseFloat(r.monthly_kpi_revenue) : null,
      monthlyKpiChecks: r.monthly_kpi_checks !== null ? parseInt(r.monthly_kpi_checks) : null,
      ownerNotes: canSeeNotes ? r.owner_notes : null,
      photoUrl: r.photo_url,
      whatsapp: r.whatsapp,
    };
  }

  /**
   * Stream a photo, resize to 512×512, write it out as WebP + JPEG, and
   * persist the URL on the user row. Returns the same shape getProfile does.
   */
  async uploadPhoto(
    actor: EmployeeActor,
    tenantID: string,
    employeeId: string,
    stream: NodeJS.ReadableStream,
    ext: string,
  ) {
    this.assertCanViewEmployee(actor, employeeId);

    const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
    const tenantDir = path.join(uploadDir, tenantID, 'employees');
    fs.mkdirSync(tenantDir, { recursive: true });

    const fileId = uuidv4();
    const tempPath = path.join(tenantDir, `${fileId}.tmp${ext}`);
    const finalPath = path.join(tenantDir, `${fileId}.webp`);

    // Persist the upload to a tmp file first so sharp can read with metadata.
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tempPath);
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      stream.pipe(out);
    });

    try {
      const buffer = fs.readFileSync(tempPath);
      await sharp(buffer)
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(finalPath);
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best-effort
      }
    }

    const photoUrl = `/api/uploads/${tenantID}/employees/${fileId}.webp`;
    await this.pool.query(`UPDATE users SET photo_url=$1 WHERE id=$2 AND tenant_id=$3`, [
      photoUrl,
      employeeId,
      tenantID,
    ]);

    ttlCache.invalidatePrefix(`employee:${tenantID}:${employeeId}`);
    return { photoUrl };
  }

  // ── Documents ───────────────────────────────────────────────────────────
  //
  // employee_documents.file_url holds the on-disk stored path inside the
  // PRIVATE uploads subtree (`private/<tenant>/<uuid>.<ext>`), never a public
  // `/api/uploads/...` capability URL — documents (passports, contracts) must
  // only be reachable through the authenticated, tenant-checked endpoint
  // GET /employees/:id/documents/:docId/file. The mappers below expose that
  // endpoint as `fileUrl` so the API contract shape is unchanged.

  /** Client-facing URL for a document — always the authenticated endpoint. */
  private documentUrl(employeeId: string, docId: string): string {
    return `/api/employees/${employeeId}/documents/${docId}/file`;
  }

  /**
   * Документы сотрудника. ДОСТУП: руководитель ('user_management') или сам
   * сотрудник о себе — обоснование в assertCanViewEmployee. Список сам по себе
   * уже чувствителен: типы и названия документов («Паспорт», «Трудовой
   * договор») плюс id, по которым скачивается файл.
   */
  async listDocuments(actor: EmployeeActor, tenantID: string, employeeId: string) {
    this.assertCanViewEmployee(actor, employeeId);
    const { rows } = await this.pool.query(
      `SELECT id, type, name, file_url, uploaded_at, expires_at
         FROM employee_documents
        WHERE user_id=$1 AND tenant_id=$2
        ORDER BY uploaded_at DESC`,
      [employeeId, tenantID],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      fileUrl: this.documentUrl(employeeId, r.id),
      uploadedAt: r.uploaded_at,
      expiresAt: r.expires_at,
    }));
  }

  /**
   * Resolve a document row to its on-disk stored path (tenant-checked).
   * Tolerates legacy rows that still carry the old `/api/uploads/...` public
   * URL (e.g. bootstrap migration not yet run) by stripping the prefix.
   *
   * ДОСТУП проверяется ЗДЕСЬ, а не в контроллере: это единственный путь к
   * приватному файлу (паспорт, трудовой договор), и правило обязано лежать
   * рядом с чтением, чтобы новый вызывающий не смог обойти его случайно.
   */
  async getDocumentStoredPath(
    actor: EmployeeActor,
    tenantID: string,
    employeeId: string,
    docId: string,
  ): Promise<string> {
    this.assertCanViewEmployee(actor, employeeId);
    const { rows } = await this.pool.query(
      `SELECT file_url FROM employee_documents WHERE id=$1 AND user_id=$2 AND tenant_id=$3 LIMIT 1`,
      [docId, employeeId, tenantID],
    );
    if (rows.length === 0) {
      throw new NotFoundException({ message: 'Документ не найден' });
    }
    const raw: string = rows[0].file_url || '';
    return raw.startsWith('/api/uploads/') ? raw.slice('/api/uploads/'.length) : raw;
  }

  async addDocument(
    tenantID: string,
    employeeId: string,
    body: { type: string; name?: string; storedPath: string; expiresAt?: string | null },
  ) {
    if (!body?.type || !body?.storedPath) {
      throw new BadRequestException({ message: 'Тип и файл обязательны' });
    }
    const { rows } = await this.pool.query(
      `INSERT INTO employee_documents (user_id, tenant_id, type, name, file_url, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, name, file_url, uploaded_at, expires_at`,
      [
        employeeId,
        tenantID,
        String(body.type).slice(0, 60),
        body.name ? String(body.name).slice(0, 200) : null,
        String(body.storedPath),
        body.expiresAt || null,
      ],
    );
    const r = rows[0];
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      fileUrl: this.documentUrl(employeeId, r.id),
      uploadedAt: r.uploaded_at,
      expiresAt: r.expires_at,
    };
  }

  async removeDocument(tenantID: string, employeeId: string, docId: string) {
    const result = await this.pool.query(`DELETE FROM employee_documents WHERE id=$1 AND user_id=$2 AND tenant_id=$3`, [
      docId,
      employeeId,
      tenantID,
    ]);
    if (result.rowCount === 0) {
      throw new NotFoundException({ message: 'Документ не найден' });
    }
    return { message: 'Удалено' };
  }

  // ── Achievements ────────────────────────────────────────────────────────

  async listAchievements(tenantID: string, employeeId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, key, name, description, icon, color, type, awarded_by, awarded_at
         FROM employee_achievements
        WHERE user_id=$1 AND tenant_id=$2
        ORDER BY awarded_at DESC`,
      [employeeId, tenantID],
    );
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      icon: r.icon,
      color: r.color,
      type: r.type,
      awardedBy: r.awarded_by,
      awardedAt: r.awarded_at,
    }));
  }

  async addAchievement(
    tenantID: string,
    actorID: string,
    employeeId: string,
    body: { name?: string; description?: string; icon?: string; color?: string; key?: string },
  ) {
    if (!body?.name) {
      throw new BadRequestException({ message: 'Название достижения обязательно' });
    }
    const key = body.key ?? `custom_${uuidv4().slice(0, 8)}`;
    const { rows } = await this.pool.query(
      `INSERT INTO employee_achievements
         (user_id, tenant_id, key, name, description, icon, color, type, awarded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'custom', $8)
       RETURNING id, key, name, description, icon, color, type, awarded_by, awarded_at`,
      [
        employeeId,
        tenantID,
        key,
        String(body.name).slice(0, 100),
        body.description ? String(body.description).slice(0, 500) : null,
        body.icon ? String(body.icon).slice(0, 60) : null,
        body.color ? String(body.color).slice(0, 30) : null,
        actorID,
      ],
    );
    const r = rows[0];
    ttlCache.invalidatePrefix(`employee:${tenantID}:${employeeId}`);
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      icon: r.icon,
      color: r.color,
      type: r.type,
      awardedBy: r.awarded_by,
      awardedAt: r.awarded_at,
    };
  }

  async removeAchievement(tenantID: string, employeeId: string, achId: string) {
    const result = await this.pool.query(
      `DELETE FROM employee_achievements WHERE id=$1 AND user_id=$2 AND tenant_id=$3`,
      [achId, employeeId, tenantID],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException({ message: 'Достижение не найдено' });
    }
    ttlCache.invalidatePrefix(`employee:${tenantID}:${employeeId}`);
    return { message: 'Удалено' };
  }

  // ── Full profile ────────────────────────────────────────────────────────

  /**
   * Composite endpoint returning everything the employee detail screen needs.
   * Cached for 60s per (tenant, employee, include-set). Invalidated by
   * photo/profile/achievement mutations. Recomputed lazily on cache miss.
   *
   * The two heaviest aggregates — the 365-day `yearHeatmap` GROUP BY and the
   * `careerTimeline` (top-months scan + assembly) — are OPT-IN via `include`.
   * No client renders them by default anymore (the mobile detail screen was
   * trimmed; the web detail page never called this endpoint), so by default
   * we skip that server work entirely and return empty arrays for those two
   * fields. A caller that still wants them passes `?include=heatmap,timeline`.
   *
   * The response SHAPE is unchanged — `yearHeatmap` / `careerTimeline` are
   * always present, just empty when not requested. This keeps old clients that
   * read the fields (without crashing on missing keys) working.
   */
  async fullProfile(
    actor: EmployeeActor,
    tenantID: string,
    employeeId: string,
    include?: FullProfileInclude | string | string[],
  ) {
    // ДОСТУП: руководитель или сам сотрудник. Профиль везёт личные заметки
    // владельца о человеке и его деньги — открытым всем он быть не может.
    const { isManager, isSelf } = this.assertCanViewEmployee(actor, employeeId);

    // ДЕНЬГИ — ОТДЕЛЬНОЕ ПРАВО. Руководитель кадров (user_management) не
    // обязательно допущен к финансам: матрица роли разводит эти ячейки, и
    // выручка сотрудника закрыта тем же ключом, что прибыль в сводке филиалов
    // (`profit_view`). Свои деньги человек видит всегда — он и так видит их на
    // главной и в зарплате.
    const canSeeMoney = isSelf || userHasPermission(actor, 'profit_view');

    // ВЫРУЧКА — В РАЗРЕЗЕ ФИЛИАЛА СЕССИИ, а не по всей сети: карточка мастера
    // в филиале Б обязана показывать то же, что журнал и дашборд этого филиала.
    const pointId = actorPointId(actor);

    // Ключ кеша несёт ВСЁ, что меняет payload: филиал (иначе филиал Б получил
    // бы цифры филиала А), объём прав смотрящего и include-набор. Филиал стоит
    // ПОСЛЕ employeeId сознательно: инвалидация (мутации профиля, фото,
    // достижений) чистит по префиксу `employee:<тенант>:<сотрудник>`, и сегмент
    // перед id вывел бы ключ из-под неё.
    const view: ProfileView = { pointId, canSeeMoney, canSeeNotes: isManager };
    const want = normalizeInclude(include);
    const cacheKey =
      `employee:${tenantID}:${employeeId}:full:${pointCacheSegment(pointId)}` +
      `:${isManager ? 'n' : ''}${canSeeMoney ? 'm' : ''}` +
      `:${want.heatmap ? 'h' : ''}${want.timeline ? 't' : ''}`;
    return ttlCache.wrap(cacheKey, 60_000, () => this.computeFullProfile(tenantID, employeeId, want, view));
  }

  /**
   * Default analytics payload for an existing employee whose heavy aggregates
   * couldn't be computed (DB error / statement timeout on a large tenant).
   * The detail screen MUST still render from the base profile — this returns
   * the same shape as a fully-computed profile but with empty/zero analytics
   * so the FE never shows "сотрудник не найден" for a valid user.
   */
  private emptyAnalytics() {
    return {
      stats: { efficiency: 0, discipline: 100, activity: 0, rating: 0, quality: 50 },
      streaks: { disciplineStreak: 0, fiveStarStreak: 0, checksStreak: 0 },
      lifetime: {
        totalChecks: 0,
        totalRevenue: 0,
        clientsServed: 0,
        bestDay: undefined as { date: string; value: number } | undefined,
        bestMonth: undefined as { ym: string; value: number } | undefined,
        topCarBrands: [] as Array<{ brand: string; count: number }>,
        topProducts: [] as Array<{ productId: string; name: string; count: number; photo?: string }>,
      },
      yearHeatmap: [] as Array<{ day: string; checks: number; revenue: number }>,
      teamRank: { revenueRank: 0, disciplineRank: 0, ratingRank: 0, total: 1 },
      serviceMastery: [] as Array<{
        serviceId: string;
        name: string;
        count: number;
        tier: 'bronze' | 'silver' | 'gold' | 'platinum';
      }>,
      careerTimeline: [] as Array<{
        date: string;
        kind: 'hire' | 'promotion' | 'top_month' | 'custom';
        title: string;
        description?: string;
      }>,
      achievements: [] as Awaited<ReturnType<EmployeesService['listAchievements']>>,
    };
  }

  private async computeFullProfile(
    tenantID: string,
    employeeId: string,
    include: FullProfileInclude,
    view: ProfileView,
  ) {
    // getProfile is the ONLY existence check — it throws 404 for a genuinely
    // missing tenant user and that 404 must propagate. Everything after it is
    // derived analytics; if any of it fails (DB error / statement timeout on a
    // big tenant) we degrade to the base profile + empty analytics rather than
    // 500'ing a valid employee.
    const profile = await this.getProfile(tenantID, employeeId, view.canSeeNotes);

    try {
      return await this.computeAnalytics(tenantID, employeeId, profile, include, view);
    } catch (err) {
      this.logger.error(
        `fullProfile analytics failed for ${employeeId} (returning base profile): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return { profile, ...this.emptyAnalytics() };
    }
  }

  private async computeAnalytics(
    tenantID: string,
    employeeId: string,
    profile: Awaited<ReturnType<EmployeesService['getProfile']>>,
    include: FullProfileInclude,
    view: ProfileView,
  ) {
    // Discipline + activity quick stats (last 30 days).
    //
    // ФИЛИАЛ СЕССИИ РЕЖЕТ ВСЕ ЧЕКОВЫЕ АГРЕГАТЫ КАРТОЧКИ (165). Раньше они
    // считались по ВСЕЙ сети: владелец, зайдя в филиал Б, видел у мастера
    // выручку, заработанную в филиале А, и она не сходилась ни с журналом, ни
    // с дашбордом, ни с зарплатой этого филиала. Предикат — общий
    // pointFilterSql (строгое равенство, см. common/point-scope.ts).
    const monthParams: unknown[] = [tenantID, employeeId];
    const monthPointFilter = pointFilterSql(null, view.pointId, monthParams);
    const { rows: monthAgg } = await this.pool.query(
      `WITH month_checks AS (
         SELECT *
           FROM checks
          WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL
            AND date >= now() - interval '30 days'${monthPointFilter}
       )
       SELECT
         COALESCE(SUM(total_revenue), 0) AS revenue,
         COUNT(*) AS check_count,
         COALESCE(AVG(rr.rating), 0) AS avg_rating
       FROM month_checks
       LEFT JOIN review_responses rr ON rr.check_id = month_checks.id`,
      monthParams,
    );

    const monthRevenue = parseFloat(monthAgg[0]?.revenue) || 0;
    const monthChecks = parseInt(monthAgg[0]?.check_count) || 0;
    const avgRating = parseFloat(monthAgg[0]?.avg_rating) || 0;

    // Discipline = % of last 30 schedule_entries days that were on-time / dayoff.
    // 167 — дни графика режутся филиалом карточки (schedule_entries.point_id),
    // как и все денежные срезы этой карточки.
    const discParams: unknown[] = [employeeId, tenantID];
    const discPointFilter = pointFilterSql(null, view.pointId, discParams);
    const { rows: discRows } = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE late_status IN ('on_time') OR is_day_off = true) AS good,
         COUNT(*) AS total
       FROM schedule_entries
       WHERE user_id=$1 AND tenant_id=$2
         AND date >= (now() - interval '30 days')::date
         AND date <= now()::date${discPointFilter}`,
      discParams,
    );
    const goodDays = parseInt(discRows[0]?.good) || 0;
    const totalDays = parseInt(discRows[0]?.total) || 0;
    const discipline = totalDays > 0 ? Math.round((goodDays / totalDays) * 100) : 100;

    // KPI-driven efficiency: revenue vs target (clamped to 100%)
    const efficiency =
      profile.monthlyKpiRevenue && profile.monthlyKpiRevenue > 0
        ? Math.min(100, Math.round((monthRevenue / profile.monthlyKpiRevenue) * 100))
        : Math.min(100, Math.round(monthRevenue / 1 || 0)); // when no KPI, just show revenue as efficiency=0

    const activity = Math.min(100, Math.round((monthChecks / Math.max(profile.monthlyKpiChecks || 30, 1)) * 100));
    const rating = Math.round(avgRating * 20); // 5 stars → 100%
    const quality = Math.min(100, Math.round(discipline * 0.5 + rating * 0.5));

    // Streaks
    const streaks = await this.computeStreaks(tenantID, employeeId, view.pointId);

    // Lifetime totals + best day / best month + top car brands
    const lifetime = await this.computeLifetime(tenantID, employeeId, view.pointId, view.canSeeMoney);

    // Year heatmap: 365 day buckets. Heavy GROUP BY — only computed when the
    // caller opted in via `?include=heatmap`. Otherwise it stays an empty
    // array and we skip the scan entirely.
    let yearHeatmap: Array<{ day: string; checks: number; revenue: number }> = [];
    if (include.heatmap) {
      const heatParams: unknown[] = [tenantID, employeeId];
      const heatPointFilter = pointFilterSql(null, view.pointId, heatParams);
      const { rows: heat } = await this.pool.query(
        `SELECT date::date AS day, COUNT(*) AS checks, COALESCE(SUM(total_revenue), 0) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL
            AND date >= now() - interval '365 days'${heatPointFilter}
          GROUP BY date::date
          ORDER BY day`,
        heatParams,
      );
      yearHeatmap = heat.map((r) => ({
        day: typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10),
        checks: parseInt(r.checks) || 0,
        // Суммы дня — денежная часть: без права видеть финансы отдаём 0, но
        // саму сетку активности оставляем (она не про деньги).
        revenue: view.canSeeMoney ? parseFloat(r.revenue) || 0 : 0,
      }));
    }

    // Shift / attendance summary — only for tenants with «Смены» enabled (070).
    // When the feature is off we omit the `shifts` key entirely (it's optional
    // in the contract) and skip the schedule scan.
    const { rows: tenantRows } = await this.pool.query(`SELECT shifts_enabled FROM tenants WHERE id=$1 LIMIT 1`, [
      tenantID,
    ]);
    const shiftsEnabled = tenantRows[0]?.shifts_enabled === true;
    const shifts = shiftsEnabled ? await this.computeShifts(tenantID, employeeId, view.pointId) : undefined;

    // Team ranks
    const teamRank = await this.computeTeamRank(tenantID, employeeId, view.pointId);

    // Service mastery (top 5 services)
    const masteryParams: unknown[] = [tenantID, employeeId];
    const masteryPointFilter = pointFilterSql('c', view.pointId, masteryParams);
    const { rows: mastery } = await this.pool.query(
      `SELECT s.id, s.name, COUNT(*) AS cnt
         FROM check_service_lines csl
         JOIN services s ON s.id = csl.service_id
         JOIN checks c ON c.id = csl.check_id
        WHERE c.tenant_id=$1 AND csl.master_id=$2 AND c.deleted_at IS NULL${masteryPointFilter}
        GROUP BY s.id, s.name
        ORDER BY cnt DESC
        LIMIT 5`,
      masteryParams,
    );
    const serviceMastery = mastery.map((r) => {
      const count = parseInt(r.cnt) || 0;
      let tier: 'bronze' | 'silver' | 'gold' | 'platinum' = 'bronze';
      if (count >= 500) tier = 'platinum';
      else if (count >= 200) tier = 'gold';
      else if (count >= 50) tier = 'silver';
      return { serviceId: r.id as string, name: r.name as string, count, tier };
    });

    // Achievements are always returned (badges card is rendered by every
    // client). They're also reused to seed the optional career timeline below.
    const achievements = await this.listAchievements(tenantID, employeeId);

    // Career timeline — hire + top months + custom achievements. The top-months
    // scan + assembly is only done when the caller opted in via
    // `?include=timeline`. Otherwise it stays an empty array.
    const careerTimeline: Array<{
      date: string;
      kind: 'hire' | 'promotion' | 'top_month' | 'custom';
      title: string;
      description?: string;
    }> = [];
    if (include.timeline) {
      if (profile.hireDate) {
        careerTimeline.push({
          date:
            typeof profile.hireDate === 'string'
              ? profile.hireDate
              : new Date(profile.hireDate).toISOString().slice(0, 10),
          kind: 'hire',
          title: 'Принят на работу',
        });
      }
      const topMonthParams: unknown[] = [tenantID, employeeId];
      const topMonthPointFilter = pointFilterSql(null, view.pointId, topMonthParams);
      const { rows: topMonths } = await this.pool.query(
        `SELECT to_char(date_trunc('month', date), 'YYYY-MM-01') AS ym,
                SUM(total_revenue) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL${topMonthPointFilter}
          GROUP BY ym
          ORDER BY revenue DESC
          LIMIT 3`,
        topMonthParams,
      );
      for (const m of topMonths) {
        careerTimeline.push({
          date: m.ym,
          kind: 'top_month',
          title: 'Топовый месяц',
          // Сумма месяца — денежная часть: без права видеть финансы событие
          // остаётся в ленте, а цифра из него уходит (description опционален).
          ...(view.canSeeMoney ? { description: `${Math.round(parseFloat(m.revenue))}₽` } : {}),
        });
      }
      for (const a of achievements) {
        careerTimeline.push({
          date:
            typeof a.awardedAt === 'string'
              ? a.awardedAt.slice(0, 10)
              : new Date(a.awardedAt).toISOString().slice(0, 10),
          kind: 'custom',
          title: a.name,
          description: a.description ?? undefined,
        });
      }
      careerTimeline.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    return {
      profile,
      stats: { efficiency, discipline, activity, rating, quality },
      streaks,
      lifetime,
      // Optional / additive — only present when the tenant has «Смены» on.
      ...(shifts ? { shifts } : {}),
      yearHeatmap,
      teamRank,
      serviceMastery,
      careerTimeline,
      achievements,
    };
  }

  private async computeStreaks(tenantID: string, employeeId: string, pointId: string | null) {
    // checksStreak: consecutive days ending today with >=1 check
    const dayParams: unknown[] = [tenantID, employeeId];
    const dayPointFilter = pointFilterSql(null, pointId, dayParams);
    const { rows: dayRows } = await this.pool.query(
      `SELECT date::date AS day, COUNT(*) AS checks
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL
          AND date >= now() - interval '120 days'${dayPointFilter}
        GROUP BY date::date
        ORDER BY day DESC`,
      dayParams,
    );
    let checksStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cursor = today;
    for (const r of dayRows) {
      const dayStr = typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
      const cursorStr = cursor.toISOString().slice(0, 10);
      if (dayStr === cursorStr) {
        checksStreak++;
        cursor = new Date(cursor.getTime() - 86_400_000);
      } else {
        break;
      }
    }

    // disciplineStreak: consecutive schedule_entries days without late/absent.
    // 167 — только дни ЭТОГО филиала (schedule_entries.point_id).
    const streakParams: unknown[] = [employeeId, tenantID];
    const streakPointFilter = pointFilterSql(null, pointId, streakParams);
    const { rows: disc } = await this.pool.query(
      `SELECT date::date AS day, late_status, is_day_off, actual_arrival
         FROM schedule_entries
        WHERE user_id=$1 AND tenant_id=$2
          AND date >= now() - interval '180 days'
          AND date <= now()::date${streakPointFilter}
        ORDER BY date DESC`,
      streakParams,
    );
    let disciplineStreak = 0;
    for (const r of disc) {
      const bad =
        r.late_status === 'late_major' ||
        (r.is_day_off === false && r.actual_arrival === null && r.late_status !== 'late_minor');
      if (bad) break;
      disciplineStreak++;
    }

    // fiveStarStreak: consecutive last reviews that are 5 stars
    const revParams: unknown[] = [tenantID, employeeId];
    const revPointFilter = pointFilterSql('ch', pointId, revParams);
    const { rows: revs } = await this.pool.query(
      `SELECT rr.rating
         FROM review_responses rr
         JOIN checks ch ON ch.id = rr.check_id
        WHERE rr.tenant_id=$1 AND ch.master_id=$2 AND ch.deleted_at IS NULL${revPointFilter}
        ORDER BY rr.created_at DESC
        LIMIT 50`,
      revParams,
    );
    let fiveStarStreak = 0;
    for (const r of revs) {
      if (parseInt(r.rating) === 5) fiveStarStreak++;
      else break;
    }

    return { disciplineStreak, fiveStarStreak, checksStreak };
  }

  /**
   * Итоги «за всё время». ДВА ОГРАНИЧЕНИЯ, оба обязательны:
   *   • `pointId` — считаем в разрезе филиала сессии (иначе карточка мастера в
   *     филиале Б показывает деньги, заработанные в филиале А);
   *   • `canSeeMoney` — без права видеть финансы рублёвые поля отдаются НУЛЯМИ,
   *     а не удаляются: форма ответа одна на всех, клиент не падает на
   *     отсутствующем ключе. Та же конвенция, что у прибыли в сводке филиалов.
   */
  private async computeLifetime(tenantID: string, employeeId: string, pointId: string | null, canSeeMoney: boolean) {
    const totalsParams: unknown[] = [tenantID, employeeId];
    const totalsPointFilter = pointFilterSql(null, pointId, totalsParams);
    const { rows: totals } = await this.pool.query(
      `SELECT COALESCE(SUM(total_revenue), 0) AS revenue,
              COUNT(*) AS check_count,
              COUNT(DISTINCT client_id) AS clients
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL${totalsPointFilter}`,
      totalsParams,
    );
    const bestDayParams: unknown[] = [tenantID, employeeId];
    const bestDayPointFilter = pointFilterSql(null, pointId, bestDayParams);
    const { rows: bestDayRows } = await this.pool.query(
      `SELECT date::date AS day, COALESCE(SUM(total_revenue), 0) AS revenue
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL${bestDayPointFilter}
        GROUP BY date::date
        ORDER BY revenue DESC
        LIMIT 1`,
      bestDayParams,
    );
    const bestMonthParams: unknown[] = [tenantID, employeeId];
    const bestMonthPointFilter = pointFilterSql(null, pointId, bestMonthParams);
    const { rows: bestMonthRows } = await this.pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS ym,
              COALESCE(SUM(total_revenue), 0) AS revenue
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL${bestMonthPointFilter}
        GROUP BY ym
        ORDER BY revenue DESC
        LIMIT 1`,
      bestMonthParams,
    );
    const brandParams: unknown[] = [tenantID, employeeId];
    const brandPointFilter = pointFilterSql('ch', pointId, brandParams);
    const { rows: topBrands } = await this.pool.query(
      `SELECT split_part(coalesce(ca.make_model, ''), ' ', 1) AS brand, COUNT(*) AS cnt
         FROM checks ch
         JOIN cars ca ON ca.id = ch.car_id
        WHERE ch.tenant_id=$1 AND ch.master_id=$2 AND ch.is_deferred=false AND ch.deleted_at IS NULL${brandPointFilter}
        GROUP BY brand
        HAVING split_part(coalesce(ca.make_model, ''), ' ', 1) <> ''
        ORDER BY cnt DESC
        LIMIT 5`,
      brandParams,
    );

    // Top-3 products this master sold. check_product_lines has no master_id of
    // its own — it inherits the check's master via the checks join. We JOIN to
    // products by id (rows where product_id is null = free-text lines are
    // skipped) so we can carry a stable id + current name + photo. SUM(quantity)
    // counts units sold, not line rows.
    const topProductParams: unknown[] = [tenantID, employeeId];
    const topProductPointFilter = pointFilterSql('ch', pointId, topProductParams);
    const { rows: topProductRows } = await this.pool.query(
      `SELECT p.id, p.name, p.photo, COALESCE(SUM(cpl.quantity), 0) AS cnt
         FROM check_product_lines cpl
         JOIN checks ch ON ch.id = cpl.check_id
         JOIN products p ON p.id = cpl.product_id
        WHERE ch.tenant_id=$1 AND ch.master_id=$2 AND ch.is_deferred=false
          AND ch.deleted_at IS NULL${topProductPointFilter}
        GROUP BY p.id, p.name, p.photo
        ORDER BY cnt DESC, p.name ASC
        LIMIT 3`,
      topProductParams,
    );

    const totalRevenue = canSeeMoney ? parseFloat(totals[0]?.revenue) || 0 : 0;
    const totalChecks = parseInt(totals[0]?.check_count) || 0;
    const clientsServed = parseInt(totals[0]?.clients) || 0;
    const bestDay = bestDayRows[0]
      ? {
          date:
            typeof bestDayRows[0].day === 'string'
              ? bestDayRows[0].day.slice(0, 10)
              : new Date(bestDayRows[0].day).toISOString().slice(0, 10),
          value: canSeeMoney ? parseFloat(bestDayRows[0].revenue) || 0 : 0,
        }
      : undefined;
    const bestMonth = bestMonthRows[0]
      ? {
          ym: bestMonthRows[0].ym as string,
          value: canSeeMoney ? parseFloat(bestMonthRows[0].revenue) || 0 : 0,
        }
      : undefined;

    return {
      totalChecks,
      totalRevenue,
      clientsServed,
      bestDay,
      bestMonth,
      topCarBrands: topBrands.map((r) => ({ brand: r.brand as string, count: parseInt(r.cnt) || 0 })),
      topProducts: topProductRows.map((r) => ({
        productId: r.id as string,
        name: r.name as string,
        // 120: количества дробные (NUMERIC(12,3)) — parseInt съедал бы "2.500".
        count: parseFloat(r.cnt) || 0,
        // `photo` is optional in the contract — only emit it when present so the
        // payload stays clean for products without an image.
        ...(r.photo ? { photo: r.photo as string } : {}),
      })),
    };
  }

  /**
   * Shift / attendance summary for the employee, built from schedule_entries.
   * Returned only when the tenant has the «Смены» feature ON (070
   * `shifts_enabled`) — otherwise `fullProfile` omits the `shifts` key entirely
   * (it is optional in the contract). `total` counts worked shifts (not
   * days-off); `lateCount` / `avgLateMinutes` use the existing late_status /
   * late_minutes columns. bestDay / worstDay are the calendar days with the
   * most / fewest checks this master closed (joined from `checks`).
   */
  private async computeShifts(tenantID: string, employeeId: string, pointId: string | null) {
    // Attendance aggregates. is_day_off rows are excluded from the worked-shift
    // count and from the late stats. avg is over LATE shifts only, so a master
    // who is rarely late doesn't get their average diluted by on-time zeros.
    // 167 — смены/опоздания считаются по дням графика ЭТОГО филиала.
    const attParams: unknown[] = [employeeId, tenantID];
    const attPointFilter = pointFilterSql(null, pointId, attParams);
    const { rows: attRows } = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_day_off = false) AS total,
         COUNT(*) FILTER (WHERE is_day_off = false
                            AND late_status IN ('late_minor','late_major')) AS late_count,
         COALESCE(
           AVG(NULLIF(late_minutes, 0)) FILTER (WHERE is_day_off = false
                            AND late_status IN ('late_minor','late_major')),
           0
         ) AS avg_late_minutes
       FROM schedule_entries
       WHERE user_id=$1 AND tenant_id=$2${attPointFilter}`,
      attParams,
    );
    const total = parseInt(attRows[0]?.total) || 0;
    const lateCount = parseInt(attRows[0]?.late_count) || 0;
    const avgLateMinutes = Math.round(parseFloat(attRows[0]?.avg_late_minutes) || 0);

    // Best / worst day by number of checks closed. Single pass: most-checks day
    // ASC/DESC. worstDay only differs from bestDay when the master has >1 active
    // day, otherwise it mirrors bestDay (which the FE renders fine).
    const byDayParams: unknown[] = [tenantID, employeeId];
    const byDayPointFilter = pointFilterSql(null, pointId, byDayParams);
    const { rows: byDay } = await this.pool.query(
      `SELECT date::date AS day, COUNT(*) AS checks_count
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false AND deleted_at IS NULL${byDayPointFilter}
        GROUP BY date::date
        ORDER BY checks_count DESC, day DESC`,
      byDayParams,
    );
    const toDayStat = (r: { day: unknown; checks_count: unknown }) => ({
      date: typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day as string).toISOString().slice(0, 10),
      checksCount: parseInt(String(r.checks_count)) || 0,
    });
    const bestDay = byDay.length > 0 ? toDayStat(byDay[0]) : undefined;
    const worstDay = byDay.length > 0 ? toDayStat(byDay[byDay.length - 1]) : undefined;

    return { total, lateCount, avgLateMinutes, bestDay, worstDay };
  }

  /** Места в команде. Тоже в разрезе филиала сессии: сравнивать мастера
   *  филиала Б с выручкой всей сети бессмысленно — место получилось бы чужим. */
  private async computeTeamRank(tenantID: string, employeeId: string, pointId: string | null) {
    // Rank by revenue last month + by discipline last month + by avg rating
    const revRankParams: unknown[] = [tenantID];
    const revRankPointFilter = pointFilterSql(null, pointId, revRankParams);
    const { rows: revRanks } = await this.pool.query(
      `WITH agg AS (
         SELECT master_id, COALESCE(SUM(total_revenue), 0) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
            AND date >= (date_trunc('month', now()) - interval '1 month')
            AND date < date_trunc('month', now())${revRankPointFilter}
          GROUP BY master_id
       )
       SELECT master_id, revenue, RANK() OVER (ORDER BY revenue DESC) AS rnk
         FROM agg`,
      revRankParams,
    );
    // 167 — рейтинг дисциплины среди тех, кто работал В ЭТОМ филиале.
    const discRankParams: unknown[] = [tenantID];
    const discRankPointFilter = pointFilterSql(null, pointId, discRankParams);
    const { rows: discRanks } = await this.pool.query(
      `WITH agg AS (
         SELECT user_id,
                AVG(CASE WHEN late_status = 'on_time' OR is_day_off = true THEN 1 ELSE 0 END) AS discipline
           FROM schedule_entries
          WHERE tenant_id=$1
            AND date >= (date_trunc('month', now()) - interval '1 month')::date
            AND date < date_trunc('month', now())::date${discRankPointFilter}
          GROUP BY user_id
       )
       SELECT user_id, RANK() OVER (ORDER BY discipline DESC) AS rnk FROM agg`,
      discRankParams,
    );
    const ratingRankParams: unknown[] = [tenantID];
    const ratingRankPointFilter = pointFilterSql('ch', pointId, ratingRankParams);
    const { rows: ratingRanks } = await this.pool.query(
      `WITH agg AS (
         SELECT ch.master_id, AVG(rr.rating) AS avg_rating
           FROM review_responses rr
           JOIN checks ch ON ch.id = rr.check_id
          WHERE ch.tenant_id=$1 AND ch.deleted_at IS NULL${ratingRankPointFilter}
          GROUP BY ch.master_id
       )
       SELECT master_id, RANK() OVER (ORDER BY avg_rating DESC NULLS LAST) AS rnk FROM agg`,
      ratingRankParams,
    );
    const total = Math.max(revRanks.length, discRanks.length, ratingRanks.length, 1);
    const revRank = revRanks.find((r) => r.master_id === employeeId)?.rnk ?? 0;
    const discRank = discRanks.find((r) => r.user_id === employeeId)?.rnk ?? 0;
    const ratingRank = ratingRanks.find((r) => r.master_id === employeeId)?.rnk ?? 0;
    return {
      revenueRank: parseInt(revRank) || 0,
      disciplineRank: parseInt(discRank) || 0,
      ratingRank: parseInt(ratingRank) || 0,
      total,
    };
  }
}
