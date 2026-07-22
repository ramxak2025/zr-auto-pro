import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission, userHasPermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// ROLE-ONLY (волна «права как в Битрикс24», 2026-07). Матрица роли авторитетна:
//   • вносить расходы          → 'can_add_expenses' (ячейка expenses.add);
//   • утверждать/удалять       → 'financial_reports' (финансовые решения);
//   • справочник категорий:
//       чтение — открыто (нужно форме расхода), мутации → 'settings_manage'.
// GET / (список) — OR-гейт в хэндлере: вносящий видит список для контекста,
// финансист — тоже; owner-class (director/superadmin) проходит всегда.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private expensesService: ExpensesService) {}

  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload) {
    return this.expensesService.getCategories(user.tenantID);
  }

  @RequirePermission('settings_manage')
  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.expensesService.createCategory(user.tenantID, dto);
  }

  // Toggle `approvalRequired` (or rename) a category — owner expense-settings.
  @RequirePermission('settings_manage')
  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; approvalRequired?: boolean; isRecurring?: boolean },
  ) {
    return this.expensesService.updateCategory(id, user.tenantID, dto);
  }

  @RequirePermission('settings_manage')
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.removeCategory(id, user.tenantID);
  }

  // OR-гейт (у @RequirePermission один ключ — проверяем руками, как scope-проверки
  // в salary.controller): список расходов видит тот, кто их вносит (контекст
  // своих заявок), и тот, кто ими управляет (financial_reports). Раньше был
  // открыт любому сотруднику — API отдавал все суммы тенанта даже мастеру без
  // прав на финансы.
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    if (!userHasPermission(user, 'can_add_expenses') && !userHasPermission(user, 'financial_reports')) {
      throw new ForbiddenException({ message: 'Недостаточно прав для этого действия' });
    }
    return this.expensesService.getAll(user.tenantID, query);
  }

  @RequirePermission('can_add_expenses')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.expensesService.create(user, dto);
  }

  @RequirePermission('financial_reports')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.approve(id, user.tenantID);
  }

  @RequirePermission('financial_reports')
  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.reject(id, user.tenantID);
  }

  @RequirePermission('financial_reports')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.remove(id, user.tenantID);
  }
}
