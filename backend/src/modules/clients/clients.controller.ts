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
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Client } from './client.entity';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  async findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tenantId') queryTenantId?: string,
  ) {
    const tenantId =
      req.user.role === 'superadmin' && queryTenantId
        ? queryTenantId
        : req.user.tenantId;
    return this.clientsService.findAll(
      tenantId,
      search,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.clientsService.findById(id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: Partial<Client>) {
    dto.tenantId = req.user.tenantId;
    return this.clientsService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<Client>) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.clientsService.remove(id);
    return { message: 'Client deleted successfully' };
  }
}
