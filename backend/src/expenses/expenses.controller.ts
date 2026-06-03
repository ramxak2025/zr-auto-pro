import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private expensesService: ExpensesService) {}

  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload) {
    return this.expensesService.getCategories(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.expensesService.createCategory(user.tenantID, dto);
  }

  // Toggle `approvalRequired` (or rename) a category — owner expense-settings.
  @Roles('director', 'admin', 'superadmin')
  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; approvalRequired?: boolean },
  ) {
    return this.expensesService.updateCategory(id, user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.removeCategory(id, user.tenantID);
  }

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.expensesService.getAll(user.tenantID, query);
  }

  // Open to all authenticated users. Non-privileged callers need
  // can_add_expenses=true on their user row — enforced inside the service.
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.expensesService.create(user.tenantID, user.userID, user.role, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.approve(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.reject(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.remove(id, user.tenantID);
  }
}
