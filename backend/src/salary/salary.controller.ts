import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('salary')
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  @Get()
  getAll(@CurrentUser() user: any, @Query() query: any) {
    return this.salaryService.getAll(user.tenantId, query);
  }

  @Get('my')
  getMy(@CurrentUser('id') userId: string) {
    return this.salaryService.getMy(userId);
  }
}
