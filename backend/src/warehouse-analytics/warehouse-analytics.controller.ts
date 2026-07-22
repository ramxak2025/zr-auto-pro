import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { WarehouseAnalyticsService } from './warehouse-analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

class SummaryQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsIn(['week', 'month', 'quarter', 'year'])
  period?: 'week' | 'month' | 'quarter' | 'year';
}

class TopQueryDto {
  @IsOptional()
  @IsIn(['week', 'month', 'quarter', 'year'])
  period?: 'week' | 'month' | 'quarter' | 'year';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class CategoryMarginQueryDto {
  @IsOptional()
  @IsIn(['week', 'month', 'quarter', 'year'])
  period?: 'week' | 'month' | 'quarter' | 'year';
}

class ReorderForecastQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;
}

// Cost/margin analytics — держатели 'warehouse_analytics_view' (ячейка
// warehouse.analytics, миграция 136). ROLE-ONLY (волна «права как в Битрикс24»,
// 2026-07): @Roles(d,a,sa) снят, матрица авторитетна; сиды системных ролей
// (мастер false, админ true) — поведение 1:1, мастер остаётся вне цифр
// себестоимости/маржи, пока владелец явно не выдаст ключ.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('warehouse_analytics_view')
@Controller('warehouse-analytics')
export class WarehouseAnalyticsController {
  constructor(private analytics: WarehouseAnalyticsService) {}

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload, @Query() q: SummaryQueryDto) {
    return this.analytics.getSummary(user.tenantID, {
      warehouseId: q.warehouseId,
      period: q.period,
    });
  }

  @Get('velocity')
  velocity(@CurrentUser() user: JwtPayload, @Query() q: SummaryQueryDto) {
    return this.analytics.getVelocity(user.tenantID, {
      warehouseId: q.warehouseId,
      period: q.period,
    });
  }

  @Get('reorder-forecast')
  reorderForecast(@CurrentUser() user: JwtPayload, @Query() q: ReorderForecastQueryDto) {
    return this.analytics.getReorderForecast(user.tenantID, { warehouseId: q.warehouseId });
  }

  @Get('category-margin')
  categoryMargin(@CurrentUser() user: JwtPayload, @Query() q: CategoryMarginQueryDto) {
    return this.analytics.getCategoryMargin(user.tenantID, { period: q.period });
  }

  @Get('top-moving')
  topMoving(@CurrentUser() user: JwtPayload, @Query() q: TopQueryDto) {
    return this.analytics.getTopMoving(user.tenantID, { period: q.period, limit: q.limit });
  }

  @Get('top-margin')
  topMargin(@CurrentUser() user: JwtPayload, @Query() q: TopQueryDto) {
    return this.analytics.getTopMargin(user.tenantID, { period: q.period, limit: q.limit });
  }
}
