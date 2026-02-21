import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('salary')
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getAll(user.tenantID, query);
  }

  @Get('my')
  getMy(@CurrentUser() user: JwtPayload) {
    return this.salaryService.getMy(user.tenantID, user.userID);
  }
}
