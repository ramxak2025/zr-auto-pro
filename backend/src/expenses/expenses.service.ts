import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { invalidateReportsForTenant } from '../common/reports-cache';
import { PushService } from '../push/push.service';
import { userHasPermission } from '../common/guards/permissions.guard';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { getTenantTimezone } from '../common/timezone';
import { actorPointId, assertRowPointForWrite, pointFilterSql } from '../common/point-scope';

// «Привилегированный» здесь — про СЕМАНТИКУ записи (source='owner', без дневного
// лимита и очереди утверждения), НЕ про доступ. Право вносить расходы решает
// матрица роли ('can_add_expenses'), включая admin — он больше не owner-class.
const PRIVILEGED_ROLES = new Set(['director', 'admin', 'superadmin']);

// A real expense id is a uuid. The «Гарантия (убыток)» rows injected into the
// list (getAll) are DERIVED, non-persistent and carry a synthetic id
// (`warranty-loss:<checkId>`). Guard the mutating endpoints so a synthetic (or
// any non-uuid / garbage) id resolves to a clean 404 instead of a Postgres
// "invalid input syntax for type uuid" 500 on the `WHERE id=$1` cast.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    @Optional() private pushService?: PushService,
  ) {}

  // --- Categories ---

  async getCategories(tenantID: string) {
    const { rows } = await this.pool.query('SELECT * FROM expense_categories WHERE tenant_id=$1 ORDER BY name', [
      tenantID,
    ]);
    return rows.map((r) => this.mapCategory(r));
  }

  async createCategory(tenantID: string, dto: any) {
    // `is_recurring` (132) — v3.0.1 ФИЧА 1: помечает категорию как «оплата плановой
    // постоянки» (аренда/коммуналка/маркетинг). Такие расходы НЕ режут accrual-
    // прибыль (она начислена из конфига), а идут только в «Движение денег».
    const { rows } = await this.pool.query(
      'INSERT INTO expense_categories (name, tenant_id, approval_required, is_recurring) VALUES ($1, $2, $3, $4) RETURNING *',
      [dto.name, tenantID, !!dto.approvalRequired, !!dto.isRecurring],
    );
    return this.mapCategory(rows[0]);
  }

  /**
   * Toggle (or rename) a category. Currently used to flip `approval_required`
   * from the owner's expense-settings screen (#11). Returns the updated row.
   */
  async updateCategory(
    id: string,
    tenantID: string,
    dto: { name?: string; approvalRequired?: boolean; isRecurring?: boolean },
  ) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.approvalRequired !== undefined) {
      sets.push(`approval_required=$${idx++}`);
      vals.push(!!dto.approvalRequired);
    }
    // v3.0.1 ФИЧА 1 — переключатель «повторяющаяся» (планово-постоянная) категория.
    if (dto.isRecurring !== undefined) {
      sets.push(`is_recurring=$${idx++}`);
      vals.push(!!dto.isRecurring);
    }
    if (sets.length === 0) {
      const { rows } = await this.pool.query('SELECT * FROM expense_categories WHERE id=$1 AND tenant_id=$2', [
        id,
        tenantID,
      ]);
      if (rows.length === 0) throw new NotFoundException({ message: 'Категория расходов не найдена' });
      return this.mapCategory(rows[0]);
    }
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE expense_categories SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Категория расходов не найдена' });
    return this.mapCategory(rows[0]);
  }

  async removeCategory(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM expense_categories WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  private mapCategory(r: any) {
    return {
      id: r.id,
      name: r.name,
      tenantId: r.tenant_id,
      // 057_expense_category_approval — may be NULL on legacy rows.
      approvalRequired: !!r.approval_required,
      // 132 (v3.0.1 ФИЧА 1) — recurring/planned category → accrual-neutral, cash-only.
      isRecurring: !!r.is_recurring,
      createdAt: r.created_at,
    };
  }

  // --- Expenses ---

  /**
   * Список расходов за период. 161 — филиальный скоуп: расход принадлежит той
   * точке, на которой он возник (expenses.point_id — филиал автора у ручных,
   * филиал связанной операции у автоматических), поэтому «Расходы» филиала А
   * больше не показывают траты филиала Б. Синтетические строки «Гарантия
   * (убыток)» режутся точкой ЧЕКА — они и есть чеки.
   */
  async getAll(tenantID: string, query: any, actor?: JwtPayload) {
    const pointId = actorPointId(actor);
    // Safety net (audit round 7, item 8): both web (ExpensesPage) and mobile
    // (ExpensesScreen) always send an explicit dateFrom/dateTo — but a bare
    // call without any range used to scan the tenant's ENTIRE expense history
    // unbounded. Default a missing range to the current month; the LIMIT 1000
    // below bounds the response either way.
    let dateFrom = query.dateFrom;
    const dateTo = query.dateTo;
    if (!dateFrom && !dateTo) {
      const now = new Date();
      dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    let where = 'e.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    // Пояс тенанта — один раз на запрос: используется и основным списком, и
    // синтетическими строками «Гарантия (убыток)» ниже.
    const tz = await getTenantTimezone(this.pool, tenantID);

    // Границы периода — полуинтервал [from 00:00, to+1 00:00) В ПОЯСЕ ТЕНАНТА,
    // зеркально reports.service. Раньше правый край «<= (to+1)::timestamptz»
    // резался по TZ сервера и ВКЛЮЧАЛ ровно полночь следующего дня — расход в
    // 00:00 попадал в оба соседних периода. Пояс уходит параметром, не склейкой.
    if (dateFrom) {
      where += ` AND e.date >= $${idx++}::date::timestamp AT TIME ZONE $${idx++}::text`;
      params.push(dateFrom, tz);
    }
    if (dateTo) {
      where += ` AND e.date < ($${idx++}::date + 1)::timestamp AT TIME ZONE $${idx++}::text`;
      params.push(dateTo, tz);
    }
    if (query.createdBy) {
      where += ` AND e.created_by = $${idx++}`;
      params.push(query.createdBy);
    }
    if (query.approvalStatus) {
      where += ` AND e.approval_status = $${idx++}`;
      params.push(query.approvalStatus);
    }
    // Фильтр филиала — ПОСЛЕДНИМ: pointFilterSql сам кладёт значение в params и
    // нумерует плейсхолдер по params.length, поэтому дальше локальный idx уже
    // не используется и рассинхрона счётчиков быть не может.
    where += pointFilterSql('e', pointId, params);

    const { rows } = await this.pool.query(
      `SELECT e.*, ec.name as category_name,
              u.full_name as user_name,
              cu.full_name as creator_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users cu ON cu.id = e.created_by
       WHERE ${where}
       ORDER BY e.date DESC
       LIMIT 1000`,
      params,
    );

    const expenses: Array<{
      id: string;
      categoryId: string | null;
      categoryName: string | null;
      amount: number;
      description: string | null;
      date: unknown;
      userId: string | null;
      userName: string | null;
      createdBy: string | null;
      creatorName: string | null;
      source: string;
      approvalStatus: string;
      periodMonth: string | null;
      recipientName: string | null;
      createdAt: unknown;
    }> = rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      categoryName: r.category_name,
      amount: parseFloat(r.amount) || 0,
      description: r.description,
      date: r.date,
      userId: r.user_id,
      userName: r.user_name,
      createdBy: r.created_by,
      creatorName: r.creator_name,
      source: r.source ?? 'owner',
      approvalStatus: r.approval_status ?? 'approved',
      // 149 — «за какой месяц» (P&L-отнесение). Список расходов сам по-прежнему
      // фильтруется ПО ДАТЕ ФАКТА (касса); period_month здесь — только бейдж.
      periodMonth: r.period_month ?? null,
      // 149 — внепрограммный получатель (маркетолог, уборщица) свободным именем.
      recipientName: r.recipient_name ?? null,
      createdAt: r.created_at,
    }));

    // ITEM 2 — «Гарантия (убыток)» видимой затратой в списке «Расходы».
    // DERIVED, НЕ материализуем: строки-убытки строятся из гарантийных чеков
    // периода на лету и в таблицу expenses НЕ пишутся. Поэтому getFinancial /
    // dashboardV2 (которые суммируют ТАБЛИЦУ expenses для otherExpenses) их не
    // видят, а убыток по гарантии учитывается ровно ОДИН раз — производным
    // термом warrantyLoss из checks. Гарантия двойного счёта: 0.
    //
    // amount = product_cost_total + service_salary_total (закупка запчастей +
    // выплата мастеру) — та же формула, что в reports/checks. Показываем только
    // когда фильтры допускают: по конкретному сотруднику (createdBy) у
    // синтетической строки автора нет, а очередь на одобрение (approvalStatus
    // ≠ 'approved') — гарантия всегда реализованный расход, не «на одобрении».
    const wantWarranty = !query.createdBy && (!query.approvalStatus || query.approvalStatus === 'approved');
    if (wantWarranty) {
      const wParams: any[] = [tenantID];
      let wWhere =
        `ch.tenant_id = $1 AND ch.payment_method = 'warranty' AND ch.is_deferred = false ` +
        `AND ch.deleted_at IS NULL AND (ch.product_cost_total + ch.service_salary_total) > 0`;
      let wIdx = 2;
      // Тот же местный полуинтервал, что и у основного списка расходов выше.
      if (dateFrom) {
        wWhere += ` AND ch.date >= $${wIdx++}::date::timestamp AT TIME ZONE $${wIdx++}::text`;
        wParams.push(dateFrom, tz);
      }
      if (dateTo) {
        wWhere += ` AND ch.date < ($${wIdx++}::date + 1)::timestamp AT TIME ZONE $${wIdx++}::text`;
        wParams.push(dateTo, tz);
      }
      // Убыток по гарантии — это чек, поэтому режется точкой ЧЕКА (та же
      // колонка, что в журнале и на дашборде): иначе филиал А увидел бы у себя
      // в расходах гарантийные убытки филиала Б.
      wWhere += pointFilterSql('ch', pointId, wParams);
      const { rows: wRows } = await this.pool.query(
        `SELECT ch.id, ch.number, ch.date, ch.created_at, ch.master_id,
                (ch.product_cost_total + ch.service_salary_total) AS loss,
                u.full_name AS master_name, ca.plate_number
           FROM checks ch
           LEFT JOIN users u ON u.id = ch.master_id AND u.tenant_id = ch.tenant_id
           LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
          WHERE ${wWhere}
          ORDER BY ch.date DESC
          LIMIT 1000`,
        wParams,
      );
      for (const w of wRows) {
        expenses.push({
          id: `warranty-loss:${w.id}`,
          categoryId: null,
          categoryName: 'Гарантия (убыток)',
          amount: parseFloat(w.loss) || 0,
          description: `Гарантия — заказ-наряд #${w.number}${w.plate_number ? ` · ${w.plate_number}` : ''}`,
          date: w.date,
          userId: w.master_id ?? null,
          userName: w.master_name ?? null,
          createdBy: null,
          creatorName: null,
          source: 'warranty',
          approvalStatus: 'approved',
          periodMonth: null,
          recipientName: null,
          createdAt: w.created_at,
        });
        // Держим тот же порядок, что и основной список — по дате убывания —
        // чтобы гарантийные строки встали в хронологию, а не хвостом.
      }
      expenses.sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());
    }

    return expenses;
  }

  async create(actor: JwtPayload, dto: any) {
    const tenantID = actor.tenantID;
    const userID = actor.userID;

    // If a category is referenced, confirm it lives in the caller's tenant.
    // Without this, a director could store an expense under a foreign
    // tenant's category and have it surface in their own listing JOIN'd
    // with that foreign name.
    let categoryApprovalRequired = false;
    if (dto.categoryId) {
      const { rows: catRows } = await this.pool.query(
        'SELECT approval_required FROM expense_categories WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [dto.categoryId, tenantID],
      );
      if (catRows.length === 0) {
        throw new NotFoundException({ message: 'Категория расходов не найдена' });
      }
      categoryApprovalRequired = !!catRows[0].approval_required;
    }

    const isPrivileged = PRIVILEGED_ROLES.has(actor.role);
    const source = isPrivileged ? 'owner' : 'employee';

    // Право вносить расходы — из МАТРИЦЫ роли ('can_add_expenses'), не из
    // легаси-колонки users.can_add_expenses (та осталась только носителем
    // daily_expense_limit-семантики тумблера в карточке сотрудника). Дубль
    // route-гейта @RequirePermission('can_add_expenses') — defence-in-depth
    // на случай прямого вызова сервиса.
    if (!userHasPermission(actor, 'can_add_expenses')) {
      throw new ForbiddenException({ message: 'У вас нет права добавлять расходы' });
    }

    const amount = parseFloat(String(dto.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: 'Сумма должна быть положительной' });
    }
    // Sanity ceiling (audit round 7, item 2): kills 1e308-style overflow abuse
    // while staying an order of magnitude above any real автосервис expense.
    if (amount > 100_000_000) {
      throw new BadRequestException({ message: 'Сумма слишком велика' });
    }
    const date = dto.date || new Date().toISOString();

    // Daily-limit check — only meaningful for non-privileged users; we
    // sum up all the user's expenses on the same calendar day and flip
    // the new one to 'pending' if the cumulative total crosses the cap.
    let approvalStatus: 'approved' | 'pending' = 'approved';
    if (!isPrivileged) {
      const { rows: limitRows } = await this.pool.query(
        'SELECT daily_expense_limit FROM users WHERE id=$1 AND tenant_id=$2',
        [userID, tenantID],
      );
      const limit =
        limitRows[0]?.daily_expense_limit === null || limitRows[0]?.daily_expense_limit === undefined
          ? null
          : parseFloat(limitRows[0].daily_expense_limit);
      if (limit !== null && limit > 0) {
        const dayStartIso = new Date(date).toISOString().slice(0, 10);
        // Отклонённые владельцем заявки — не потраченные деньги: они не должны
        // съедать дневной лимит (иначе несколько rejected-заявок загоняют весь
        // день в pending при фактических тратах 0).
        const { rows: totalRows } = await this.pool.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
            WHERE tenant_id=$1 AND created_by=$2
              AND date >= $3::date AND date < ($3::date + 1)
              AND COALESCE(approval_status, 'approved') <> 'rejected'`,
          [tenantID, userID, dayStartIso],
        );
        const sumSoFar = parseFloat(totalRows[0].total) || 0;
        if (sumSoFar + amount > limit) {
          approvalStatus = 'pending';
        }
      }

      // 057 — a category flagged `approval_required` forces non-privileged
      // submissions into the review queue regardless of the daily limit.
      if (categoryApprovalRequired) {
        approvalStatus = 'pending';
      }
    }

    // 161 — ручной расход рождается НА ТЕКУЩЕМ ФИЛИАЛЕ АВТОРА (решение
    // владельца).
    //
    // ФИЛИАЛ ОБЯЗАТЕЛЕН, и он берётся из сессии (163). Расход с point_id =
    // NULL не видел НИ ОДИН филиальный срез: он выпадал из «Движения денег»
    // филиала, из его прибыли и из наличного расхода в окне кассовой смены
    // (Z-отчёт филиала сходился бы на эту сумму лишними деньгами в ящике).
    // Теперь такой строки у тенанта с филиалами не появляется по построению:
    // филиал выбран при входе. Филиалов у тенанта нет вовсе → NULL, как было.
    const pointId = actorPointId(actor);

    const { rows } = await this.pool.query(
      `INSERT INTO expenses (category_id, amount, description, date, user_id, created_by, source, approval_status, tenant_id, point_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        dto.categoryId || null,
        amount,
        dto.description || null,
        date,
        userID,
        userID,
        source,
        approvalStatus,
        tenantID,
        pointId,
      ],
    );
    const r = rows[0];
    // A new (approved) expense changes cash-position / profit tiles — drop the
    // tenant's cached report aggregates. We invalidate on pending too; cheap
    // and keeps the alert set in sync once it's later approved.
    invalidateReportsForTenant(tenantID);

    // Live cross-device sync: a new expense moves the cash position (or, when
    // pending, the approval queue) — nudge every OTHER device in the tenant to
    // refetch money queries. Silent, data-only, fire-and-forget after commit.
    if (this.pushService) {
      this.pushService.sendDataToTenant(tenantID, userID, { type: 'cash-changed', tenantId: tenantID }).catch(() => {
        /* best-effort */
      });
    }
    return {
      id: r.id,
      categoryId: r.category_id,
      amount: parseFloat(r.amount) || 0,
      description: r.description,
      date: r.date,
      userId: r.user_id,
      createdBy: r.created_by,
      source: r.source,
      approvalStatus: r.approval_status,
      createdAt: r.created_at,
    };
  }

  /**
   * ГЕЙТ РЕШЕНИЯ ПО РАСХОДУ (волна 4). Очередь согласования читается уже с
   * фильтром филиала, но approve/reject адресуются по id и фильтра не имели —
   * та же асимметрия «читаем узко, пишем широко», что закрыта у чеков и
   * зарплаты. Утверждение чужого расхода мгновенно уменьшает прибыль и кассу
   * ФИЛИАЛА-ВЛАДЕЛЬЦА строки, а у актора в его срезе ничего не меняется, то
   * есть последствий он не видит вовсе.
   *
   * Предикат общий (common/point-scope.assertRowPointForWrite). Точки нет
   * (у тенанта нет филиалов — одноточечный автосервис) — гейта нет, поведение прежнее.
   */
  private assertOwnPoint(id: string, tenantID: string, actor?: JwtPayload): Promise<void> {
    return assertRowPointForWrite(this.pool, 'expenses', id, tenantID, actorPointId(actor), 'Расход не найден');
  }

  /**
   * Owner approves a pending expense. Sets approval_status='approved' and
   * returns the updated row. Idempotent — re-approving an approved row is
   * a no-op and returns the existing record.
   */
  async approve(id: string, tenantID: string, actor?: JwtPayload) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Расход не найден' });
    await this.assertOwnPoint(id, tenantID, actor);
    const { rows } = await this.pool.query(
      `UPDATE expenses SET approval_status='approved' WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    invalidateReportsForTenant(tenantID);
    return rows[0];
  }

  async reject(id: string, tenantID: string, actor?: JwtPayload) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Расход не найден' });
    await this.assertOwnPoint(id, tenantID, actor);
    const { rows } = await this.pool.query(
      `UPDATE expenses SET approval_status='rejected' WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    invalidateReportsForTenant(tenantID);
    return rows[0];
  }

  /**
   * НАСТОЯЩАЯ ПРАВКА РАСХОДА — PATCH /expenses/:id.
   *
   * ПОЧЕМУ ЭТА РУЧКА ВООБЩЕ ПОЯВИЛАСЬ. Ручки правки не было, и мобильный экран
   * изображал её парой запросов «удалить, потом создать заново». Удаление здесь
   * ФИЗИЧЕСКОЕ (DELETE, без soft-delete), поэтому любой отказ второго запроса —
   * нет права, чужой филиал, оборвалась связь в подвале автосервиса — стирал
   * расход НАВСЕГДА: восстанавливать было нечего, и владелец видел просто
   * пропавшие деньги. Правка обязана быть ОДНИМ запросом: либо строка изменилась,
   * либо осталась ровно такой, какой была.
   *
   * ЧТО СОХРАНЯЕТСЯ НЕИЗМЕННЫМ (и почему это важнее удобства):
   *   • `id` — на него ссылаются ссылки/пуши/открытые списки у других устройств;
   *   • `created_by` / `user_id` — автор траты не меняется от того, кто её правит;
   *   • `source` ('owner'/'employee') — семантика записи задаётся при создании;
   *   • `point_id` — филиал траты; перенос денег между филиалами правкой суммы
   *     не делается (для этого пришлось бы пересчитать оба филиала);
   *   • `period_month` / `recipient_name` — поля зеркальных выплат (зарплата,
   *     выплата вне программы), их правит свой поток, не форма расхода.
   *
   * СТАТУС ОДОБРЕНИЯ НЕ ПОВЫШАЕТСЯ ПРАВКОЙ. Отклонённая заявка остаётся
   * отклонённой, ожидающая — ожидающей: иначе сотрудник «чинил» бы отказ
   * владельца редактированием. Обратный ход есть: одобренная заявка
   * НЕПРИВИЛЕГИРОВАННОГО автора, вышедшая правкой за дневной лимит или
   * переехавшая в категорию «требует одобрения», снова становится 'pending' —
   * иначе правка суммы была бы дырой в обход очереди согласования.
   */
  async update(id: string, actor: JwtPayload, dto: any) {
    const tenantID = actor.tenantID;
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Расход не найден' });
    // Гейт филиала — до чтения строки, как в approve/reject: чужой филиал
    // получает 404 и не узнаёт даже о существовании строки.
    await this.assertOwnPoint(id, tenantID, actor);

    const { rows: currentRows } = await this.pool.query(
      `SELECT * FROM expenses WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantID],
    );
    if (currentRows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    const current = currentRows[0];

    // Кто может править: финансист (financial_reports) — любую строку своего
    // филиала; вносящий расходы (can_add_expenses) — только СВОЮ. Дубль
    // route-гейта — defence-in-depth на случай прямого вызова сервиса.
    const canManageFinance = userHasPermission(actor, 'financial_reports');
    if (!canManageFinance) {
      if (!userHasPermission(actor, 'can_add_expenses')) {
        throw new ForbiddenException({ message: 'У вас нет права изменять расходы' });
      }
      if (current.created_by !== actor.userID) {
        throw new ForbiddenException({ message: 'Можно изменять только свои расходы' });
      }
    }

    // ЗЕРКАЛЬНЫЙ РАСХОД ВЫПЛАТЫ ЗАРПЛАТЫ правкой не трогаем — ровно по той же
    // причине, по которой его нельзя удалить (см. remove ниже): его сумма и
    // дата обязаны совпадать со строкой выплаты (salary_payouts.expense_id /
    // salary_payments.expense_id). Сдвинув их здесь, мы получили бы «выдано
    // 30 000, из кассы ушло 3 000» без единого следа, и сторно выплаты уже
    // нечего было бы компенсировать. Правильное действие — отменить саму
    // выплату и выдать заново.
    const { rows: linked } = await this.pool.query(
      `SELECT 1 FROM salary_payouts WHERE expense_id = $1 AND tenant_id = $2
       UNION ALL
       SELECT 1 FROM salary_payments WHERE expense_id = $1 AND tenant_id = $2
       LIMIT 1`,
      [id, tenantID],
    );
    if (linked.length > 0) {
      throw new BadRequestException({
        message: 'Это зеркальный расход выплаты зарплаты — измените саму выплату, расход подстроится',
      });
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    let nextAmount = parseFloat(current.amount) || 0;
    if (dto.amount !== undefined) {
      const amount = parseFloat(String(dto.amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException({ message: 'Сумма должна быть положительной' });
      }
      // Тот же потолок, что в create — защита от 1e308-переполнения.
      if (amount > 100_000_000) {
        throw new BadRequestException({ message: 'Сумма слишком велика' });
      }
      nextAmount = amount;
      sets.push(`amount=$${idx++}`);
      vals.push(amount);
    }

    // Категория решает, уходит ли расход в очередь одобрения, поэтому её
    // approval_required нужен и при смене категории, и когда её не трогали.
    let nextCategoryId: string | null = current.category_id ?? null;
    if (dto.categoryId !== undefined) {
      const raw = dto.categoryId || null;
      // Не-uuid в WHERE id=$1 дал бы 22P02 → 500; отвечаем честным 404.
      if (raw !== null && (typeof raw !== 'string' || !UUID_RE.test(raw))) {
        throw new NotFoundException({ message: 'Категория расходов не найдена' });
      }
      nextCategoryId = raw;
      sets.push(`category_id=$${idx++}`);
      vals.push(raw);
    }
    let categoryApprovalRequired = false;
    if (nextCategoryId) {
      const { rows: catRows } = await this.pool.query(
        'SELECT approval_required FROM expense_categories WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [nextCategoryId, tenantID],
      );
      // Чужая/несуществующая категория — та же ошибка, что в create: иначе
      // расход уехал бы под имя категории другого тенанта.
      if (catRows.length === 0) throw new NotFoundException({ message: 'Категория расходов не найдена' });
      categoryApprovalRequired = !!catRows[0].approval_required;
    }

    if (dto.description !== undefined) {
      const description = typeof dto.description === 'string' ? dto.description.trim() : null;
      sets.push(`description=$${idx++}`);
      vals.push(description || null);
    }

    let nextDate: Date = current.date instanceof Date ? current.date : new Date(String(current.date));
    if (dto.date !== undefined) {
      const parsed = new Date(String(dto.date));
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException({ message: 'Неверная дата расхода' });
      }
      nextDate = parsed;
      sets.push(`date=$${idx++}`);
      vals.push(parsed.toISOString());
    }

    // ── Очередь согласования после правки ───────────────────────────────
    // Только вниз (approved → pending) и только у непривилегированного автора:
    // иначе правка суммы была бы обходом дневного лимита и категорий
    // «требует одобрения». PRIVILEGED_ROLES здесь — про семантику записи
    // (как в create), а не про доступ: доступ решён выше.
    const currentStatus: string = current.approval_status ?? 'approved';
    let nextStatus = currentStatus;
    const authorIsPrivileged = PRIVILEGED_ROLES.has(actor.role) && current.created_by === actor.userID;
    if (!authorIsPrivileged && currentStatus === 'approved') {
      if (categoryApprovalRequired) {
        nextStatus = 'pending';
      } else if (current.created_by) {
        const { rows: limitRows } = await this.pool.query(
          'SELECT daily_expense_limit FROM users WHERE id=$1 AND tenant_id=$2',
          [current.created_by, tenantID],
        );
        const limit =
          limitRows[0]?.daily_expense_limit === null || limitRows[0]?.daily_expense_limit === undefined
            ? null
            : parseFloat(limitRows[0].daily_expense_limit);
        if (limit !== null && limit > 0) {
          const dayStartIso = nextDate.toISOString().slice(0, 10);
          // САМУ правимую строку исключаем ($4): иначе её старая сумма
          // считалась бы дважды и любая правка вниз всё равно ушла бы в pending.
          const { rows: totalRows } = await this.pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
              WHERE tenant_id=$1 AND created_by=$2
                AND date >= $3::date AND date < ($3::date + 1)
                AND id <> $4
                AND COALESCE(approval_status, 'approved') <> 'rejected'`,
            [tenantID, current.created_by, dayStartIso, id],
          );
          const sumOthers = parseFloat(totalRows[0].total) || 0;
          if (sumOthers + nextAmount > limit) nextStatus = 'pending';
        }
      }
    }
    if (nextStatus !== currentStatus) {
      sets.push(`approval_status=$${idx++}`);
      vals.push(nextStatus);
    }

    // Нечего менять — отвечаем текущей строкой (идемпотентно), а не пустым
    // UPDATE: клиенту важен объект, а не факт записи.
    const row = await (async () => {
      if (sets.length === 0) return current;
      vals.push(id, tenantID);
      const { rows } = await this.pool.query(
        `UPDATE expenses SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
        vals,
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
      return rows[0];
    })();

    // Сумма/дата/категория расхода двигают прибыль и «Движение денег» — те же
    // побочки, что у create.
    invalidateReportsForTenant(tenantID);
    if (this.pushService) {
      this.pushService
        .sendDataToTenant(tenantID, actor.userID, { type: 'cash-changed', tenantId: tenantID })
        .catch(() => {
          /* best-effort */
        });
    }

    return {
      id: row.id,
      categoryId: row.category_id,
      amount: parseFloat(row.amount) || 0,
      description: row.description,
      date: row.date,
      userId: row.user_id,
      createdBy: row.created_by,
      source: row.source,
      approvalStatus: row.approval_status,
      periodMonth: row.period_month ?? null,
      recipientName: row.recipient_name ?? null,
      createdAt: row.created_at,
    };
  }

  /**
   * Удаление расхода. Денежная мутация, поэтому гейтов ДВА.
   *
   * 1) ФИЛИАЛ — тот же assertOwnPoint, что у approve/reject. Удаление было
   *    ЕДИНСТВЕННОЙ денежной мутацией расходов без этой проверки: актор
   *    филиала А, зная id, стирал расход филиала Б — в своём срезе он ничего
   *    не видит, а прибыль и касса ЧУЖОГО филиала уже поехали вверх.
   *
   * 2) СВЯЗЬ С ВЫПЛАТОЙ ЗАРПЛАТЫ. Расход категории «Зарплата» — это ЗЕРКАЛО
   *    строки выплаты (salary_payouts.expense_id / salary_payments.expense_id,
   *    миграции 100 и 153). FK стоит ON DELETE SET NULL, то есть удаление
   *    расхода молча рвёт связь: выплата остаётся «выданной» (сотруднику
   *    списан долг), а денег из кассы будто и не уходило — зарплата и касса
   *    расходятся навсегда, и сторно (reversePayout/reversePayment) уже нечего
   *    компенсировать. Правильное действие — ОТМЕНИТЬ ВЫПЛАТУ: она сама снимет
   *    свой расход. Поэтому здесь отказ с подсказкой, а не тихое удаление.
   */
  async remove(id: string, tenantID: string, actor?: JwtPayload) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Расход не найден' });
    await this.assertOwnPoint(id, tenantID, actor);

    const { rows: linked } = await this.pool.query(
      `SELECT 1 FROM salary_payouts WHERE expense_id = $1 AND tenant_id = $2
       UNION ALL
       SELECT 1 FROM salary_payments WHERE expense_id = $1 AND tenant_id = $2
       LIMIT 1`,
      [id, tenantID],
    );
    if (linked.length > 0) {
      throw new BadRequestException({
        message: 'Это зеркальный расход выплаты зарплаты — отмените саму выплату, она снимет расход',
      });
    }

    const { rows } = await this.pool.query('DELETE FROM expenses WHERE id=$1 AND tenant_id=$2 RETURNING id', [
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    invalidateReportsForTenant(tenantID);
    return { message: 'Удалено' };
  }

  /**
   * Record a system-generated «Зарплата» expense — used when a salary payout
   * is ACCEPTED by the employee (100_salary_payouts_and_fines). This is the
   * single place the salary-payout money path writes to `expenses`, so the
   * SQL is not hand-rolled inside SalaryService.
   *
   * Unlike {@link create} this bypasses the employee permission / daily-limit /
   * approval logic: a payout accepted by the recipient is always an approved
   * owner expense, regardless of who triggered the accept. Source is 'owner'
   * and approval_status 'approved'; `user_id` / `created_by` are attributed to
   * the владелец who issued the payout (may be null if that user was removed).
   *
   * Accepts an optional `executor` (a transaction `PoolClient`) so the expense
   * insert participates in the caller's payout-accept transaction — the payout
   * status flip and the expense insert commit (or roll back) atomically.
   * Side-effects (reports-cache invalidation, cross-device push) are the
   * caller's responsibility AFTER commit. Returns the new expense row.
   */
  async recordSalaryExpense(
    tenantID: string,
    data: {
      amount: number;
      description: string;
      date: string | Date;
      createdBy: string | null;
      /**
       * 161 — филиал СВЯЗАННОЙ ОПЕРАЦИИ (выплаты), а не «текущий филиал
       * автора»: выплату за июль по филиалу А владелец может провести, уже
       * переключившись на Б, и зеркальный расход обязан лечь туда же, где
       * начислялась зарплата — иначе прибыль филиала Б просядет на чужую ЗП.
       */
      pointId?: string | null;
      /**
       * 149 — «за какой месяц» ('YYYY-MM'). Проброс периода выплаты
       * (salary_payouts.period_month) в расход, чтобы P&L отнёс его к нужному
       * месяцу. NULL = месяц даты факта (прежнее поведение). Для категории
       * «Зарплата» на прибыль не влияет (она исключена из P&L по имени), но
       * период сохраняем для консистентности и бейджа в списке расходов.
       */
      periodMonth?: string | null;
    },
    executor: Pool | PoolClient = this.pool,
  ): Promise<{ id: string; amount: number; date: string }> {
    // Find-or-create the tenant's «Зарплата» category (same convention as the
    // legacy salary-payment path).
    const categoryId = await this.findOrCreateCategory(tenantID, 'Зарплата', executor);

    const { rows } = await executor.query(
      `INSERT INTO expenses (category_id, amount, description, date, user_id, created_by, source, approval_status, period_month, tenant_id, point_id)
       VALUES ($1, $2, $3, $4, $5, $5, 'owner', 'approved', $6, $7, $8)
       RETURNING id, amount, date`,
      [
        categoryId,
        data.amount,
        data.description,
        data.date,
        data.createdBy,
        data.periodMonth ?? null,
        tenantID,
        data.pointId ?? null,
      ],
    );
    return { id: rows[0].id, amount: parseFloat(rows[0].amount) || 0, date: rows[0].date };
  }

  /** Find-or-create a system expense category by exact name (tenant-scoped). */
  private async findOrCreateCategory(
    tenantID: string,
    name: string,
    executor: Pool | PoolClient = this.pool,
  ): Promise<string> {
    const { rows: catRows } = await executor.query(
      `SELECT id FROM expense_categories WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
      [tenantID, name],
    );
    if (catRows.length > 0) return catRows[0].id;
    const { rows: newCat } = await executor.query(
      `INSERT INTO expense_categories (name, tenant_id) VALUES ($1, $2) RETURNING id`,
      [name, tenantID],
    );
    return newCat[0].id;
  }

  /**
   * Round 14 (149) — «Выплата вне программы»: выплата задним числом получателю,
   * НЕ заведённому в users (маркетолог, уборщица, разовый подрядчик). Свободное
   * имя + сумма + месяц отнесения → обычный approved-расход под системной
   * категорией «Выплаты вне программы».
   *
   * КРИТИЧНО: категория НЕ «Зарплата» — 'Зарплата' исключается из прибыли ПО
   * ИМЕНИ (reports.service), а внепрограммная выплата обязана РЕЗАТЬ прибыль
   * своего месяца (иначе она исчезла бы из P&L). Категория создаётся с
   * is_recurring=false (дефолт) → в accrual-модели считается разовым расходом.
   *
   * `periodMonth` обязателен — вся суть фичи в отнесении к месяцу; дата факта
   * (`date`, дефолт «сейчас») остаётся датой кассового движения.
   */
  async recordOutsideProgramPayout(
    tenantID: string,
    data: {
      recipientName: string;
      amount: number;
      periodMonth: string;
      comment?: string | null;
      date?: string | Date | null;
      createdBy: string | null;
      /** 161 — филиал, за счёт которого сделана выплата (текущая точка автора). */
      pointId?: string | null;
    },
  ) {
    const categoryId = await this.findOrCreateCategory(tenantID, 'Выплаты вне программы');

    const { rows } = await this.pool.query(
      `INSERT INTO expenses (category_id, amount, description, date, user_id, created_by, source, approval_status, period_month, recipient_name, tenant_id, point_id)
       VALUES ($1, $2, $3, $4, $5, $5, 'owner', 'approved', $6, $7, $8, $9)
       RETURNING *`,
      [
        categoryId,
        data.amount,
        data.comment?.trim() || null,
        data.date || new Date().toISOString(),
        data.createdBy,
        data.periodMonth,
        data.recipientName.trim(),
        tenantID,
        data.pointId ?? null,
      ],
    );
    const r = rows[0];
    // Расход двигает прибыль назначенного месяца — сброс кэшей отчётов + пуш
    // другим устройствам, как в create().
    invalidateReportsForTenant(tenantID);
    if (this.pushService && data.createdBy) {
      this.pushService
        .sendDataToTenant(tenantID, data.createdBy, { type: 'cash-changed', tenantId: tenantID })
        .catch(() => {
          /* best-effort */
        });
    }
    return {
      id: r.id,
      categoryId: r.category_id,
      amount: parseFloat(r.amount) || 0,
      description: r.description,
      date: r.date,
      periodMonth: r.period_month,
      recipientName: r.recipient_name,
      createdBy: r.created_by,
      source: r.source,
      approvalStatus: r.approval_status,
      createdAt: r.created_at,
    };
  }

  async getTotalForPeriod(tenantID: string, dateFrom: string, dateTo: string) {
    // Местный полуинтервал [from 00:00, to+1 00:00) — зеркально getAll выше и
    // reports.service.
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE tenant_id = $1
         AND date >= $2::date::timestamp AT TIME ZONE $4::text
         AND date < ($3::date + 1)::timestamp AT TIME ZONE $4::text`,
      [tenantID, dateFrom, dateTo, await getTenantTimezone(this.pool, tenantID)],
    );
    return parseFloat(rows[0].total) || 0;
  }
}
