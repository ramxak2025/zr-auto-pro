import { Injectable, Inject, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';

// Roles that can edit "private" employee data (KPI targets, owner notes,
// hire date). Other roles can still edit their own photo + whatsapp.
const PRIVATE_ROLES = new Set(['director', 'admin', 'superadmin']);

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

  /** Update an employee's profile fields. Permission split:
   *  - Manager (director/admin/superadmin) may set any extension field.
   *  - The employee themselves may only update photoUrl + whatsapp on their own row.
   *  Anything outside this matrix is rejected with 403.
   */
  async update(actorID: string, actorRole: string, tenantID: string, employeeId: string, dto: Record<string, unknown>) {
    const isManager = PRIVATE_ROLES.has(actorRole);
    const isSelf = actorID === employeeId;
    if (!isManager && !isSelf) {
      throw new ForbiddenException({ message: 'Нет доступа к этому сотруднику' });
    }

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
      return this.getProfile(tenantID, employeeId);
    }

    vals.push(employeeId, tenantID);
    await this.pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}`, vals);

    ttlCache.invalidatePrefix(`employee:${tenantID}:${employeeId}`);
    return this.getProfile(tenantID, employeeId);
  }

  /** Lightweight profile shape used as the building block for full-profile + update response. */
  async getProfile(tenantID: string, employeeId: string) {
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
      ownerNotes: r.owner_notes,
      photoUrl: r.photo_url,
      whatsapp: r.whatsapp,
    };
  }

  /**
   * Stream a photo, resize to 512×512, write it out as WebP + JPEG, and
   * persist the URL on the user row. Returns the same shape getProfile does.
   */
  async uploadPhoto(
    actorID: string,
    actorRole: string,
    tenantID: string,
    employeeId: string,
    stream: NodeJS.ReadableStream,
    ext: string,
  ) {
    if (!PRIVATE_ROLES.has(actorRole) && actorID !== employeeId) {
      throw new ForbiddenException({ message: 'Нет доступа к этому сотруднику' });
    }

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

  async listDocuments(tenantID: string, employeeId: string) {
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
      fileUrl: r.file_url,
      uploadedAt: r.uploaded_at,
      expiresAt: r.expires_at,
    }));
  }

  async addDocument(
    tenantID: string,
    employeeId: string,
    body: { type: string; name?: string; fileUrl: string; expiresAt?: string | null },
  ) {
    if (!body?.type || !body?.fileUrl) {
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
        String(body.fileUrl),
        body.expiresAt || null,
      ],
    );
    const r = rows[0];
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      fileUrl: r.file_url,
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
  async fullProfile(tenantID: string, employeeId: string, include?: FullProfileInclude | string | string[]) {
    const want = normalizeInclude(include);
    // The cache key carries the include-set so a light request and a heavy
    // request don't clobber each other's cached payloads.
    const cacheKey = `employee:${tenantID}:${employeeId}:full:${want.heatmap ? 'h' : ''}${want.timeline ? 't' : ''}`;
    return ttlCache.wrap(cacheKey, 60_000, () => this.computeFullProfile(tenantID, employeeId, want));
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

  private async computeFullProfile(tenantID: string, employeeId: string, include: FullProfileInclude) {
    // getProfile is the ONLY existence check — it throws 404 for a genuinely
    // missing tenant user and that 404 must propagate. Everything after it is
    // derived analytics; if any of it fails (DB error / statement timeout on a
    // big tenant) we degrade to the base profile + empty analytics rather than
    // 500'ing a valid employee.
    const profile = await this.getProfile(tenantID, employeeId);

    try {
      return await this.computeAnalytics(tenantID, employeeId, profile, include);
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
  ) {
    // Discipline + activity quick stats (last 30 days)
    const { rows: monthAgg } = await this.pool.query(
      `WITH month_checks AS (
         SELECT *
           FROM checks
          WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false
            AND date >= now() - interval '30 days'
       )
       SELECT
         COALESCE(SUM(total_revenue), 0) AS revenue,
         COUNT(*) AS check_count,
         COALESCE(AVG(rr.rating), 0) AS avg_rating
       FROM month_checks
       LEFT JOIN review_responses rr ON rr.check_id = month_checks.id`,
      [tenantID, employeeId],
    );

    const monthRevenue = parseFloat(monthAgg[0]?.revenue) || 0;
    const monthChecks = parseInt(monthAgg[0]?.check_count) || 0;
    const avgRating = parseFloat(monthAgg[0]?.avg_rating) || 0;

    // Discipline = % of last 30 schedule_entries days that were on-time / dayoff
    const { rows: discRows } = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE late_status IN ('on_time') OR is_day_off = true) AS good,
         COUNT(*) AS total
       FROM schedule_entries
       WHERE user_id=$1 AND tenant_id=$2
         AND date >= (now() - interval '30 days')::date
         AND date <= now()::date`,
      [employeeId, tenantID],
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
    const streaks = await this.computeStreaks(tenantID, employeeId);

    // Lifetime totals + best day / best month + top car brands
    const lifetime = await this.computeLifetime(tenantID, employeeId);

    // Year heatmap: 365 day buckets. Heavy GROUP BY — only computed when the
    // caller opted in via `?include=heatmap`. Otherwise it stays an empty
    // array and we skip the scan entirely.
    let yearHeatmap: Array<{ day: string; checks: number; revenue: number }> = [];
    if (include.heatmap) {
      const { rows: heat } = await this.pool.query(
        `SELECT date::date AS day, COUNT(*) AS checks, COALESCE(SUM(total_revenue), 0) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false
            AND date >= now() - interval '365 days'
          GROUP BY date::date
          ORDER BY day`,
        [tenantID, employeeId],
      );
      yearHeatmap = heat.map((r) => ({
        day: typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10),
        checks: parseInt(r.checks) || 0,
        revenue: parseFloat(r.revenue) || 0,
      }));
    }

    // Team ranks
    const teamRank = await this.computeTeamRank(tenantID, employeeId);

    // Service mastery (top 5 services)
    const { rows: mastery } = await this.pool.query(
      `SELECT s.id, s.name, COUNT(*) AS cnt
         FROM check_service_lines csl
         JOIN services s ON s.id = csl.service_id
         JOIN checks c ON c.id = csl.check_id
        WHERE c.tenant_id=$1 AND csl.master_id=$2
        GROUP BY s.id, s.name
        ORDER BY cnt DESC
        LIMIT 5`,
      [tenantID, employeeId],
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
      const { rows: topMonths } = await this.pool.query(
        `SELECT to_char(date_trunc('month', date), 'YYYY-MM-01') AS ym,
                SUM(total_revenue) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false
          GROUP BY ym
          ORDER BY revenue DESC
          LIMIT 3`,
        [tenantID, employeeId],
      );
      for (const m of topMonths) {
        careerTimeline.push({
          date: m.ym,
          kind: 'top_month',
          title: 'Топовый месяц',
          description: `${Math.round(parseFloat(m.revenue))}₽`,
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
      yearHeatmap,
      teamRank,
      serviceMastery,
      careerTimeline,
      achievements,
    };
  }

  private async computeStreaks(tenantID: string, employeeId: string) {
    // checksStreak: consecutive days ending today with >=1 check
    const { rows: dayRows } = await this.pool.query(
      `SELECT date::date AS day, COUNT(*) AS checks
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false
          AND date >= now() - interval '120 days'
        GROUP BY date::date
        ORDER BY day DESC`,
      [tenantID, employeeId],
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

    // disciplineStreak: consecutive schedule_entries days without late/absent
    const { rows: disc } = await this.pool.query(
      `SELECT date::date AS day, late_status, is_day_off, actual_arrival
         FROM schedule_entries
        WHERE user_id=$1 AND tenant_id=$2
          AND date >= now() - interval '180 days'
          AND date <= now()::date
        ORDER BY date DESC`,
      [employeeId, tenantID],
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
    const { rows: revs } = await this.pool.query(
      `SELECT rr.rating
         FROM review_responses rr
         JOIN checks ch ON ch.id = rr.check_id
        WHERE rr.tenant_id=$1 AND ch.master_id=$2
        ORDER BY rr.created_at DESC
        LIMIT 50`,
      [tenantID, employeeId],
    );
    let fiveStarStreak = 0;
    for (const r of revs) {
      if (parseInt(r.rating) === 5) fiveStarStreak++;
      else break;
    }

    return { disciplineStreak, fiveStarStreak, checksStreak };
  }

  private async computeLifetime(tenantID: string, employeeId: string) {
    const { rows: totals } = await this.pool.query(
      `SELECT COALESCE(SUM(total_revenue), 0) AS revenue,
              COUNT(*) AS check_count,
              COUNT(DISTINCT client_id) AS clients
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false`,
      [tenantID, employeeId],
    );
    const { rows: bestDayRows } = await this.pool.query(
      `SELECT date::date AS day, COALESCE(SUM(total_revenue), 0) AS revenue
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false
        GROUP BY date::date
        ORDER BY revenue DESC
        LIMIT 1`,
      [tenantID, employeeId],
    );
    const { rows: bestMonthRows } = await this.pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS ym,
              COALESCE(SUM(total_revenue), 0) AS revenue
         FROM checks
        WHERE tenant_id=$1 AND master_id=$2 AND is_deferred=false
        GROUP BY ym
        ORDER BY revenue DESC
        LIMIT 1`,
      [tenantID, employeeId],
    );
    const { rows: topBrands } = await this.pool.query(
      `SELECT split_part(coalesce(ca.make_model, ''), ' ', 1) AS brand, COUNT(*) AS cnt
         FROM checks ch
         JOIN cars ca ON ca.id = ch.car_id
        WHERE ch.tenant_id=$1 AND ch.master_id=$2 AND ch.is_deferred=false
        GROUP BY brand
        HAVING split_part(coalesce(ca.make_model, ''), ' ', 1) <> ''
        ORDER BY cnt DESC
        LIMIT 5`,
      [tenantID, employeeId],
    );

    const totalRevenue = parseFloat(totals[0]?.revenue) || 0;
    const totalChecks = parseInt(totals[0]?.check_count) || 0;
    const clientsServed = parseInt(totals[0]?.clients) || 0;
    const bestDay = bestDayRows[0]
      ? {
          date:
            typeof bestDayRows[0].day === 'string'
              ? bestDayRows[0].day.slice(0, 10)
              : new Date(bestDayRows[0].day).toISOString().slice(0, 10),
          value: parseFloat(bestDayRows[0].revenue) || 0,
        }
      : undefined;
    const bestMonth = bestMonthRows[0]
      ? {
          ym: bestMonthRows[0].ym as string,
          value: parseFloat(bestMonthRows[0].revenue) || 0,
        }
      : undefined;

    return {
      totalChecks,
      totalRevenue,
      clientsServed,
      bestDay,
      bestMonth,
      topCarBrands: topBrands.map((r) => ({ brand: r.brand as string, count: parseInt(r.cnt) || 0 })),
    };
  }

  private async computeTeamRank(tenantID: string, employeeId: string) {
    // Rank by revenue last month + by discipline last month + by avg rating
    const { rows: revRanks } = await this.pool.query(
      `WITH agg AS (
         SELECT master_id, COALESCE(SUM(total_revenue), 0) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND date >= (date_trunc('month', now()) - interval '1 month')
            AND date < date_trunc('month', now())
          GROUP BY master_id
       )
       SELECT master_id, revenue, RANK() OVER (ORDER BY revenue DESC) AS rnk
         FROM agg`,
      [tenantID],
    );
    const { rows: discRanks } = await this.pool.query(
      `WITH agg AS (
         SELECT user_id,
                AVG(CASE WHEN late_status = 'on_time' OR is_day_off = true THEN 1 ELSE 0 END) AS discipline
           FROM schedule_entries
          WHERE tenant_id=$1
            AND date >= (date_trunc('month', now()) - interval '1 month')::date
            AND date < date_trunc('month', now())::date
          GROUP BY user_id
       )
       SELECT user_id, RANK() OVER (ORDER BY discipline DESC) AS rnk FROM agg`,
      [tenantID],
    );
    const { rows: ratingRanks } = await this.pool.query(
      `WITH agg AS (
         SELECT ch.master_id, AVG(rr.rating) AS avg_rating
           FROM review_responses rr
           JOIN checks ch ON ch.id = rr.check_id
          WHERE ch.tenant_id=$1
          GROUP BY ch.master_id
       )
       SELECT master_id, RANK() OVER (ORDER BY avg_rating DESC NULLS LAST) AS rnk FROM agg`,
      [tenantID],
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
