import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ImportPreviewDto, ImportConfirmDto } from './dto/import-clients-cars.dto';

// ROLE-ONLY (волна «права как в Битрикс24», 2026-07): импорт создаёт/меняет
// клиентов и авто массово → гейт 'clients_edit' вместо @Roles(d,a,sa).
// Сиды системных ролей (мастер false, админ true) — поведение 1:1.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** CSV template — open to any logged-in role. */
  @Get('clients-cars/template')
  getClientsCarsTemplate(@Res() res: Response) {
    const csv = this.imports.getClientsCarsTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients_cars_template.csv"');
    // BOM so Excel opens it as UTF-8 by default.
    res.send('﻿' + csv);
  }

  @RequirePermission('clients_edit')
  @Post('clients-cars/preview')
  preview(@CurrentUser() user: JwtPayload, @Body() body: ImportPreviewDto) {
    const allowForeignPlates = body.options?.allowForeignPlates !== false; // default ON
    return this.imports.preview(user.tenantID, body.rows, { allowForeignPlates });
  }

  @RequirePermission('clients_edit')
  @Post('clients-cars/confirm')
  confirm(@CurrentUser() user: JwtPayload, @Body() body: ImportConfirmDto) {
    const allowForeignPlates = body.options?.allowForeignPlates !== false;
    return this.imports.confirm(
      user.tenantID,
      user.userID,
      body.rows,
      { allowForeignPlates },
      { defaultAction: body.duplicateDefault, decisions: body.decisions },
    );
  }
}
