import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
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

  @Roles('director', 'admin', 'superadmin')
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.removeCategory(id, user.tenantID);
  }

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.expensesService.getAll(user.tenantID, query);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.expensesService.create(user.tenantID, user.userID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.remove(id, user.tenantID);
  }
}
