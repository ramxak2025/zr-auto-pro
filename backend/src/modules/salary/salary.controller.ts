import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('salary')
@UseGuards(JwtAuthGuard)
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  @Get()
  async getMasterSalaries(
    @Req() req: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.salaryService.getMasterSalaries(tenantId, dateFrom, dateTo);
  }

  @Get('my')
  async getMySalary(@Req() req: any) {
    const userId = req.user.id;
    const tenantId = req.user.tenantId;
    return this.salaryService.getMySalary(userId, tenantId);
  }
}
