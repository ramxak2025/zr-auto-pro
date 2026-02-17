import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from './user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(@Req() req: any, @Query('tenantId') queryTenantId?: string) {
    const tenantId =
      req.user.role === 'superadmin' && queryTenantId
        ? queryTenantId
        : req.user.tenantId;
    return this.usersService.findAll(tenantId);
  }

  @Get('masters')
  async findMasters(@Req() req: any, @Query('tenantId') queryTenantId?: string) {
    const tenantId =
      req.user.role === 'superadmin' && queryTenantId
        ? queryTenantId
        : req.user.tenantId;
    return this.usersService.findMasters(tenantId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: Partial<User>) {
    dto.tenantId = req.user.tenantId;
    return this.usersService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<User>) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);
    return { message: 'User deleted successfully' };
  }
}
