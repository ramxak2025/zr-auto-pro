import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ChecksService } from './checks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('checks')
export class ChecksController {
  constructor(private checksService: ChecksService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.checksService.findAll(user.tenantId, query);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser() user: any) {
    return this.checksService.getDashboard(user.tenantId);
  }

  @Get('ranking')
  getRanking(@CurrentUser() user: any) {
    return this.checksService.getRanking(user.tenantId);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.checksService.findById(id);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.checksService.create(body, user.tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.checksService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.checksService.remove(id);
  }
}
