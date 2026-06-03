import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateArticleDto,
  UpdateArticleDto,
  ListArticlesQueryDto,
} from './dto/knowledge.dto';

type Attachment = { url: string; name: string; size?: number };

// Default categories + starter articles seeded once per tenant on first read.
// Mirrors the client_sources DEFAULT_SOURCES lazy-seed: an empty tenant never
// sees a blank screen. Icons are Ionicons names for the mobile/web UI.
const SEED_CATEGORIES: { key: string; name: string; icon: string; sortOrder: number }[] = [
  { key: 'regulations', name: 'Регламенты', icon: 'document-text-outline', sortOrder: 0 },
  { key: 'reception', name: 'Приёмка и выдача авто', icon: 'car-outline', sortOrder: 1 },
  { key: 'app', name: 'Работа в приложении', icon: 'phone-portrait-outline', sortOrder: 2 },
  { key: 'safety', name: 'Безопасность', icon: 'shield-checkmark-outline', sortOrder: 3 },
];

const SEED_ARTICLES: {
  categoryKey: string;
  type: 'article' | 'regulation';
  title: string;
  body: string;
  pinned?: boolean;
}[] = [
  {
    categoryKey: 'reception',
    type: 'article',
    title: 'Как принимать автомобиль у клиента',
    pinned: true,
    body: `# Приёмка автомобиля

Чек-лист при приёме авто на ремонт — заполняется вместе с клиентом.

## Перед осмотром
- Уточните **ФИО и телефон** клиента, проверьте по базе.
- Зафиксируйте **госномер** и пробег на одометре.
- Спросите, что именно беспокоит ("жалоба клиента").

## Внешний осмотр (обходим машину по кругу)
- [ ] Сколы, царапины, вмятины — сфотографируйте каждую.
- [ ] Состояние стёкол и зеркал.
- [ ] Состояние дисков и шин.
- [ ] Уровень топлива.

## Салон
- [ ] Личные вещи клиента (попросите забрать ценное).
- [ ] Видеорегистратор / магнитола на месте.
- [ ] Чистота салона до работ.

## Оформление
1. Создайте **заказ-наряд** (касса) на этого клиента и авто.
2. Прикрепите фото к заказ-наряду.
3. Согласуйте предварительную стоимость и срок.
4. Дайте клиенту подтверждение приёмки.

> Все фото и замечания фиксируются до начала работ — это защищает и сервис, и клиента.`,
  },
  {
    categoryKey: 'app',
    type: 'article',
    title: 'Как заполнять заказ-наряд',
    body: `# Заказ-наряд (касса)

Заказ-наряд — это чек с услугами, товарами, клиентом и авто.

## Шаги
1. Откройте вкладку **Касса**.
2. Выберите или создайте **клиента** и его **автомобиль** (введите госномер).
3. Добавьте **услуги** из справочника услуг.
4. Добавьте **товары/запчасти** со склада — остаток списывается автоматически.
5. Назначьте **мастера**, который выполняет работы.
6. Проверьте итоговую сумму и **способ оплаты**.
7. Сохраните заказ-наряд.

## Полезно
- Товары берутся со **склада** — если позиции нет, заведите её в разделе «Склад».
- Услуги настраиваются в разделе **Услуги** (цена, длительность).
- Зарплата мастера считается от выполненных работ автоматически.`,
  },
  {
    categoryKey: 'app',
    type: 'article',
    title: 'Помощь по приложению Autexa',
    body: `# Помощь по Autexa

Короткая навигация по приложению.

## Нижнее меню
- **Главная** — сводка дня: выручка, заказы, рейтинг мастеров.
- **Склад** — товары, остатки, категории.
- **Касса** — создание заказ-наряда (центральная кнопка).
- **Журнал** — список всех заказ-нарядов и складских документов.
- **Ещё** — клиенты, услуги, зарплата, расходы, отчёты, настройки.

## Частые вопросы
- **Не вижу финансы.** Финансовые разделы видят владелец и директор.
- **Где регламенты?** Раздел «База знаний» → «Регламенты». Отметьте «Ознакомлен».
- **Как добавить сотрудника?** «Ещё» → «Сотрудники» → «＋».

Если что-то не работает — напишите владельцу автосервиса.`,
  },
  {
    categoryKey: 'safety',
    type: 'regulation',
    title: 'Техника безопасности в автосервисе',
    pinned: true,
    body: `# Регламент: техника безопасности

**Обязателен к ознакомлению всеми сотрудниками.** После прочтения нажмите «Ознакомлен».

## Общие правила
- Работайте только в **спецодежде** и закрытой обуви.
- Используйте **СИЗ**: перчатки, очки, респиратор при покраске.
- Рабочее место содержите в чистоте, проливы масла убирайте сразу.

## Подъёмник и домкрат
- Перед подъёмом убедитесь в правильных **точках опоры**.
- Никогда не находитесь под авто, стоящим только на домкрате — ставьте **страховочные стойки**.
- Проверяйте исправность подъёмника перед работой.

## Электро- и пожаробезопасность
- Не оставляйте включённые приборы без присмотра.
- Знайте расположение **огнетушителей** и аварийного выхода.
- Курение — только в отведённом месте, вдали от ГСМ.

## При травме
1. Окажите первую помощь, сообщите руководителю.
2. При серьёзной травме — вызовите **скорую (103)**.
3. Зафиксируйте обстоятельства происшествия.

> Нарушение техники безопасности может привести к травмам и материальному ущербу. Соблюдение — обязанность каждого.`,
  },
];

// Roles allowed to write (create/update/delete). Read is open to any
// authenticated user — enforced at the controller via @Roles.
export const KNOWLEDGE_MANAGER_ROLES = ['director', 'admin', 'superadmin'];

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger('KnowledgeService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Lazy seed ────────────────────────────────────────────────────────────

  /**
   * Seed default categories + starter articles the first time a tenant touches
   * the knowledge base. Runs in one transaction; an advisory lock keyed on the
   * tenant serialises concurrent first-reads so two requests can't double-seed.
   * Safe to call on every list request — it no-ops once categories exist.
   */
  private async ensureSeed(tenantID: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT 1 FROM knowledge_categories WHERE tenant_id=$1 LIMIT 1', [tenantID]);
    if (rows.length > 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Tenant-scoped advisory lock: hashtext keeps the lock key stable per
      // tenant so concurrent seeders queue instead of racing. Released on COMMIT.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`knowledge_seed:${tenantID}`]);

      // Re-check inside the lock — another request may have seeded while we waited.
      const { rows: again } = await client.query('SELECT 1 FROM knowledge_categories WHERE tenant_id=$1 LIMIT 1', [
        tenantID,
      ]);
      if (again.length > 0) {
        await client.query('COMMIT');
        return;
      }

      const idByKey = new Map<string, string>();
      for (const cat of SEED_CATEGORIES) {
        const res = await client.query(
          `INSERT INTO knowledge_categories (tenant_id, name, icon, sort_order)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantID, cat.name, cat.icon, cat.sortOrder],
        );
        idByKey.set(cat.key, res.rows[0].id);
      }

      for (const art of SEED_ARTICLES) {
        await client.query(
          `INSERT INTO knowledge_articles (tenant_id, category_id, type, title, body, pinned, published)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [tenantID, idByKey.get(art.categoryKey) ?? null, art.type, art.title, art.body, art.pinned ?? false],
        );
      }

      await client.query('COMMIT');
      this.logger.log(`Seeded knowledge base for tenant ${tenantID}`);
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`ensureSeed failed for tenant ${tenantID}: ${err}`);
      // Non-fatal: if seeding fails the tenant just sees an empty KB; surfaces
      // again on the next read.
    } finally {
      client.release();
    }
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  async listCategories(tenantID: string) {
    await this.ensureSeed(tenantID);
    const { rows } = await this.pool.query(
      `SELECT id, name, icon, sort_order
       FROM knowledge_categories WHERE tenant_id=$1
       ORDER BY sort_order, name`,
      [tenantID],
    );
    return rows.map(mapCategory);
  }

  async createCategory(tenantID: string, dto: CreateCategoryDto) {
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_categories (tenant_id, name, icon, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING id, name, icon, sort_order`,
      [tenantID, dto.name.trim(), dto.icon ?? null, dto.sortOrder ?? 0],
    );
    return mapCategory(rows[0]);
  }

  async updateCategory(tenantID: string, id: string, dto: UpdateCategoryDto) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (dto.name !== undefined) {
      sets.push(`name=$${i++}`);
      vals.push(dto.name.trim());
    }
    if (dto.icon !== undefined) {
      sets.push(`icon=$${i++}`);
      vals.push(dto.icon);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order=$${i++}`);
      vals.push(dto.sortOrder);
    }
    if (sets.length === 0) {
      const existing = await this.getCategoryOrThrow(tenantID, id);
      return existing;
    }
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_categories SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i} RETURNING id, name, icon, sort_order`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Категория не найдена' });
    return mapCategory(rows[0]);
  }

  async deleteCategory(tenantID: string, id: string) {
    // ON DELETE SET NULL on articles.category_id — articles survive, just lose
    // their category.
    const res = await this.pool.query('DELETE FROM knowledge_categories WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (res.rowCount === 0) throw new NotFoundException({ message: 'Категория не найдена' });
    return { message: 'Удалено' };
  }

  private async getCategoryOrThrow(tenantID: string, id: string) {
    const { rows } = await this.pool.query(
      'SELECT id, name, icon, sort_order FROM knowledge_categories WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Категория не найдена' });
    return mapCategory(rows[0]);
  }

  // ─── Articles ─────────────────────────────────────────────────────────────

  /**
   * Slim list for the index screen. Returns id/title/type/categoryId/pinned/
   * coverImage/updatedAt + a short plain-text excerpt derived from the body.
   *
   * When `search` is set we match `title ILIKE '%q%' OR body ILIKE '%q%'` on
   * the raw columns so the pg_trgm GIN indexes on title+body can be used — the
   * indexed columns are never wrapped in a function. Non-managers only see
   * published articles; managers see drafts too.
   */
  async listArticles(tenantID: string, role: string, query: ListArticlesQueryDto) {
    await this.ensureSeed(tenantID);

    const where: string[] = ['tenant_id=$1'];
    const params: any[] = [tenantID];
    let i = 2;

    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);
    if (!isManager) {
      where.push('published = true');
    }
    if (query.categoryId) {
      where.push(`category_id=$${i++}`);
      params.push(query.categoryId);
    }
    if (query.type) {
      where.push(`type=$${i++}`);
      params.push(query.type);
    }
    if (query.pinned === 'true') {
      where.push('pinned = true');
    }
    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      // Both predicates run against raw indexed columns → GIN trigram usable.
      where.push(`(title ILIKE $${i} OR body ILIKE $${i})`);
      params.push(term);
      i++;
    }

    const { rows } = await this.pool.query(
      `SELECT id, title, type, category_id, pinned, cover_image, updated_at,
              left(body, 200) AS excerpt_src
       FROM knowledge_articles
       WHERE ${where.join(' AND ')}
       ORDER BY pinned DESC, updated_at DESC
       LIMIT 500`,
      params,
    );
    return rows.map(mapArticleSlim);
  }

  /**
   * Full article. For type='regulation' includes `acknowledged` = whether the
   * CURRENT user has acked it. Non-managers can't open unpublished drafts.
   */
  async getArticle(tenantID: string, role: string, userID: string, id: string) {
    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);
    const { rows } = await this.pool.query(
      `SELECT a.id, a.category_id, a.type, a.title, a.body, a.cover_image, a.attachments,
              a.pinned, a.published, a.created_by, a.created_at, a.updated_at,
              c.name AS category_name,
              EXISTS(
                SELECT 1 FROM knowledge_acknowledgments k
                WHERE k.article_id = a.id AND k.user_id = $3
              ) AS acknowledged
       FROM knowledge_articles a
       LEFT JOIN knowledge_categories c ON c.id = a.category_id
       WHERE a.id=$1 AND a.tenant_id=$2`,
      [id, tenantID, userID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    const row = rows[0];
    if (!isManager && !row.published) throw new NotFoundException({ message: 'Статья не найдена' });
    return mapArticleFull(row);
  }

  async createArticle(tenantID: string, createdBy: string | null, dto: CreateArticleDto) {
    const attachments = sanitizeAttachments(dto.attachments);
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_articles
         (tenant_id, category_id, type, title, body, cover_image, attachments, pinned, published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       RETURNING id, category_id, type, title, body, cover_image, attachments, pinned, published,
                 created_by, created_at, updated_at`,
      [
        tenantID,
        dto.categoryId ?? null,
        dto.type ?? 'article',
        dto.title.trim(),
        dto.body ?? '',
        dto.coverImage ?? null,
        JSON.stringify(attachments),
        dto.pinned ?? false,
        dto.published ?? true,
        createdBy,
      ],
    );
    return mapArticleFull({ ...rows[0], category_name: null, acknowledged: false });
  }

  async updateArticle(tenantID: string, id: string, dto: UpdateArticleDto) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException({ message: 'Заголовок не может быть пустым' });
      sets.push(`title=$${i++}`);
      vals.push(t);
    }
    if (dto.body !== undefined) {
      sets.push(`body=$${i++}`);
      vals.push(dto.body);
    }
    if (dto.type !== undefined) {
      sets.push(`type=$${i++}`);
      vals.push(dto.type);
    }
    if (dto.categoryId !== undefined) {
      sets.push(`category_id=$${i++}`);
      vals.push(dto.categoryId ?? null);
    }
    if (dto.coverImage !== undefined) {
      sets.push(`cover_image=$${i++}`);
      vals.push(dto.coverImage ?? null);
    }
    if (dto.attachments !== undefined) {
      sets.push(`attachments=$${i++}::jsonb`);
      vals.push(JSON.stringify(sanitizeAttachments(dto.attachments)));
    }
    if (dto.pinned !== undefined) {
      sets.push(`pinned=$${i++}`);
      vals.push(dto.pinned);
    }
    if (dto.published !== undefined) {
      sets.push(`published=$${i++}`);
      vals.push(dto.published);
    }
    // Always bump updated_at so the list re-sorts the edited article to top.
    sets.push(`updated_at=now()`);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_articles SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i}
       RETURNING id, category_id, type, title, body, cover_image, attachments, pinned, published,
                 created_by, created_at, updated_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    return mapArticleFull({ ...rows[0], category_name: null, acknowledged: false });
  }

  async deleteArticle(tenantID: string, id: string) {
    // ON DELETE CASCADE on knowledge_acknowledgments removes the ack rows too.
    const res = await this.pool.query('DELETE FROM knowledge_articles WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (res.rowCount === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    return { message: 'Удалено' };
  }

  // ─── Acknowledgments ──────────────────────────────────────────────────────

  /**
   * Upsert an acknowledgment for the current user. ON CONFLICT DO NOTHING makes
   * re-acking a no-op. Returns the ack timestamp (existing or fresh).
   */
  async acknowledge(tenantID: string, userID: string, articleID: string) {
    // Verify the article belongs to this tenant — prevents acking a foreign id.
    const { rows: art } = await this.pool.query(
      'SELECT 1 FROM knowledge_articles WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [articleID, tenantID],
    );
    if (art.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });

    await this.pool.query(
      `INSERT INTO knowledge_acknowledgments (tenant_id, article_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (article_id, user_id) DO NOTHING`,
      [tenantID, articleID, userID],
    );
    const { rows } = await this.pool.query(
      'SELECT acknowledged_at FROM knowledge_acknowledgments WHERE article_id=$1 AND user_id=$2',
      [articleID, userID],
    );
    return { acknowledgedAt: rows[0]?.acknowledged_at ?? null };
  }

  /**
   * Who acknowledged an article + who hasn't yet. The `acknowledged` list is
   * the users who acked (with name + timestamp); `pending` is the active tenant
   * users who have NOT acked. Lets the owner see "8/10 ознакомлены".
   */
  async listAcks(tenantID: string, articleID: string) {
    const { rows: art } = await this.pool.query(
      'SELECT 1 FROM knowledge_articles WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [articleID, tenantID],
    );
    if (art.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });

    const { rows: acked } = await this.pool.query(
      `SELECT k.user_id, u.full_name, k.acknowledged_at
       FROM knowledge_acknowledgments k
       JOIN users u ON u.id = k.user_id
       WHERE k.tenant_id=$1 AND k.article_id=$2
       ORDER BY k.acknowledged_at DESC`,
      [tenantID, articleID],
    );

    // Active tenant users who have NOT acked. We only count "real" employees
    // (active, non-superadmin) — same audience that must read regulations.
    const { rows: pending } = await this.pool.query(
      `SELECT u.id AS user_id, u.full_name
       FROM users u
       WHERE u.tenant_id=$1 AND u.is_active = true AND u.role <> 'superadmin'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_acknowledgments k
           WHERE k.article_id=$2 AND k.user_id = u.id
         )
       ORDER BY u.full_name`,
      [tenantID, articleID],
    );

    const acknowledged = acked.map((r) => ({
      userId: r.user_id,
      userName: r.full_name,
      acknowledgedAt: r.acknowledged_at,
    }));
    const pendingList = pending.map((r) => ({ userId: r.user_id, userName: r.full_name }));
    const totalAudience = acknowledged.length + pendingList.length;

    return {
      acknowledged,
      pending: pendingList,
      acknowledgedCount: acknowledged.length,
      totalAudience,
    };
  }

  // ─── Regulation counters (badges) ─────────────────────────────────────────

  /**
   * For the signed-in user: how many PUBLISHED regulations they have NOT yet
   * acknowledged. Drives the menu red-dot + employee-card "Регламенты: N/M".
   */
  async regulationsPendingCount(tenantID: string, userID: string) {
    await this.ensureSeed(tenantID);
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count
       FROM knowledge_articles a
       WHERE a.tenant_id=$1 AND a.type='regulation' AND a.published = true
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_acknowledgments k
           WHERE k.article_id = a.id AND k.user_id = $2
         )`,
      [tenantID, userID],
    );
    return { count: rows[0]?.count ?? 0 };
  }

  /**
   * Manager view of any employee's regulation progress: `{ total, acknowledged }`
   * across published regulations. Feeds the employee card "Регламенты: N/M".
   */
  async regulationSummaryForUser(tenantID: string, userID: string) {
    // Confirm the target user belongs to this tenant.
    const { rows: u } = await this.pool.query('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      userID,
      tenantID,
    ]);
    if (u.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });

    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM knowledge_acknowledgments k
             WHERE k.article_id = a.id AND k.user_id = $2
           )
         )::int AS acknowledged
       FROM knowledge_articles a
       WHERE a.tenant_id=$1 AND a.type='regulation' AND a.published = true`,
      [tenantID, userID],
    );
    return { total: rows[0]?.total ?? 0, acknowledged: rows[0]?.acknowledged ?? 0 };
  }
}

// ─── Mappers / helpers ───────────────────────────────────────────────────────

function mapCategory(r: any) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon ?? undefined,
    sortOrder: r.sort_order ?? 0,
  };
}

function mapArticleSlim(r: any) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    categoryId: r.category_id ?? undefined,
    pinned: !!r.pinned,
    coverImage: r.cover_image ?? undefined,
    updatedAt: r.updated_at,
    excerpt: bodyToExcerpt(r.excerpt_src),
  };
}

function mapArticleFull(r: any) {
  return {
    id: r.id,
    categoryId: r.category_id ?? undefined,
    categoryName: r.category_name ?? undefined,
    type: r.type,
    title: r.title,
    body: r.body ?? '',
    excerpt: bodyToExcerpt(r.body),
    coverImage: r.cover_image ?? undefined,
    attachments: parseAttachments(r.attachments),
    pinned: !!r.pinned,
    published: !!r.published,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    acknowledged: r.type === 'regulation' ? !!r.acknowledged : undefined,
  };
}

/** Strip markdown noise from the body head into a short plain-text excerpt. */
function bodyToExcerpt(src: unknown): string {
  if (typeof src !== 'string' || !src) return '';
  return src
    .replace(/[#>*_`~-]+/g, ' ') // drop common markdown markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images → their text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function parseAttachments(raw: unknown): Attachment[] {
  if (Array.isArray(raw)) return sanitizeAttachments(raw as Attachment[]);
  if (typeof raw === 'string') {
    try {
      return sanitizeAttachments(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function sanitizeAttachments(input: unknown): Attachment[] {
  if (!Array.isArray(input)) return [];
  const out: Attachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const url = (raw as any).url;
    const name = (raw as any).name;
    if (typeof url !== 'string' || !url) continue;
    const att: Attachment = { url, name: typeof name === 'string' && name ? name : url };
    const size = (raw as any).size;
    if (typeof size === 'number' && Number.isFinite(size)) att.size = size;
    out.push(att);
  }
  return out;
}
