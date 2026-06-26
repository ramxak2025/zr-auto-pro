import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateArticleDto,
  UpdateArticleDto,
  ListArticlesQueryDto,
  CreateCourseDto,
  UpdateCourseDto,
  CreateLessonDto,
  UpdateLessonDto,
  CompleteLessonDto,
  ArticleFeedbackDto,
  CreateTroubleshootingDto,
  UpdateTroubleshootingDto,
  ListTroubleshootingQueryDto,
  ForCarQueryDto,
  QuizQuestionDto,
} from './dto/knowledge.dto';

type AttachmentType = 'image' | 'video' | 'document';
type VideoType = 'youtube' | 'vk' | 'embed';
type Attachment = {
  url: string;
  name: string;
  size?: number;
  type?: AttachmentType;
  videoType?: VideoType;
};
type QuizQuestion = { question: string; options: string[]; correctIndex: number };

// Block-based article content (079). Discriminated union mirrored 1:1 in
// shared/types KnowledgeBlock. Persisted to knowledge_articles.blocks JSONB.
type KnowledgeBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; provider: 'vk'; url: string; caption?: string };

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

// Starter troubleshooting entries seeded once per tenant so the справочник
// типовых неисправностей is never empty.
const SEED_TROUBLESHOOTING: {
  title: string;
  system: string;
  symptom: string;
  cause: string;
  solution: string;
  severity: 'low' | 'med' | 'high';
  tags: string[];
}[] = [
  {
    title: 'Не заводится — стартер крутит',
    system: 'Двигатель',
    symptom: 'Стартер вращает двигатель, но он не запускается.',
    cause:
      'Нет искры или подачи топлива: севший АКБ под нагрузкой, неисправный топливный насос, забитый фильтр, проблема с датчиком коленвала, подсос воздуха.',
    solution: `# Что проверить по порядку

1. **Топливо** — есть ли давление в рампе, слышен ли гул бензонасоса при включении зажигания.
2. **Искра** — снять свечу, проверить наличие искры на массу.
3. **Датчик коленвала (ДПКВ)** — частая причина, проверить сопротивление и разъём.
4. **Фильтры** — топливный и воздушный.
5. **ЭБУ / ошибки** — считать коды сканером.

> Если стартер крутит бодро, АКБ исключаем и идём по топливо → искра → синхронизация.`,
    severity: 'high',
    tags: ['стартер', 'запуск', 'топливо', 'искра'],
  },
  {
    title: 'Вибрация на скорости',
    system: 'Ходовая',
    symptom: 'Руль или кузов вибрируют на определённой скорости (часто 90–120 км/ч).',
    cause: 'Дисбаланс колёс, погнутый диск, износ ШРУСа, биение тормозного диска, износ опор/сайлентблоков.',
    solution: `# Диагностика вибрации

1. **Балансировка колёс** — самая частая причина, начать с неё.
2. **Геометрия диска** — проверить на биение, осмотреть на грыжи шины.
3. **ШРУС** — вибрация под нагрузкой/в повороте.
4. **Тормозные диски** — вибрация при торможении → биение диска.
5. **Опоры и сайлентблоки** — люфты подвески.

> Привяжите вибрацию к условию: при торможении — тормоза; на ровной скорости — колёса/балансировка.`,
    severity: 'med',
    tags: ['вибрация', 'колёса', 'балансировка', 'шрус'],
  },
  {
    title: 'Скрип тормозов',
    system: 'Тормоза',
    symptom: 'Писк или скрип при торможении, иногда постоянно при движении.',
    cause:
      'Износ колодок (индикатор), металлический контакт, загрязнение/коррозия диска, отсутствие смазки направляющих, дешёвые колодки.',
    solution: `# Устранение скрипа тормозов

1. **Толщина колодок** — если на индикаторе, заменить.
2. **Состояние диска** — задиры, коррозия, выработка.
3. **Направляющие суппорта** — очистить и смазать спецсмазкой.
4. **Антискрипные пластины** и смазка тыльной стороны колодок.
5. **Качество колодок** — дешёвые часто скрипят, рекомендовать замену.

> Сначала исключаем критичный износ (безопасность!), потом боремся с самим скрипом.`,
    severity: 'low',
    tags: ['тормоза', 'скрип', 'колодки', 'диск'],
  },
];

// Optional sample onboarding course seeded once per tenant. Lessons are
// markdown; the last lesson carries a short quiz so the quiz flow is testable
// out of the box.
const SEED_COURSE: {
  title: string;
  description: string;
  lessons: { title: string; body: string; quiz?: QuizQuestion[] }[];
} = {
  title: 'Онбординг нового мастера',
  description: 'Короткий вводный курс для нового сотрудника автосервиса: приёмка, работа в приложении, безопасность.',
  lessons: [
    {
      title: 'Урок 1. Знакомство с сервисом',
      body: `# Добро пожаловать в команду

Этот курс поможет быстро влиться в работу.

## Что важно с первого дня
- Аккуратность и чистота на рабочем месте.
- Вежливое общение с клиентами.
- Любую работу фиксируем в приложении (заказ-наряд).

Пройдите все уроки и сдайте короткий тест в конце.`,
    },
    {
      title: 'Урок 2. Приёмка автомобиля',
      body: `# Приёмка авто

1. Уточните ФИО, телефон, госномер и пробег.
2. Запишите жалобу клиента своими словами.
3. Сделайте фото повреждений до начала работ.
4. Создайте заказ-наряд в разделе «Касса».

> Фото и замечания до работ защищают и сервис, и клиента.`,
    },
    {
      title: 'Урок 3. Безопасность и тест',
      body: `# Техника безопасности

- Работаем в спецодежде и СИЗ.
- Под авто только со страховочными стойками.
- Знаем, где огнетушитель и аварийный выход.

Ответьте на вопросы теста, чтобы завершить курс.`,
      quiz: [
        {
          question: 'Что нужно сделать ДО начала работ при приёмке авто?',
          options: [
            'Сразу разобрать узел',
            'Сфотографировать повреждения и создать заказ-наряд',
            'Ничего, начать ремонт',
          ],
          correctIndex: 1,
        },
        {
          question: 'Можно ли находиться под авто, стоящим только на домкрате?',
          options: ['Да, если быстро', 'Нет, нужны страховочные стойки'],
          correctIndex: 1,
        },
      ],
    },
  ],
};

// Roles allowed to write (create/update/delete). Read is open to any
// authenticated user — enforced at the controller via @Roles.
export const KNOWLEDGE_MANAGER_ROLES = ['director', 'admin', 'superadmin'];

// Quiz pass rule: a lesson quiz is passed only when ALL questions are answered
// correctly. Documented in the contract handed to mobile/web.
const QUIZ_PASS_ALL_CORRECT = true;

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger('KnowledgeService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
  ) {}

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

    // CORE seed (categories + articles, incl. «Регламенты») commits in its OWN
    // transaction. Once it commits, the gate above stops re-running the seed, so
    // the core content is guaranteed and never re-attempted.
    const seededCore = await this.seedKnowledgeCore(tenantID);

    // PHASE-2 sample content (troubleshooting / course / lessons) seeds in a
    // SEPARATE, best-effort transaction. A failure here is logged + swallowed
    // and can NOT roll back the already-committed core — so one bad sample row
    // can never leave a tenant with an empty Knowledge Base (the old
    // single-transaction bug: any phase-2 failure rolled back categories too,
    // emptying the KB and forcing every read to re-run the failing seed → slow
    // load + «пусто» + Sentry spam).
    if (seededCore) {
      await this.seedKnowledgePhase2(tenantID);
    }
  }

  /**
   * Seed the CORE knowledge base (categories + articles). Own transaction,
   * tenant-scoped advisory lock so concurrent first-reads serialise. Returns
   * true only if THIS call performed the insert (so the caller knows to run
   * phase-2). Never throws — a failure is logged and surfaces again next read.
   */
  private async seedKnowledgeCore(tenantID: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`knowledge_seed:${tenantID}`]);

      // Re-check inside the lock — another request may have seeded while we waited.
      const { rows: again } = await client.query('SELECT 1 FROM knowledge_categories WHERE tenant_id=$1 LIMIT 1', [
        tenantID,
      ]);
      if (again.length > 0) {
        await client.query('COMMIT');
        return false; // another request already seeded the core
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
      this.logger.log(`Seeded knowledge core for tenant ${tenantID}`);
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`seedKnowledgeCore failed for tenant ${tenantID}: ${err}`);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Seed PHASE-2 sample content (troubleshooting + onboarding course/lessons).
   * Separate transaction, BEST-EFFORT: a failure rolls back ONLY phase-2 and is
   * swallowed — the committed core (categories/articles/regulations) is never
   * touched. Each troubleshooting row is individually guarded so one bad sample
   * doesn't drop the rest. Idempotent: skips if a course already exists.
   */
  private async seedKnowledgePhase2(tenantID: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`knowledge_seed_phase2:${tenantID}`]);

      const { rows: existing } = await client.query('SELECT 1 FROM knowledge_courses WHERE tenant_id=$1 LIMIT 1', [
        tenantID,
      ]);
      if (existing.length > 0) {
        await client.query('COMMIT');
        return; // phase-2 already seeded
      }

      // Troubleshooting starter rows (справочник типовых неисправностей).
      for (const ts of SEED_TROUBLESHOOTING) {
        await client.query(
          `INSERT INTO knowledge_troubleshooting
             (tenant_id, title, system, symptom, cause, solution, severity, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tenantID, ts.title, ts.system, ts.symptom, ts.cause, ts.solution, ts.severity, ts.tags],
        );
      }

      // Sample onboarding course + lessons (учебный центр).
      const courseRes = await client.query(
        `INSERT INTO knowledge_courses (tenant_id, title, description, sort_order, published)
         VALUES ($1, $2, $3, 0, true) RETURNING id`,
        [tenantID, SEED_COURSE.title, SEED_COURSE.description],
      );
      const courseId = courseRes.rows[0].id;
      let lessonOrder = 0;
      for (const lesson of SEED_COURSE.lessons) {
        await client.query(
          `INSERT INTO knowledge_lessons (tenant_id, course_id, title, body, sort_order, quiz)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            tenantID,
            courseId,
            lesson.title,
            lesson.body,
            lessonOrder++,
            lesson.quiz ? JSON.stringify(lesson.quiz) : null,
          ],
        );
      }

      await client.query('COMMIT');
      this.logger.log(`Seeded knowledge phase-2 for tenant ${tenantID}`);
    } catch (err) {
      await client.query('ROLLBACK');
      // Best-effort: the core KB is already committed and fully usable; the
      // tenant just won't have the sample troubleshooting/course. Non-fatal.
      this.logger.error(`seedKnowledgePhase2 (best-effort) failed for tenant ${tenantID}: ${err}`);
    } finally {
      client.release();
    }
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  async listCategories(tenantID: string) {
    await this.ensureSeed(tenantID);
    const { rows } = await this.pool.query(
      `SELECT id, name, icon, sort_order, parent_id
       FROM knowledge_categories WHERE tenant_id=$1
       ORDER BY sort_order, name`,
      [tenantID],
    );
    return rows.map(mapCategory);
  }

  async createCategory(tenantID: string, dto: CreateCategoryDto) {
    const parentId = dto.parentId ?? null;
    // A brand-new category can't yet form a cycle, but its parent must exist in
    // the same tenant (passing null id → existence-only check).
    await this.assertCategoryParentValid(tenantID, null, parentId);
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_categories (tenant_id, name, icon, sort_order, parent_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, icon, sort_order, parent_id`,
      [tenantID, dto.name.trim(), dto.icon ?? null, dto.sortOrder ?? 0, parentId],
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
    if (dto.parentId !== undefined) {
      // Reject cycles (own-parent / ancestor loops) BEFORE writing. Validated
      // against the live tree so a category can never become its own ancestor.
      await this.assertCategoryParentValid(tenantID, id, dto.parentId ?? null);
      sets.push(`parent_id=$${i++}`);
      vals.push(dto.parentId ?? null);
    }
    if (sets.length === 0) {
      const existing = await this.getCategoryOrThrow(tenantID, id);
      return existing;
    }
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_categories SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i} RETURNING id, name, icon, sort_order, parent_id`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Категория не найдена' });
    return mapCategory(rows[0]);
  }

  async deleteCategory(tenantID: string, id: string) {
    // ON DELETE SET NULL on articles.category_id — articles survive, just lose
    // their category. ON DELETE SET NULL on knowledge_categories.parent_id (079)
    // — child categories survive too, orphaned back to the root level.
    const res = await this.pool.query('DELETE FROM knowledge_categories WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (res.rowCount === 0) throw new NotFoundException({ message: 'Категория не найдена' });
    return { message: 'Удалено' };
  }

  private async getCategoryOrThrow(tenantID: string, id: string) {
    const { rows } = await this.pool.query(
      'SELECT id, name, icon, sort_order, parent_id FROM knowledge_categories WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Категория не найдена' });
    return mapCategory(rows[0]);
  }

  /**
   * Validate a proposed parent for category `id` (null `id` = create). Ensures
   * the parent exists in this tenant and that assigning it introduces no cycle:
   * walking up from `parentId` must never reach `id` (which would make a
   * category its own ancestor). Rejects with 400 on violation. `seen` guards
   * against any pre-existing loop so the walk always terminates.
   */
  private async assertCategoryParentValid(tenantID: string, id: string | null, parentId: string | null): Promise<void> {
    if (parentId == null) return;
    if (id != null && parentId === id) {
      throw new BadRequestException({ message: 'Категория не может быть вложена сама в себя' });
    }
    const seen = new Set<string>();
    let cursor: string | null = parentId;
    while (cursor) {
      if (id != null && cursor === id) {
        throw new BadRequestException({ message: 'Циклическая вложенность категорий запрещена' });
      }
      if (seen.has(cursor)) break; // pre-existing loop safety — terminate the walk
      seen.add(cursor);
      const { rows }: { rows: { parent_id: string | null }[] } = await this.pool.query(
        'SELECT parent_id FROM knowledge_categories WHERE id=$1 AND tenant_id=$2',
        [cursor, tenantID],
      );
      if (rows.length === 0) {
        throw new BadRequestException({ message: 'Родительская категория не найдена' });
      }
      cursor = rows[0].parent_id;
    }
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
      // Body IS part of the search (title OR body), so a term that only appears
      // in the article body still matches.
      where.push(`(title ILIKE $${i} OR body ILIKE $${i})`);
      params.push(term);
      i++;
    }
    if (query.hasAttachmentType) {
      // Additive facet: keep articles whose `attachments` JSONB array holds at
      // least one element of the requested kind. `document` ALSO matches legacy
      // attachments stored without a `type` key (treated as documents) so the
      // facet stays backward-compatible with pre-video data. This is a pure
      // post-filter — it never touches the title+body search above.
      if (query.hasAttachmentType === 'document') {
        where.push(
          `EXISTS (
             SELECT 1 FROM jsonb_array_elements(attachments) AS att
             WHERE att->>'type' = $${i} OR (att->>'type') IS NULL
           )`,
        );
      } else {
        where.push(
          `EXISTS (
             SELECT 1 FROM jsonb_array_elements(attachments) AS att
             WHERE att->>'type' = $${i}
           )`,
        );
      }
      params.push(query.hasAttachmentType);
      i++;
    }

    const { rows } = await this.pool.query(
      `SELECT id, title, type, category_id, pinned, cover_image, updated_at,
              mandatory, due_date, car_make, view_count, blocks,
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
   * Global smart search across the whole base, tenant-scoped:
   *   - articles: title + body + block text (text/caption of every block),
   *     ranked title(3) > body(1) > block(1), then pinned, then recency;
   *   - categories: by name (cheap);
   *   - courses: by title/description (cheap, with per-user progress).
   * Non-managers only see published articles/courses. A query shorter than 2
   * chars returns empty buckets (avoids whole-table ILIKE scans). The title/body
   * predicates hit the pg_trgm GIN indexes (063); block text is a JSONB scan.
   */
  async search(tenantID: string, role: string, userID: string, rawQ: string) {
    await this.ensureSeed(tenantID);
    const q = (rawQ ?? '').trim();
    if (q.length < 2) {
      return { query: q, articles: [], categories: [], courses: [] };
    }
    const term = `%${q}%`;
    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);

    // Articles — title + body + block text. The block-text EXISTS subquery reads
    // every block's `text`/`caption` so a hit only inside a block still matches.
    const { rows: articleRows } = await this.pool.query(
      `SELECT id, title, type, category_id, pinned, cover_image, updated_at,
              mandatory, due_date, car_make, view_count, blocks,
              left(body, 200) AS excerpt_src,
              ( (CASE WHEN title ILIKE $2 THEN 3 ELSE 0 END)
              + (CASE WHEN body  ILIKE $2 THEN 1 ELSE 0 END)
              + (CASE WHEN EXISTS (
                    SELECT 1 FROM jsonb_array_elements(COALESCE(blocks, '[]'::jsonb)) AS b
                    WHERE (b->>'text') ILIKE $2 OR (b->>'caption') ILIKE $2
                  ) THEN 1 ELSE 0 END) ) AS score
       FROM knowledge_articles
       WHERE tenant_id=$1
         ${isManager ? '' : 'AND published = true'}
         AND ( title ILIKE $2 OR body ILIKE $2 OR EXISTS (
                 SELECT 1 FROM jsonb_array_elements(COALESCE(blocks, '[]'::jsonb)) AS b
                 WHERE (b->>'text') ILIKE $2 OR (b->>'caption') ILIKE $2
               ) )
       ORDER BY score DESC, pinned DESC, updated_at DESC
       LIMIT 50`,
      [tenantID, term],
    );

    // Categories — by name. Cheap; trigram index on name not present but the set
    // is small per tenant.
    const { rows: categoryRows } = await this.pool.query(
      `SELECT id, name, icon, sort_order, parent_id
       FROM knowledge_categories
       WHERE tenant_id=$1 AND name ILIKE $2
       ORDER BY name
       LIMIT 20`,
      [tenantID, term],
    );

    // Courses — by title/description, with per-user progress (same shape as
    // listCourses). $3 (userID) is always referenced — no orphan placeholder.
    const { rows: courseRows } = await this.pool.query(
      `SELECT c.id, c.title, c.description, c.cover_image, c.category_id, c.published,
              c.sort_order, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM knowledge_lessons l WHERE l.course_id = c.id)::int AS lesson_count,
              (SELECT COUNT(*) FROM knowledge_lessons l
                 JOIN knowledge_lesson_progress p ON p.lesson_id = l.id AND p.user_id = $3
                WHERE l.course_id = c.id)::int AS completed_lessons,
              EXISTS(
                SELECT 1 FROM knowledge_course_completion cc
                WHERE cc.course_id = c.id AND cc.user_id = $3
              ) AS completed
       FROM knowledge_courses c
       WHERE c.tenant_id=$1
         ${isManager ? '' : 'AND c.published = true'}
         AND (c.title ILIKE $2 OR c.description ILIKE $2)
       ORDER BY c.sort_order, c.created_at
       LIMIT 20`,
      [tenantID, term, userID],
    );

    return {
      query: q,
      articles: articleRows.map(mapArticleSlim),
      categories: categoryRows.map(mapCategory),
      courses: courseRows.map(mapCourseSlim),
    };
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
              a.version, a.mandatory, a.due_date, a.view_count, a.car_make, a.blocks,
              c.name AS category_name,
              -- Acked = an ack row exists AT THE CURRENT version. A bumped
              -- version (new revision) re-requires acknowledgment.
              EXISTS(
                SELECT 1 FROM knowledge_acknowledgments k
                WHERE k.article_id = a.id AND k.user_id = $3 AND k.version = a.version
              ) AS acknowledged,
              (SELECT COUNT(*) FROM knowledge_article_feedback f
                 WHERE f.article_id = a.id AND f.helpful = true)::int  AS helpful_count,
              (SELECT COUNT(*) FROM knowledge_article_feedback f
                 WHERE f.article_id = a.id AND f.helpful = false)::int AS not_helpful_count,
              (SELECT f.helpful FROM knowledge_article_feedback f
                 WHERE f.article_id = a.id AND f.user_id = $3) AS my_feedback
       FROM knowledge_articles a
       LEFT JOIN knowledge_categories c ON c.id = a.category_id
       WHERE a.id=$1 AND a.tenant_id=$2`,
      [id, tenantID, userID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    const row = rows[0];
    if (!isManager && !row.published) throw new NotFoundException({ message: 'Статья не найдена' });

    // Fire-and-forget view counter — never blocks the response, errors ignored.
    this.pool
      .query('UPDATE knowledge_articles SET view_count = view_count + 1 WHERE id=$1 AND tenant_id=$2', [id, tenantID])
      .catch((err) => this.logger.warn(`view_count bump failed for article ${id}: ${err}`));

    return mapArticleFull(row);
  }

  async createArticle(tenantID: string, createdBy: string | null, dto: CreateArticleDto) {
    const attachments = sanitizeAttachments(dto.attachments);
    // Deep-validate blocks; throws 400 on garbage / unknown type. Empty → NULL
    // column so renderers fall back to the markdown `body`.
    const blocks = validateBlocks(dto.blocks);
    const blocksJson = blocks.length ? JSON.stringify(blocks) : null;
    const type = dto.type ?? 'article';
    const mandatory = dto.mandatory ?? false;
    const published = dto.published ?? true;
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_articles
         (tenant_id, category_id, type, title, body, cover_image, attachments, pinned, published,
          created_by, mandatory, due_date, car_make, blocks)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14::jsonb)
       RETURNING id, category_id, type, title, body, cover_image, attachments, pinned, published,
                 created_by, created_at, updated_at, version, mandatory, due_date, view_count, car_make, blocks`,
      [
        tenantID,
        dto.categoryId ?? null,
        type,
        dto.title.trim(),
        dto.body ?? '',
        dto.coverImage ?? null,
        JSON.stringify(attachments),
        dto.pinned ?? false,
        published,
        createdBy,
        mandatory,
        dto.dueDate ?? null,
        dto.carMake ?? null,
        blocksJson,
      ],
    );
    const row = rows[0];

    // Push «новый обязательный регламент» on assignment when a published
    // mandatory regulation is created. There is NO recurring scheduler for KB
    // reminders — this push-on-assignment + the due-date display are the only
    // surfacing. Fire-and-forget after the commit.
    if (type === 'regulation' && mandatory && published) {
      void this.notifyMandatoryRegulation(tenantID, createdBy, row.title, row.due_date);
    }

    return mapArticleFull({
      ...row,
      category_name: null,
      acknowledged: false,
      helpful_count: 0,
      not_helpful_count: 0,
      my_feedback: null,
    });
  }

  async updateArticle(tenantID: string, id: string, dto: UpdateArticleDto) {
    // Need the current row to decide on a version bump and detect a
    // not-mandatory → mandatory transition for the assignment push.
    const { rows: cur } = await this.pool.query(
      `SELECT type, body, mandatory, published FROM knowledge_articles WHERE id=$1 AND tenant_id=$2`,
      [id, tenantID],
    );
    if (cur.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    const before = cur[0];

    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException({ message: 'Заголовок не может быть пустым' });
      sets.push(`title=$${i++}`);
      vals.push(t);
    }
    const bodyChanged = dto.body !== undefined && dto.body !== before.body;
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
    if (dto.blocks !== undefined) {
      // Deep-validate (throws 400 on garbage). [] → NULL so the renderer falls
      // back to `body`. `body` is never touched here — both can coexist.
      const blocks = validateBlocks(dto.blocks);
      sets.push(`blocks=$${i++}::jsonb`);
      vals.push(blocks.length ? JSON.stringify(blocks) : null);
    }
    if (dto.pinned !== undefined) {
      sets.push(`pinned=$${i++}`);
      vals.push(dto.pinned);
    }
    if (dto.published !== undefined) {
      sets.push(`published=$${i++}`);
      vals.push(dto.published);
    }
    if (dto.mandatory !== undefined) {
      sets.push(`mandatory=$${i++}`);
      vals.push(dto.mandatory);
    }
    if (dto.dueDate !== undefined) {
      sets.push(`due_date=$${i++}`);
      vals.push(dto.dueDate ?? null);
    }
    if (dto.carMake !== undefined) {
      sets.push(`car_make=$${i++}`);
      vals.push(dto.carMake ?? null);
    }

    // Version bump: an explicit bumpVersion request OR a real body change on a
    // regulation increments version → re-requires acknowledgment of the new
    // revision. Only regulations carry an ack flow, so only they bump.
    const effectiveType = dto.type ?? before.type;
    const shouldBump = effectiveType === 'regulation' && (dto.bumpVersion === true || bodyChanged);
    if (shouldBump) {
      sets.push(`version = version + 1`);
    }

    // Always bump updated_at so the list re-sorts the edited article to top.
    sets.push(`updated_at=now()`);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_articles SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i}
       RETURNING id, category_id, type, title, body, cover_image, attachments, pinned, published,
                 created_by, created_at, updated_at, version, mandatory, due_date, view_count, car_make, blocks`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    const row = rows[0];

    // Push on assignment when the article becomes (or stays) a published
    // mandatory regulation AND something material changed for the audience: it
    // just became mandatory, OR it just got published, OR a new version was
    // cut. Avoids re-pushing on a cosmetic edit of an already-known regulation.
    const isMandatoryReg = row.type === 'regulation' && row.mandatory && row.published;
    const becameMandatory = !before.mandatory && row.mandatory;
    const becamePublished = !before.published && row.published;
    if (isMandatoryReg && (becameMandatory || becamePublished || shouldBump)) {
      void this.notifyMandatoryRegulation(tenantID, null, row.title, row.due_date);
    }

    return mapArticleFull({
      ...row,
      category_name: null,
      acknowledged: false,
      helpful_count: 0,
      not_helpful_count: 0,
      my_feedback: null,
    });
  }

  /**
   * Visible push to every tenant user (except the actor) that a new mandatory
   * regulation needs acknowledgment. Best-effort, fire-and-forget; push is
   * never the source of truth. No recurring reminders — this is the single
   * notification (plus the in-app due-date display + pending count).
   */
  private async notifyMandatoryRegulation(
    tenantID: string,
    excludeUserId: string | null,
    title: string,
    dueDate: Date | string | null,
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(
        `SELECT id FROM users
          WHERE tenant_id=$1 AND is_active = true AND role <> 'superadmin'
            AND ($2::uuid IS NULL OR id <> $2)`,
        [tenantID, excludeUserId],
      );
      const due = dueDate ? ` (до ${formatDueDate(dueDate)})` : '';
      const body = `Ознакомьтесь: «${title}»${due}`;
      await Promise.all(
        rows.map((r: { id: string }) =>
          this.push.sendToUserCategory(r.id, 'knowledge', 'Новый обязательный регламент', body, {
            type: 'knowledge-mandatory-regulation',
            tenantId: tenantID,
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`notifyMandatoryRegulation failed for tenant ${tenantID}: ${err}`);
    }
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
    // We also read the current version so the ack is recorded against it.
    const { rows: art } = await this.pool.query(
      'SELECT version FROM knowledge_articles WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [articleID, tenantID],
    );
    if (art.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    const version: number = art[0].version ?? 1;

    // Upsert: if a stale ack (older version) exists, bump it to the current
    // version + refresh the timestamp so "acknowledged" reflects the revision
    // the user actually read.
    await this.pool.query(
      `INSERT INTO knowledge_acknowledgments (tenant_id, article_id, user_id, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (article_id, user_id)
       DO UPDATE SET version = EXCLUDED.version, acknowledged_at = now()`,
      [tenantID, articleID, userID, version],
    );
    const { rows } = await this.pool.query(
      'SELECT acknowledged_at, version FROM knowledge_acknowledgments WHERE article_id=$1 AND user_id=$2',
      [articleID, userID],
    );
    return { acknowledgedAt: rows[0]?.acknowledged_at ?? null, version: rows[0]?.version ?? version };
  }

  /**
   * Upsert helpful / not-helpful feedback for the current user on an article.
   * One vote per user; re-voting flips it. Returns the fresh counts + the
   * user's own vote.
   */
  async articleFeedback(tenantID: string, userID: string, articleID: string, dto: ArticleFeedbackDto) {
    const { rows: art } = await this.pool.query(
      'SELECT 1 FROM knowledge_articles WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [articleID, tenantID],
    );
    if (art.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });

    await this.pool.query(
      `INSERT INTO knowledge_article_feedback (tenant_id, article_id, user_id, helpful)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (article_id, user_id)
       DO UPDATE SET helpful = EXCLUDED.helpful, created_at = now()`,
      [tenantID, articleID, userID, dto.helpful],
    );

    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE helpful = true)::int  AS helpful_count,
         COUNT(*) FILTER (WHERE helpful = false)::int AS not_helpful_count
       FROM knowledge_article_feedback WHERE article_id=$1`,
      [articleID],
    );
    return {
      helpfulCount: rows[0]?.helpful_count ?? 0,
      notHelpfulCount: rows[0]?.not_helpful_count ?? 0,
      myFeedback: dto.helpful,
    };
  }

  /**
   * Who acknowledged an article + who hasn't yet. The `acknowledged` list is
   * the users who acked (with name + timestamp); `pending` is the active tenant
   * users who have NOT acked. Lets the owner see "8/10 ознакомлены".
   */
  async listAcks(tenantID: string, articleID: string) {
    const { rows: art } = await this.pool.query(
      'SELECT version FROM knowledge_articles WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [articleID, tenantID],
    );
    if (art.length === 0) throw new NotFoundException({ message: 'Статья не найдена' });
    const version: number = art[0].version ?? 1;

    // Acked at the CURRENT version only — a stale ack (older version) does not
    // count, so a re-published revision shows the user as pending again.
    const { rows: acked } = await this.pool.query(
      `SELECT k.user_id, u.full_name, k.acknowledged_at
       FROM knowledge_acknowledgments k
       JOIN users u ON u.id = k.user_id
       WHERE k.tenant_id=$1 AND k.article_id=$2 AND k.version=$3
       ORDER BY k.acknowledged_at DESC`,
      [tenantID, articleID, version],
    );

    // Active tenant users who have NOT acked the current version. We only count
    // "real" employees (active, non-superadmin) — same audience that must read
    // regulations.
    const { rows: pending } = await this.pool.query(
      `SELECT u.id AS user_id, u.full_name
       FROM users u
       WHERE u.tenant_id=$1 AND u.is_active = true AND u.role <> 'superadmin'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_acknowledgments k
           WHERE k.article_id=$2 AND k.user_id = u.id AND k.version=$3
         )
       ORDER BY u.full_name`,
      [tenantID, articleID, version],
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
           WHERE k.article_id = a.id AND k.user_id = $2 AND k.version = a.version
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
             WHERE k.article_id = a.id AND k.user_id = $2 AND k.version = a.version
           )
         )::int AS acknowledged
       FROM knowledge_articles a
       WHERE a.tenant_id=$1 AND a.type='regulation' AND a.published = true`,
      [tenantID, userID],
    );
    return { total: rows[0]?.total ?? 0, acknowledged: rows[0]?.acknowledged ?? 0 };
  }

  // ─── A. Учебный центр — courses ─────────────────────────────────────────────

  /**
   * Slim course list with per-user progress %. Non-managers only see published
   * courses; managers see drafts too. `lessonCount` + `completedLessons` drive
   * the progress bar; `completed` reflects the course_completion row.
   */
  async listCourses(tenantID: string, role: string, userID: string) {
    await this.ensureSeed(tenantID);
    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);
    // NOTE: `isManager` is interpolated into the SQL text (it only toggles the
    // `published` predicate) and must NOT appear in the parameter array — an
    // unused $n placeholder makes Postgres fail the parse with
    // `could not determine data type of parameter` → 500 on every request.
    const { rows } = await this.pool.query(
      `SELECT c.id, c.title, c.description, c.cover_image, c.category_id, c.published,
              c.sort_order, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM knowledge_lessons l WHERE l.course_id = c.id)::int AS lesson_count,
              (SELECT COUNT(*) FROM knowledge_lessons l
                 JOIN knowledge_lesson_progress p
                   ON p.lesson_id = l.id AND p.user_id = $2
                WHERE l.course_id = c.id)::int AS completed_lessons,
              EXISTS(
                SELECT 1 FROM knowledge_course_completion cc
                WHERE cc.course_id = c.id AND cc.user_id = $2
              ) AS completed
       FROM knowledge_courses c
       WHERE c.tenant_id=$1 ${isManager ? '' : 'AND c.published = true'}
       ORDER BY c.sort_order, c.created_at`,
      [tenantID, userID],
    );
    return rows.map(mapCourseSlim);
  }

  /** Full course: lessons (with quiz presence + per-user completed flags) + progress. */
  async getCourse(tenantID: string, role: string, userID: string, id: string) {
    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);
    const { rows: cRows } = await this.pool.query(
      `SELECT c.id, c.title, c.description, c.cover_image, c.category_id, c.published,
              c.sort_order, c.created_at, c.updated_at,
              EXISTS(
                SELECT 1 FROM knowledge_course_completion cc
                WHERE cc.course_id = c.id AND cc.user_id = $3
              ) AS completed
       FROM knowledge_courses c
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [id, tenantID, userID],
    );
    if (cRows.length === 0) throw new NotFoundException({ message: 'Курс не найден' });
    const course = cRows[0];
    if (!isManager && !course.published) throw new NotFoundException({ message: 'Курс не найден' });

    const { rows: lessons } = await this.pool.query(
      `SELECT l.id, l.title, l.body, l.sort_order, l.quiz, l.created_at, l.updated_at,
              (p.lesson_id IS NOT NULL) AS completed
       FROM knowledge_lessons l
       LEFT JOIN knowledge_lesson_progress p
              ON p.lesson_id = l.id AND p.user_id = $2
       WHERE l.course_id = $1
       ORDER BY l.sort_order, l.created_at`,
      [id, userID],
    );

    const lessonCount = lessons.length;
    const completedLessons = lessons.filter((l) => l.completed).length;
    return {
      ...mapCourseSlim({
        ...course,
        lesson_count: lessonCount,
        completed_lessons: completedLessons,
      }),
      // Managers get full quiz (with correct answers) for editing; everyone gets
      // lesson body + a `hasQuiz` flag. Non-managers never receive correctIndex.
      lessons: lessons.map((l) => mapLesson(l, isManager)),
    };
  }

  async createCourse(tenantID: string, createdBy: string | null, dto: CreateCourseDto) {
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_courses
         (tenant_id, title, description, cover_image, category_id, published, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, cover_image, category_id, published, sort_order,
                 created_at, updated_at`,
      [
        tenantID,
        dto.title.trim(),
        dto.description ?? '',
        dto.coverImage ?? null,
        dto.categoryId ?? null,
        dto.published ?? true,
        dto.sortOrder ?? 0,
        createdBy,
      ],
    );
    return mapCourseSlim({ ...rows[0], lesson_count: 0, completed_lessons: 0, completed: false });
  }

  async updateCourse(tenantID: string, id: string, dto: UpdateCourseDto) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException({ message: 'Название курса не может быть пустым' });
      sets.push(`title=$${i++}`);
      vals.push(t);
    }
    if (dto.description !== undefined) {
      sets.push(`description=$${i++}`);
      vals.push(dto.description);
    }
    if (dto.coverImage !== undefined) {
      sets.push(`cover_image=$${i++}`);
      vals.push(dto.coverImage ?? null);
    }
    if (dto.categoryId !== undefined) {
      sets.push(`category_id=$${i++}`);
      vals.push(dto.categoryId ?? null);
    }
    if (dto.published !== undefined) {
      sets.push(`published=$${i++}`);
      vals.push(dto.published);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order=$${i++}`);
      vals.push(dto.sortOrder);
    }
    sets.push(`updated_at=now()`);
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_courses SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i}
       RETURNING id, title, description, cover_image, category_id, published, sort_order,
                 created_at, updated_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Курс не найден' });
    return mapCourseSlim({ ...rows[0], lesson_count: 0, completed_lessons: 0, completed: false });
  }

  async deleteCourse(tenantID: string, id: string) {
    // ON DELETE CASCADE removes lessons, progress and completion rows.
    const res = await this.pool.query('DELETE FROM knowledge_courses WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (res.rowCount === 0) throw new NotFoundException({ message: 'Курс не найден' });
    return { message: 'Удалено' };
  }

  // ─── A. Lessons (nested under a course) ─────────────────────────────────────

  private async assertCourse(tenantID: string, courseID: string) {
    const { rows } = await this.pool.query('SELECT 1 FROM knowledge_courses WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      courseID,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Курс не найден' });
  }

  async createLesson(tenantID: string, courseID: string, dto: CreateLessonDto) {
    await this.assertCourse(tenantID, courseID);
    const quiz = sanitizeQuiz(dto.quiz);
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_lessons (tenant_id, course_id, title, body, sort_order, quiz)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, title, body, sort_order, quiz, created_at, updated_at`,
      [tenantID, courseID, dto.title.trim(), dto.body ?? '', dto.sortOrder ?? 0, quiz ? JSON.stringify(quiz) : null],
    );
    return mapLesson({ ...rows[0], completed: false }, true);
  }

  async updateLesson(tenantID: string, lessonID: string, dto: UpdateLessonDto) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException({ message: 'Название урока не может быть пустым' });
      sets.push(`title=$${i++}`);
      vals.push(t);
    }
    if (dto.body !== undefined) {
      sets.push(`body=$${i++}`);
      vals.push(dto.body);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order=$${i++}`);
      vals.push(dto.sortOrder);
    }
    if (dto.quiz !== undefined) {
      const quiz = sanitizeQuiz(dto.quiz);
      sets.push(`quiz=$${i++}::jsonb`);
      vals.push(quiz ? JSON.stringify(quiz) : null);
    }
    sets.push(`updated_at=now()`);
    vals.push(lessonID, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_lessons SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i}
       RETURNING id, title, body, sort_order, quiz, created_at, updated_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Урок не найден' });
    return mapLesson({ ...rows[0], completed: false }, true);
  }

  async deleteLesson(tenantID: string, lessonID: string) {
    const res = await this.pool.query('DELETE FROM knowledge_lessons WHERE id=$1 AND tenant_id=$2', [
      lessonID,
      tenantID,
    ]);
    if (res.rowCount === 0) throw new NotFoundException({ message: 'Урок не найден' });
    return { message: 'Удалено' };
  }

  // ─── A. Lesson completion + course completion ───────────────────────────────

  /**
   * Mark a lesson done for the current user. If the lesson has a quiz, the
   * answers must PASS (all correct — see QUIZ_PASS_ALL_CORRECT) or we throw 400
   * and do NOT record progress. When this completion makes every lesson in the
   * course done, upsert a course_completion row and (best-effort) award an
   * achievement. Runs in one transaction.
   */
  async completeLesson(tenantID: string, userID: string, lessonID: string, dto: CompleteLessonDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: lr } = await client.query(
        `SELECT l.id, l.course_id, l.quiz, c.title AS course_title
         FROM knowledge_lessons l
         JOIN knowledge_courses c ON c.id = l.course_id
         WHERE l.id=$1 AND l.tenant_id=$2`,
        [lessonID, tenantID],
      );
      if (lr.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Урок не найден' });
      }
      const lesson = lr[0];
      const quiz = parseQuiz(lesson.quiz);

      // Quiz gate.
      if (quiz.length > 0) {
        const answers = Array.isArray(dto.answers) ? dto.answers : [];
        const { passed, correct } = gradeQuiz(quiz, answers);
        if (!passed) {
          await client.query('ROLLBACK');
          throw new BadRequestException({
            message: 'Тест не пройден. Проверьте ответы и попробуйте снова.',
            correct,
            total: quiz.length,
          });
        }
      }

      await client.query(
        `INSERT INTO knowledge_lesson_progress (tenant_id, user_id, lesson_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, lesson_id) DO NOTHING`,
        [tenantID, userID, lessonID],
      );

      // Course fully done? Count lessons vs the user's completed lessons.
      const { rows: counts } = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM knowledge_lessons l WHERE l.course_id=$1)::int AS total,
           (SELECT COUNT(*) FROM knowledge_lessons l
              JOIN knowledge_lesson_progress p ON p.lesson_id = l.id AND p.user_id=$2
             WHERE l.course_id=$1)::int AS done`,
        [lesson.course_id, userID],
      );
      const total: number = counts[0]?.total ?? 0;
      const done: number = counts[0]?.done ?? 0;
      let courseCompleted = false;

      if (total > 0 && done >= total) {
        const ins = await client.query(
          `INSERT INTO knowledge_course_completion (tenant_id, user_id, course_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, course_id) DO NOTHING
           RETURNING id`,
          [tenantID, userID, lesson.course_id],
        );
        courseCompleted = true;
        // Award an achievement only on the first completion (RETURNING id is
        // empty when the row already existed). Same-transaction insert keeps it
        // consistent; key is deterministic so re-runs never duplicate.
        if (ins.rowCount && ins.rowCount > 0) {
          await this.awardCourseAchievement(client, tenantID, userID, lesson.course_id, lesson.course_title);
        }
      }

      await client.query('COMMIT');
      return {
        lessonId: lessonID,
        lessonCompleted: true,
        courseId: lesson.course_id,
        courseCompleted,
        progress: { completed: done, total },
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Best-effort employee achievement on first course completion. Mirrors
   * employees.addAchievement's INSERT but stays self-contained (no cross-module
   * service call) so a schema drift there can't break the learning flow. A
   * deterministic key (`course_complete_<courseId>`) makes it idempotent.
   */
  private async awardCourseAchievement(
    client: PoolClient,
    tenantID: string,
    userID: string,
    courseID: string,
    courseTitle: string,
  ): Promise<void> {
    try {
      await client.query(
        `INSERT INTO employee_achievements
           (user_id, tenant_id, key, name, description, icon, color, type, awarded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'custom', NULL)
         ON CONFLICT DO NOTHING`,
        [
          userID,
          tenantID,
          `course_complete_${courseID}`,
          `Прошёл курс: ${String(courseTitle).slice(0, 80)}`.slice(0, 100),
          'Курс пройден в учебном центре',
          'school-outline',
          '#34C759',
        ],
      );
    } catch (err) {
      // Non-fatal: if employee_achievements has a unique key conflict or any
      // other issue, the course completion still stands.
      this.logger.warn(`awardCourseAchievement skipped for user ${userID}, course ${courseID}: ${err}`);
    }
  }

  /** Manager view of any employee's progress in a course (employee card). */
  async courseProgressForUser(tenantID: string, courseID: string, userID: string) {
    await this.assertCourse(tenantID, courseID);
    const { rows: u } = await this.pool.query('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      userID,
      tenantID,
    ]);
    if (u.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });

    const { rows } = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_lessons l WHERE l.course_id=$1)::int AS total,
         (SELECT COUNT(*) FROM knowledge_lessons l
            JOIN knowledge_lesson_progress p ON p.lesson_id = l.id AND p.user_id=$2
           WHERE l.course_id=$1)::int AS completed,
         (SELECT cc.completed_at FROM knowledge_course_completion cc
           WHERE cc.course_id=$1 AND cc.user_id=$2) AS completed_at`,
      [courseID, userID],
    );
    const total: number = rows[0]?.total ?? 0;
    const completed: number = rows[0]?.completed ?? 0;
    return {
      courseId: courseID,
      userId: userID,
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      completedAt: rows[0]?.completed_at ?? null,
    };
  }

  // ─── C. Troubleshooting (типовые неисправности) ─────────────────────────────

  async listTroubleshooting(tenantID: string, query: ListTroubleshootingQueryDto) {
    await this.ensureSeed(tenantID);
    const where: string[] = ['tenant_id=$1'];
    const params: any[] = [tenantID];
    let i = 2;

    if (query.system) {
      where.push(`system=$${i++}`);
      params.push(query.system);
    }
    if (query.carMake) {
      where.push(`car_make=$${i++}`);
      params.push(query.carMake);
    }
    if (query.tag) {
      where.push(`$${i++} = ANY(tags)`);
      params.push(query.tag);
    }
    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      // Raw indexed columns → trigram GIN usable.
      where.push(`(title ILIKE $${i} OR symptom ILIKE $${i} OR cause ILIKE $${i} OR solution ILIKE $${i})`);
      params.push(term);
      i++;
    }

    const { rows } = await this.pool.query(
      `SELECT id, title, system, car_make, symptom, cause, solution, severity, tags,
              created_at, updated_at
       FROM knowledge_troubleshooting
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT 500`,
      params,
    );
    return rows.map(mapTroubleshooting);
  }

  async getTroubleshooting(tenantID: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT id, title, system, car_make, symptom, cause, solution, severity, tags,
              created_at, updated_at
       FROM knowledge_troubleshooting WHERE id=$1 AND tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    return mapTroubleshooting(rows[0]);
  }

  async createTroubleshooting(tenantID: string, createdBy: string | null, dto: CreateTroubleshootingDto) {
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_troubleshooting
         (tenant_id, title, system, car_make, symptom, cause, solution, severity, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, title, system, car_make, symptom, cause, solution, severity, tags,
                 created_at, updated_at`,
      [
        tenantID,
        dto.title.trim(),
        dto.system ?? null,
        dto.carMake ?? null,
        dto.symptom ?? '',
        dto.cause ?? '',
        dto.solution ?? '',
        dto.severity ?? null,
        sanitizeTags(dto.tags),
        createdBy,
      ],
    );
    return mapTroubleshooting(rows[0]);
  }

  async updateTroubleshooting(tenantID: string, id: string, dto: UpdateTroubleshootingDto) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException({ message: 'Заголовок не может быть пустым' });
      sets.push(`title=$${i++}`);
      vals.push(t);
    }
    if (dto.system !== undefined) {
      sets.push(`system=$${i++}`);
      vals.push(dto.system ?? null);
    }
    if (dto.carMake !== undefined) {
      sets.push(`car_make=$${i++}`);
      vals.push(dto.carMake ?? null);
    }
    if (dto.symptom !== undefined) {
      sets.push(`symptom=$${i++}`);
      vals.push(dto.symptom);
    }
    if (dto.cause !== undefined) {
      sets.push(`cause=$${i++}`);
      vals.push(dto.cause);
    }
    if (dto.solution !== undefined) {
      sets.push(`solution=$${i++}`);
      vals.push(dto.solution);
    }
    if (dto.severity !== undefined) {
      sets.push(`severity=$${i++}`);
      vals.push(dto.severity ?? null);
    }
    if (dto.tags !== undefined) {
      sets.push(`tags=$${i++}`);
      vals.push(sanitizeTags(dto.tags));
    }
    sets.push(`updated_at=now()`);
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE knowledge_troubleshooting SET ${sets.join(', ')}
       WHERE id=$${i++} AND tenant_id=$${i}
       RETURNING id, title, system, car_make, symptom, cause, solution, severity, tags,
                 created_at, updated_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    return mapTroubleshooting(rows[0]);
  }

  async deleteTroubleshooting(tenantID: string, id: string) {
    const res = await this.pool.query('DELETE FROM knowledge_troubleshooting WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (res.rowCount === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    return { message: 'Удалено' };
  }

  // ─── D. Contextual KB (for a check/car) ─────────────────────────────────────

  /**
   * Union of KB relevant to a car make:
   *   - published articles where car_make IS NULL (general) OR matches the make;
   *   - troubleshooting entries where car_make matches the make (case-insensitive).
   * `model` is accepted for forward-compat but not yet filtered on (we key on
   * make only — keeps it simple, as specified).
   */
  async forCar(tenantID: string, role: string, query: ForCarQueryDto) {
    await this.ensureSeed(tenantID);
    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);
    const make = query.make?.trim() || null;

    // Articles: general (car_make null) + make-specific. When no make is given,
    // we only return general articles (car_make null).
    const { rows: articles } = await this.pool.query(
      `SELECT id, title, type, category_id, pinned, cover_image, updated_at,
              mandatory, due_date, car_make, view_count,
              left(body, 200) AS excerpt_src
       FROM knowledge_articles
       WHERE tenant_id=$1
         ${isManager ? '' : 'AND published = true'}
         AND (car_make IS NULL OR ($2::text IS NOT NULL AND lower(car_make) = lower($2)))
       ORDER BY pinned DESC, updated_at DESC
       LIMIT 100`,
      [tenantID, make],
    );

    let troubleshooting: any[] = [];
    if (make) {
      const { rows: ts } = await this.pool.query(
        `SELECT id, title, system, car_make, symptom, cause, solution, severity, tags,
                created_at, updated_at
         FROM knowledge_troubleshooting
         WHERE tenant_id=$1 AND car_make IS NOT NULL AND lower(car_make) = lower($2)
         ORDER BY updated_at DESC
         LIMIT 100`,
        [tenantID, make],
      );
      troubleshooting = ts;
    }

    return {
      make,
      model: query.model?.trim() || null,
      articles: articles.map(mapArticleSlim),
      troubleshooting: troubleshooting.map(mapTroubleshooting),
    };
  }

  /**
   * Articles in a category named «Чек-листы» (checklists) — a thin convenience
   * over listArticles. No check-flow data model is touched; the mobile agent
   * just surfaces these. Returns [] if no such category exists.
   */
  async listChecklists(tenantID: string, role: string) {
    await this.ensureSeed(tenantID);
    const isManager = KNOWLEDGE_MANAGER_ROLES.includes(role);
    const { rows } = await this.pool.query(
      `SELECT a.id, a.title, a.type, a.category_id, a.pinned, a.cover_image, a.updated_at,
              a.mandatory, a.due_date, a.car_make, a.view_count,
              left(a.body, 200) AS excerpt_src
       FROM knowledge_articles a
       JOIN knowledge_categories c ON c.id = a.category_id
       WHERE a.tenant_id=$1 AND lower(c.name) = 'чек-листы'
         ${isManager ? '' : 'AND a.published = true'}
       ORDER BY a.pinned DESC, a.updated_at DESC
       LIMIT 200`,
      [tenantID],
    );
    return rows.map(mapArticleSlim);
  }
}

// ─── Mappers / helpers ───────────────────────────────────────────────────────

function mapCategory(r: any) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon ?? undefined,
    sortOrder: r.sort_order ?? 0,
    // 079: parent for folders/subfolders. null/absent = root-level category.
    parentId: r.parent_id ?? undefined,
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
    mandatory: !!r.mandatory,
    dueDate: r.due_date ?? undefined,
    carMake: r.car_make ?? undefined,
    viewCount: r.view_count ?? 0,
    // 079: present only when the SELECT pulled the `blocks` column; undefined
    // (omitted) otherwise. Empty/null blocks → undefined (fall back to body).
    blocks: parseBlocks(r.blocks),
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
    // 079: ordered block content. undefined when empty/null → render `body`.
    blocks: parseBlocks(r.blocks),
    coverImage: r.cover_image ?? undefined,
    attachments: parseAttachments(r.attachments),
    pinned: !!r.pinned,
    published: !!r.published,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    acknowledged: r.type === 'regulation' ? !!r.acknowledged : undefined,
    version: r.version ?? 1,
    mandatory: !!r.mandatory,
    dueDate: r.due_date ?? undefined,
    viewCount: r.view_count ?? 0,
    carMake: r.car_make ?? undefined,
    helpfulCount: r.helpful_count ?? 0,
    notHelpfulCount: r.not_helpful_count ?? 0,
    myFeedback: r.my_feedback === null || r.my_feedback === undefined ? undefined : !!r.my_feedback,
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

const ATTACHMENT_TYPES: readonly AttachmentType[] = ['image', 'video', 'document'];
const VIDEO_TYPES: readonly VideoType[] = ['youtube', 'vk', 'embed'];

// Only these hosts are accepted for `type: 'video'` attachments. Keeps untrusted
// arbitrary URLs out of an embeddable <iframe>/player surface.
const ALLOWED_VIDEO_HOSTS: readonly string[] = ['youtube.com', 'youtu.be', 'vk.com', 'vimeo.com'];

/**
 * True when `url` is a well-formed http(s) URL on a whitelisted video host
 * (or one of its subdomains, e.g. `www.youtube.com`, `m.vk.com`). Anything else
 * — javascript:, data:, foreign hosts, malformed strings — is rejected so a
 * `type: 'video'` attachment can never smuggle an arbitrary embed URL.
 */
function isValidVideoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Normalise the attachments array before persisting / returning.
 *
 * Backward-compatible: legacy attachments have no `type` and are kept untouched
 * (no `type` field added — the client treats an absent type as document/image).
 * When `type` is present it must be a known kind, else it's dropped. For
 * `type: 'video'` the URL must pass `isValidVideoUrl` (youtube/youtu.be/vk/
 * vimeo) — an invalid video attachment is discarded entirely. `videoType` is
 * only carried through for video attachments and must be a known value.
 */
function sanitizeAttachments(input: unknown): Attachment[] {
  if (!Array.isArray(input)) return [];
  const out: Attachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const url = (raw as any).url;
    const name = (raw as any).name;
    if (typeof url !== 'string' || !url) continue;

    const rawType = (raw as any).type;
    const type =
      typeof rawType === 'string' && ATTACHMENT_TYPES.includes(rawType as AttachmentType)
        ? (rawType as AttachmentType)
        : undefined;

    // Drop a video attachment whose URL isn't on the whitelist (security:
    // arbitrary embeddable URLs). Legacy / non-video attachments are unaffected.
    if (type === 'video' && !isValidVideoUrl(url)) continue;

    const att: Attachment = { url, name: typeof name === 'string' && name ? name : url };
    const size = (raw as any).size;
    if (typeof size === 'number' && Number.isFinite(size)) att.size = size;
    if (type) att.type = type;
    if (type === 'video') {
      const rawVideoType = (raw as any).videoType;
      if (typeof rawVideoType === 'string' && VIDEO_TYPES.includes(rawVideoType as VideoType)) {
        att.videoType = rawVideoType as VideoType;
      }
    }
    out.push(att);
  }
  return out;
}

// ─── Article blocks (079) ─────────────────────────────────────────────────────

const BLOCK_HEADING_LEVELS: readonly number[] = [2, 3];

/**
 * True when `url` is a well-formed http(s) URL on a VK host (vk.com / vk.ru /
 * vkvideo.ru, or a subdomain). VK video embeds are `vk.com/video_ext.php?...`;
 * shareable links are `vk.com/video-123_456`. Anything else — other hosts,
 * javascript:/data:, malformed strings — is rejected so a `video` block can
 * never smuggle an arbitrary embed URL.
 */
function isVkVideoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  const VK_HOSTS = ['vk.com', 'vk.ru', 'vkvideo.ru', 'm.vk.com'];
  return VK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Deep-validate the block array supplied by the client and return a normalised,
 * trusted copy. Throws BadRequestException (→ 400) on ANY malformed input:
 * not-an-array, non-object element, unknown `type`, missing required field of a
 * known type, bad heading level, or a non-VK video URL. No silent dropping —
 * garbage is rejected outright. null/undefined → [] (caller stores NULL).
 */
function validateBlocks(input: unknown): KnowledgeBlock[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new BadRequestException({ message: 'blocks должен быть массивом' });
  }
  const out: KnowledgeBlock[] = [];
  input.forEach((raw, idx) => {
    const n = idx + 1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException({ message: `Блок #${n}: ожидается объект` });
    }
    const b = raw as Record<string, unknown>;
    switch (b.type) {
      case 'text': {
        if (typeof b.text !== 'string') {
          throw new BadRequestException({ message: `Блок #${n} (text): поле text обязательно` });
        }
        out.push({ type: 'text', text: b.text });
        break;
      }
      case 'heading': {
        if (typeof b.text !== 'string') {
          throw new BadRequestException({ message: `Блок #${n} (heading): поле text обязательно` });
        }
        const block: KnowledgeBlock = { type: 'heading', text: b.text };
        if (b.level !== undefined) {
          if (typeof b.level !== 'number' || !BLOCK_HEADING_LEVELS.includes(b.level)) {
            throw new BadRequestException({ message: `Блок #${n} (heading): level должен быть 2 или 3` });
          }
          block.level = b.level as 2 | 3;
        }
        out.push(block);
        break;
      }
      case 'image': {
        if (typeof b.url !== 'string' || !b.url) {
          throw new BadRequestException({ message: `Блок #${n} (image): поле url обязательно` });
        }
        const block: KnowledgeBlock = { type: 'image', url: b.url };
        if (b.caption !== undefined) {
          if (typeof b.caption !== 'string') {
            throw new BadRequestException({ message: `Блок #${n} (image): caption должен быть строкой` });
          }
          block.caption = b.caption;
        }
        out.push(block);
        break;
      }
      case 'video': {
        if (b.provider !== 'vk') {
          throw new BadRequestException({ message: `Блок #${n} (video): поддерживается только provider 'vk'` });
        }
        if (typeof b.url !== 'string' || !isVkVideoUrl(b.url)) {
          throw new BadRequestException({ message: `Блок #${n} (video): некорректная ссылка на видео VK` });
        }
        const block: KnowledgeBlock = { type: 'video', provider: 'vk', url: b.url };
        if (b.caption !== undefined) {
          if (typeof b.caption !== 'string') {
            throw new BadRequestException({ message: `Блок #${n} (video): caption должен быть строкой` });
          }
          block.caption = b.caption;
        }
        out.push(block);
        break;
      }
      default:
        throw new BadRequestException({ message: `Блок #${n}: неизвестный тип «${String(b.type)}»` });
    }
  });
  return out;
}

/**
 * Parse the stored `blocks` JSONB (string or already-parsed array) back into a
 * trusted block array for responses. Re-runs validation defensively and returns
 * `undefined` when empty/null/invalid so renderers fall back to the `body`.
 */
function parseBlocks(raw: unknown): KnowledgeBlock[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  try {
    const blocks = validateBlocks(arr);
    return blocks.length ? blocks : undefined;
  } catch {
    // Stored data should already be valid; never fail a read over it.
    return undefined;
  }
}

// ─── Courses / lessons mappers ────────────────────────────────────────────────

function mapCourseSlim(r: any) {
  const lessonCount = r.lesson_count ?? 0;
  const completedLessons = r.completed_lessons ?? 0;
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? '',
    coverImage: r.cover_image ?? undefined,
    categoryId: r.category_id ?? undefined,
    published: !!r.published,
    sortOrder: r.sort_order ?? 0,
    lessonCount,
    completedLessons,
    progressPercent: lessonCount > 0 ? Math.round((completedLessons / lessonCount) * 100) : 0,
    completed: !!r.completed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Map a lesson row. `includeAnswers` decides whether the quiz carries
 * `correctIndex` — managers (editing) get it, learners NEVER do (so the answer
 * key can't be sniffed from the API). Learners just get `hasQuiz` + the
 * questions/options to render.
 */
function mapLesson(r: any, includeAnswers: boolean) {
  const quiz = parseQuiz(r.quiz);
  return {
    id: r.id,
    title: r.title,
    body: r.body ?? '',
    sortOrder: r.sort_order ?? 0,
    completed: !!r.completed,
    hasQuiz: quiz.length > 0,
    quiz:
      quiz.length === 0
        ? undefined
        : quiz.map((q) => ({
            question: q.question,
            options: q.options,
            ...(includeAnswers ? { correctIndex: q.correctIndex } : {}),
          })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTroubleshooting(r: any) {
  return {
    id: r.id,
    title: r.title,
    system: r.system ?? undefined,
    carMake: r.car_make ?? undefined,
    symptom: r.symptom ?? '',
    cause: r.cause ?? '',
    solution: r.solution ?? '',
    severity: r.severity ?? undefined,
    tags: Array.isArray(r.tags) ? r.tags : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── Quiz helpers ─────────────────────────────────────────────────────────────

/** Validate + normalise a quiz from a DTO before persisting. Returns null when empty. */
function sanitizeQuiz(input: unknown): QuizQuestion[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: QuizQuestion[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const question = (raw as any).question;
    const options = (raw as any).options;
    const correctIndex = (raw as any).correctIndex;
    if (typeof question !== 'string' || !question.trim()) continue;
    if (!Array.isArray(options) || options.length < 2) continue;
    const cleanOptions = options.filter((o: unknown) => typeof o === 'string').map((o: string) => o);
    if (cleanOptions.length < 2) continue;
    const idx = Number(correctIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cleanOptions.length) continue;
    out.push({ question: question.trim(), options: cleanOptions, correctIndex: idx });
  }
  return out.length > 0 ? out : null;
}

/** Parse a quiz JSONB column (string or array) into a typed array. */
function parseQuiz(raw: unknown): QuizQuestion[] {
  if (raw === null || raw === undefined) return [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const cleaned = sanitizeQuiz(arr);
  return cleaned ?? [];
}

/**
 * Grade a quiz. Pass rule (QUIZ_PASS_ALL_CORRECT): every question must be
 * answered correctly. Returns the correct-count and the pass flag.
 */
function gradeQuiz(quiz: QuizQuestion[], answers: number[]): { passed: boolean; correct: number } {
  let correct = 0;
  for (let q = 0; q < quiz.length; q++) {
    if (answers[q] === quiz[q].correctIndex) correct++;
  }
  const passed = QUIZ_PASS_ALL_CORRECT ? correct === quiz.length : correct >= Math.ceil(quiz.length * 0.7);
  return { passed, correct };
}

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim().slice(0, 60);
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
    if (out.length >= 30) break;
  }
  return out;
}

/** Short RU date for a push body, e.g. "14.06.2026". */
function formatDueDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}
