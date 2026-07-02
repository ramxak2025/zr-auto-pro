import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ImportPreviewDto, ImportConfirmDto } from './dto/import-clients-cars.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
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

  @Roles('director', 'admin', 'superadmin')
  @Post('clients-cars/preview')
  preview(@CurrentUser() user: JwtPayload, @Body() body: ImportPreviewDto) {
    const allowForeignPlates = body.options?.allowForeignPlates !== false; // default ON
    return this.imports.preview(user.tenantID, body.rows, { allowForeignPlates });
  }

  @Roles('director', 'admin', 'superadmin')
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
