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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @RequirePermissions('clients_view')
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.clientsService.findAll({ page, limit, search });
  }

  @Get(':id/stats')
  @RequirePermissions('clients_view')
  getClientStats(@Param('id') id: string) {
    return this.clientsService.getClientStats(id);
  }

  @Get(':id')
  @RequirePermissions('clients_view')
  findById(@Param('id') id: string) {
    return this.clientsService.findById(id);
  }

  @Post()
  @RequirePermissions('clients_edit')
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('clients_edit')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clients_edit')
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}
