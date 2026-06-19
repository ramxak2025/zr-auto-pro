import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PermissionTemplatesService } from './permission-templates.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreatePermissionTemplateDto } from './dto/create-permission-template.dto';
import { UpdatePermissionTemplateDto } from './dto/update-permission-template.dto';

// Named permission templates («роли»). Managing templates AND applying them to
// employees is the same owner-class operation as editing a user's permission
// map directly, so this controller carries the SAME role gate as the user
// permissions endpoints (PATCH /users/:id/permissions): director / admin /
// superadmin only. Everything is tenant-scoped via the JWT in the service.
const MANAGER_ROLES = ['director', 'admin', 'superadmin'] as const;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...MANAGER_ROLES)
@Controller('permission-templates')
export class PermissionTemplatesController {
  constructor(private readonly service: PermissionTemplatesService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    return this.service.getAll(user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePermissionTemplateDto) {
    return this.service.create(user.tenantID, dto.name, dto.permissions);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdatePermissionTemplateDto) {
    return this.service.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.tenantID);
  }

  // Apply: copy the template's permission map onto the target user. Delegates to
  // UsersService.updatePermissions (tenant-scoped target + self-lockout guard).
  @Post(':id/apply/:userId')
  apply(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.service.apply(id, userId, user.tenantID, user.userID);
  }
}
