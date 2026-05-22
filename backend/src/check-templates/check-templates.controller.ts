import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CheckTemplatesService } from './check-templates.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('check-templates')
export class CheckTemplatesController {
  constructor(private readonly checkTemplatesService: CheckTemplatesService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    return this.checkTemplatesService.getAll(user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: { name: string; services: any[]; products: any[] }) {
    return this.checkTemplatesService.create(user.tenantID, dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; services?: any[]; products?: any[] },
  ) {
    return this.checkTemplatesService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checkTemplatesService.remove(id, user.tenantID);
  }
}
