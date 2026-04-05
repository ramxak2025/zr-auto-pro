import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('equipment')
export class EquipmentController {
  constructor(private service: EquipmentService) {}

  // ─── Storage Categories ───────────────────────────────────────────
  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload) {
    return this.service.getCategories(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.createCategory(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.removeCategory(id, user.tenantID);
  }

  // ─── Storage Items ────────────────────────────────────────────────
  @Get('storage')
  getStorageItems(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.service.getStorageItems(user.tenantID, query);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('storage')
  createStorageItem(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.createStorageItem(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('storage/:id')
  updateStorageItem(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.updateStorageItem(id, user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('storage/:id')
  removeStorageItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.removeStorageItem(id, user.tenantID);
  }

  // ─── Employee Summary ─────────────────────────────────────────────
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.service.getEmployeeSummary(user.tenantID);
  }

  // ─── My Equipment (for masters) ───────────────────────────────────
  @Get('my')
  getMyEquipment(@CurrentUser() user: JwtPayload) {
    return this.service.getMyEquipment(user.tenantID, user.userID);
  }

  // ─── Issued Equipment by User ─────────────────────────────────────
  @Get('user/:userId')
  getByUser(@Param('userId') userId: string, @CurrentUser() user: JwtPayload, @Query('includeInactive') includeInactive?: string) {
    return this.service.getIssuedByUser(user.tenantID, userId, includeInactive === 'true');
  }

  // ─── Issue to Employee ────────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post('issue')
  issue(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.issueToEmployee(user.tenantID, dto);
  }

  // ─── Replace ──────────────────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/replace')
  replace(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.replaceItem(id, user.tenantID, dto);
  }

  // ─── Trash ────────────────────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/trash')
  trash(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.trashItem(id, user.tenantID, dto?.reason);
  }

  @Get('trash')
  getTrash(@CurrentUser() user: JwtPayload) {
    return this.service.getTrash(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.restoreFromTrash(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/return-storage')
  returnToStorage(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.returnToStorage(id, user.tenantID);
  }

  @Roles('director', 'superadmin')
  @Delete(':id')
  permanentDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.permanentDelete(id, user.tenantID);
  }
}
