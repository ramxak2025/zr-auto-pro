import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { User } from '../users/entities/user.entity';

@Controller('salary')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  @Get('my')
  getMySalarySummary(@TenantId() tenantId: string, @CurrentUser() user: User) {
    return this.salaryService.getMasterSalarySummary(tenantId, user.id);
  }

  @Get('my/details')
  getMySalaryDetails(
    @TenantId() tenantId: string,
    @CurrentUser() user: User,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('period') period?: 'day' | 'week' | 'month',
  ) {
    return this.salaryService.getMasterSalary(tenantId, user.id, {
      dateFrom,
      dateTo,
      period,
    });
  }

  @Get('masters')
  @RequirePermissions('profit_view')
  getAllMastersSalary(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.salaryService.getAllMastersSalary(tenantId, { dateFrom, dateTo });
  }

  @Get('masters/:id')
  @RequirePermissions('profit_view')
  getMasterSalarySummary(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.salaryService.getMasterSalarySummary(tenantId, id);
  }

  @Get('masters/:id/details')
  @RequirePermissions('profit_view')
  getMasterSalaryDetails(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('period') period?: 'day' | 'week' | 'month',
  ) {
    return this.salaryService.getMasterSalary(tenantId, id, {
      dateFrom,
      dateTo,
      period,
    });
  }
}
