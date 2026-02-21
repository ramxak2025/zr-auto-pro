import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.clientsService.getAll(user.tenantID, query);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.getById(id, user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.clientsService.create(user.tenantID, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.clientsService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.remove(id, user.tenantID);
  }
}
