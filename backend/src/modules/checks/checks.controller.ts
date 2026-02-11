import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ChecksService } from './checks.service';
import { PdfService } from '../pdf/pdf.service';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('checks')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ChecksController {
  constructor(
    private readonly checksService: ChecksService,
    private readonly pdfService: PdfService,
  ) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_view')
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('masterId') masterId?: string,
    @Query('clientId') clientId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.checksService.findAll(tenantId, { page, limit, masterId, clientId, dateFrom, dateTo });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.checksService.findById(tenantId, id);
  }

  @Get(':id/print')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_view')
  async printCheck(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const check = await this.checksService.findById(tenantId, id);
    const tenantName = await this.checksService.getTenantName(tenantId);
    const html = this.pdfService.generateCheckHtml(check, tenantName);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_create')
  create(@TenantId() tenantId: string, @Body() dto: CreateCheckDto, @CurrentUser() user: any) {
    return this.checksService.create(tenantId, dto, user.id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateCheckDto) {
    return this.checksService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_delete')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.checksService.remove(tenantId, id);
  }
}
