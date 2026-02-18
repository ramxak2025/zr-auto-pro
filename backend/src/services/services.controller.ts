import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ServicesAppService } from './services.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private servicesAppService: ServicesAppService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.servicesAppService.findAll(user.tenantId, query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.servicesAppService.findById(id);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.servicesAppService.create(body, user.tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.servicesAppService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servicesAppService.remove(id);
  }
}
