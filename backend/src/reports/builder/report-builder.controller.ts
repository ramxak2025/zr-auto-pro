import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ReportBuilderService } from './report-builder.service';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * Конструктор отчётов — GET /reports/builder/*.
 *
 * Права НЕ навешаны классовым @RequirePermission('financial_reports'), как у
 * соседнего ReportsController: доступ к разделу — «financial_reports ИЛИ право
 * конкретного отчёта из каталога» (завскладом открывает «По товарам» по
 * warehouse_access). Решение принимает ReportBuilderService одним правилом и
 * для каталога (available/reason), и для запуска (403 с тем же текстом).
 *
 * Литеральные маршруты `catalog` и `filters/:kind` объявлены ДО `:reportId` —
 * иначе Express отдал бы 'catalog' как id отчёта.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports/builder')
export class ReportBuilderController {
  constructor(private readonly service: ReportBuilderService) {}

  @Get('catalog')
  catalog(@CurrentUser() user: JwtPayload) {
    return this.service.catalog(user);
  }

  @Get('filters/:kind')
  filters(@CurrentUser() user: JwtPayload, @Param('kind') kind: string) {
    return this.service.filterOptions(user, kind);
  }

  @Get(':reportId')
  run(@CurrentUser() user: JwtPayload, @Param('reportId') reportId: string, @Query() query: ReportQueryDto) {
    return this.service.run(user, reportId, query);
  }
}
