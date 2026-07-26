import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChecksService } from './checks.service';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { UpdateCheckCommentDto } from './dto/update-check-comment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// ROLE-ONLY v3 (волна «права как в Битрикс24», 2026-07): все @Roles-хардкоды
// заменены ключами матрицы — enforcement на сервере, не в UI:
//   • checks_view         — читать журнал/доску/дашборд (охват own/all решает
//                           сервис по checks_view_all);
//   • checks_create       — создавать заказ-наряды (сид мастера true);
//   • checks_edit         — редактировать (own/all — checks_edit_all в сервисе);
//   • checks_delete       — корзина: удалить / восстановить / список;
//   • checks_board_manage — CRUD колонок канбан-доски;
//   • settings_manage     — POS-настройки (режим кассовых смен).
// Owner-class (director/superadmin) обходит гейты через PermissionsGuard;
// admin решается матрицей своей роли (сид «Администратора» — полный, 1:1).
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('checks')
export class ChecksController {
  constructor(private checksService: ChecksService) {}

  @RequirePermission('checks_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    // Pass the actor so the service can apply the checks_view_all rule: a master
    // without that permission sees only their own checks (master_id = self).
    // Owner-class roles see every check in the tenant. Response shape unchanged.
    return this.checksService.getAll(user.tenantID, query, user);
  }

  @RequirePermission('checks_view')
  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    // Actor: без `profit_view` суммы прибыли в ответе зануляются (R7).
    return this.checksService.getDashboard(user.tenantID, user);
  }

  /**
   * v3.0.1 ФИЧА 3 — отложенные чеки для карточки-напоминания на главной.
   * Открыт любому аутентифицированному пользователю; охват свои/все решает сервис
   * по роли (owner/director → все; сотрудник → только свои). Объявлен ДО `:id`,
   * чтобы литеральный путь не был перехвачен param-роутом.
   */
  @RequirePermission('checks_view')
  @Get('deferred-reminders')
  getDeferredReminders(@CurrentUser() user: JwtPayload) {
    return this.checksService.getDeferredReminders(user.tenantID, user);
  }

  @RequirePermission('checks_view')
  @Get('dashboard/chart')
  getDashboardChart(@CurrentUser() user: JwtPayload, @Query('period') period: string, @Query('offset') offset: string) {
    // Actor: без `profit_view` линия прибыли в ответе зануляется (R7).
    return this.checksService.getDashboardChart(user.tenantID, period, parseInt(offset) || 0, user);
  }

  @RequirePermission('checks_view')
  @Get('ranking')
  getRanking(@CurrentUser() user: JwtPayload) {
    return this.checksService.getRanking(user.tenantID);
  }

  /**
   * Last visit (most recent check) for a given client and / or car. Used by
   * the cash screen to surface "Последний визит: ..." once a client/car is
   * selected, so the master immediately sees when the customer was here last.
   */
  @RequirePermission('checks_view')
  @Get('last-visit')
  getLastVisit(@CurrentUser() user: JwtPayload, @Query('clientId') clientId?: string, @Query('carId') carId?: string) {
    return this.checksService.getLastVisit(user.tenantID, { clientId, carId });
  }

  /**
   * Kanban board (082): заказ-наряды grouped by work_status, tenant-scoped.
   * Declared BEFORE `:id` so the literal path isn't swallowed by the param route.
   * Returns { accepted, in_progress, ready, delivered }, each newest-first.
   */
  @RequirePermission('checks_view')
  @Get('board')
  getBoard(@CurrentUser() user: JwtPayload) {
    return this.checksService.getBoard(user.tenantID, user);
  }

  // ── Board columns (091): owner-configurable kanban columns ──────────────
  // All declared BEFORE `:id` routes so the literal `board-columns` path (and
  // `board-columns/:id`) is never swallowed by the param routes.

  /**
   * List the tenant's board columns (active + inactive), ordered by sort_order.
   * Read is open to the same board-viewing permission as GET /checks/board.
   */
  @RequirePermission('checks_view')
  @Get('board-columns')
  listBoardColumns(@CurrentUser() user: JwtPayload) {
    return this.checksService.listBoardColumns(user.tenantID);
  }

  /**
   * Create a board column. `checks_board_manage` (сид: director/admin true,
   * master false — 1:1 с прежним @Roles) — masters move checks along the
   * board but cannot reshape it. `key` is auto-derived server-side.
   */
  @RequirePermission('checks_board_manage')
  @Post('board-columns')
  createBoardColumn(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { label?: string; color?: string; notifyClient?: boolean },
  ) {
    return this.checksService.createBoardColumn(user.tenantID, dto);
  }

  /** Edit / reorder / hide a board column. `checks_board_manage`. */
  @RequirePermission('checks_board_manage')
  @Patch('board-columns/:id')
  updateBoardColumn(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { label?: string; color?: string; sortOrder?: number; isActive?: boolean; notifyClient?: boolean },
  ) {
    return this.checksService.updateBoardColumn(user.tenantID, id, dto);
  }

  /**
   * Delete a board column. `checks_board_manage`. Any checks parked in it are
   * taken off the board (work_status → NULL), tenant-scoped & transactional.
   */
  @RequirePermission('checks_board_manage')
  @Delete('board-columns/:id')
  removeBoardColumn(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.deleteBoardColumn(user.tenantID, id);
  }

  // ── POS shift-mode settings (092) ───────────────────────────────────────
  // Declared BEFORE `:id` so the literal `pos-settings` path isn't swallowed by
  // the param route.

  /**
   * Read the tenant's POS «Кассовая смена + роли» mode + whether the CALLER is a
   * cashier. Open to any authenticated role: a master needs the flag to swap its
   * tab bar / order-create flow. `isCashier` is derived server-side (owner-class
   * role OR the `accept_payment` permission).
   */
  @Get('pos-settings')
  getPosSettings(@CurrentUser() user: JwtPayload) {
    return this.checksService.getPosSettings(user.tenantID, user);
  }

  /**
   * Flip POS shift-mode on/off. `settings_manage` (настройки интеграций/кассы —
   * та же ячейка, что и остальные settings-эндпоинты; сид admin=true, 1:1).
   */
  @RequirePermission('settings_manage')
  @Patch('pos-settings')
  updatePosSettings(@CurrentUser() user: JwtPayload, @Body() dto: { shiftModeEnabled?: boolean }) {
    return this.checksService.updatePosSettings(user.tenantID, dto);
  }

  /**
   * Корзина (106): list soft-deleted checks trashed within the last 30 days.
   * `checks_delete` — корзина является частью цикла удаления (тот же ключ, что
   * DELETE / restore). Declared BEFORE `:id` so the literal `trash` path isn't
   * swallowed by the param route.
   */
  @RequirePermission('checks_delete')
  @Get('trash')
  listTrash(@CurrentUser() user: JwtPayload) {
    return this.checksService.listTrash(user.tenantID);
  }

  // ── Метки чеков (Round 12 #9, миграция 140) ─────────────────────────────
  // Литеральный путь `tags` объявлен ДО `:id`-роутов (как board-columns /
  // trash), иначе param-роут проглотил бы его. Метка — учётная бирка чека,
  // денег не двигает; охват прав — существующие ключи, новых не заводим.

  /** Живые метки тенанта — читает любой, кто видит чеки (пикер в Кассе). */
  @RequirePermission('checks_view')
  @Get('tags')
  listTags(@CurrentUser() user: JwtPayload) {
    return this.checksService.listTags(user.tenantID);
  }

  /**
   * Создать метку — любой, кто создаёт чеки (мастер вешает новую метку прямо
   * из Кассы). Дубль по lower(name) среди живых → 409 с существующей меткой.
   */
  @RequirePermission('checks_create')
  @Post('tags')
  createTag(@CurrentUser() user: JwtPayload, @Body() dto: { name?: string; color?: string }) {
    return this.checksService.createTag(user.tenantID, dto);
  }

  /**
   * Переименовать / перекрасить / архивировать метку — settings_manage
   * (owner-class обходит гейт в PermissionsGuard). Архив не трогает старые
   * чеки — только убирает метку из пикера Кассы.
   */
  @RequirePermission('settings_manage')
  @Patch('tags/:id')
  updateTag(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; color?: string; archived?: boolean },
  ) {
    return this.checksService.updateTag(user.tenantID, id, dto);
  }

  @RequirePermission('checks_view')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    // Own-scope (как getAll): мастер без checks_view_all видит по id только свой
    // чек либо чек, где он исполнитель строки, — иначе единый 404. Плюс стрип
    // прибыли без profit_view.
    return this.checksService.getByIdForActor(id, user.tenantID, user);
  }

  /**
   * Set the kanban work-status (082). Additive, orthogonal to payment — moving
   * work along the board is an edit-class action (`checks_edit`, сид мастера
   * true; own-ограничения, как и раньше, нет). Path has two segments so it
   * never collides with `@Patch(':id')`.
   */
  @RequirePermission('checks_edit')
  @Patch(':id/work-status')
  setWorkStatus(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { workStatus?: string }) {
    return this.checksService.setWorkStatus(id, user.tenantID, dto?.workStatus, user);
  }

  /**
   * «Комментарий своего чека — день в день». ЛЮБОЙ авторизованный сотрудник —
   * намеренно БЕЗ @Roles и без edit-permission гейта — может изменить ТОЛЬКО
   * комментарий СВОЕГО чека (master_id = actor) и ТОЛЬКО в календарный день
   * его создания (по Europe/Moscow — той же зоне, что и MSK-кроны продукта),
   * включая уже проведённые чеки. Вчерашний чек так уже не правится. Полное
   * редактирование остаётся за прежним permission-гейтом на @Patch(':id').
   * Всё принуждение (свой/сегодня/не в корзине) — в WHERE самого UPDATE в
   * сервисе. Объявлен ДО @Patch(':id'): двухсегментный литеральный путь
   * не должен проглатываться параметрическим маршрутом (как GET 'trash').
   */
  @Patch(':id/comment')
  updateOwnComment(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateCheckCommentDto) {
    return this.checksService.updateOwnComment(id, user.tenantID, user.userID, dto.comment, user);
  }

  @RequirePermission('checks_create')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCheckDto) {
    // Money-field validation (item 2): the typed DTO makes the global
    // ValidationPipe bound-check price/quantity/cash/card/discount/mileage
    // (0..10M) and strip unknown fields (whitelist). Required-ness / business
    // rules stay in the service with their friendly Russian 400s.
    // `user` is forwarded as the actor so the service can resolve the cashier
    // role-gate (role + permissions) when POS shift-mode is ON. OFF → ignored.
    return this.checksService.create(user.tenantID, user.userID, user.role, dto, user);
  }

  @RequirePermission('checks_edit')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateCheckDto) {
    // Внутри сервиса: own/all — checks_edit_all; дата — checks_change_datetime;
    // оплата ПРОВЕДЁННОГО чека — payment_edit; закрытый чек — edit_closed_check.
    return this.checksService.update(id, user.tenantID, user.role, dto, user.userID, user);
  }

  /**
   * Корзина (106): restore a trashed check — re-applies its full footprint
   * (stock / salary / motivation / warranty / cash-flow) and clears the trash
   * mark, making it effect-identical to before deletion. `checks_delete`. POST
   * with a two-segment path so it never collides with `@Patch(':id')`.
   */
  @RequirePermission('checks_delete')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.restore(id, user.tenantID, user);
  }

  @RequirePermission('checks_delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    // Корзина (106): now a reversible soft-delete. `user.userID` is recorded as
    // deleted_by so the trash list can show who moved it there.
    return this.checksService.remove(id, user.tenantID, user.role, user.userID);
  }
}
