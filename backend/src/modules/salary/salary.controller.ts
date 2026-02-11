import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('salary')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  @Get('my')
  getMySalarySummary(@CurrentUser() user: User) {
    return this.salaryService.getMasterSalarySummary(user.id);
  }

  @Get('my/details')
  getMySalaryDetails(
    @CurrentUser() user: User,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('period') period?: 'day' | 'week' | 'month',
  ) {
    return this.salaryService.getMasterSalary(user.id, {
      dateFrom,
      dateTo,
      period,
    });
  }

  @Get('masters')
  @RequirePermissions('profit_view')
  getAllMastersSalary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.salaryService.getAllMastersSalary({ dateFrom, dateTo });
  }

  @Get('masters/:id')
  @RequirePermissions('profit_view')
  getMasterSalarySummary(@Param('id') id: string) {
    return this.salaryService.getMasterSalarySummary(id);
  }

  @Get('masters/:id/details')
  @RequirePermissions('profit_view')
  getMasterSalaryDetails(
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('period') period?: 'day' | 'week' | 'month',
  ) {
    return this.salaryService.getMasterSalary(id, {
      dateFrom,
      dateTo,
      period,
    });
  }
}
