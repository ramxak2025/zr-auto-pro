import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.clientsService.findAll(user.tenantId, query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.clientsService.findById(id);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.clientsService.create(body, user.tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.clientsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}
