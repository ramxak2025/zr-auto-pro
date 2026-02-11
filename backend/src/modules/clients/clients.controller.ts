import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @RequirePermissions('clients_view')
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.clientsService.findAll(tenantId, { page, limit, search });
  }

  @Get(':id/stats')
  @RequirePermissions('clients_view')
  getClientStats(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.clientsService.getClientStats(tenantId, id);
  }

  @Get(':id')
  @RequirePermissions('clients_view')
  findById(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.clientsService.findById(tenantId, id);
  }

  @Post()
  @RequirePermissions('clients_edit')
  create(@TenantId() tenantId: string, @Body() dto: CreateClientDto) {
    return this.clientsService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('clients_edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clients_edit')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.clientsService.remove(tenantId, id);
  }
}
