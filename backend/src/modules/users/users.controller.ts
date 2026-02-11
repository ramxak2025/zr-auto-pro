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
  ParseUUIDPipe,
  ClassSerializerInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPermissions, UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('user_management')
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('role') role?: UserRole,
  ) {
    return this.usersService.findAll(tenantId, { page, limit, search, role });
  }

  @Get('masters')
  getMasters(@TenantId() tenantId: string) {
    return this.usersService.getMasters(tenantId);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(tenantId, id);
  }

  @Post()
  @Permissions('user_management')
  create(@TenantId() tenantId: string, @Body() dto: CreateUserDto) {
    return this.usersService.create(tenantId, dto);
  }

  @Patch(':id')
  @Permissions('user_management')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(tenantId, id, dto);
  }

  @Patch(':id/permissions')
  @Permissions('user_management')
  updatePermissions(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() permissions: Partial<UserPermissions>,
  ) {
    return this.usersService.updatePermissions(tenantId, id, permissions);
  }

  @Delete(':id')
  @Permissions('user_management')
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(tenantId, id);
  }
}
