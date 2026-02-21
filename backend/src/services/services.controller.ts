import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.servicesService.getAll(user.tenantID, query);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.getById(id, user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.servicesService.create(user.tenantID, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.servicesService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.remove(id, user.tenantID);
  }
}
