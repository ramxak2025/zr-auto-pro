import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateSalaryPaymentDto } from './dto/create-payment.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salary')
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  // Listing every master's earnings + paid-out amounts reveals what every
  // colleague is getting paid — that is owner / director / admin level data.
  @Roles('director', 'admin', 'superadmin')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getAll(user.tenantID, query);
  }

  // `getMy` filters by the JWT subject inside the service — every authenticated
  // user is allowed to see their OWN earnings. No role gate.
  @Get('my')
  getMy(@CurrentUser() user: JwtPayload) {
    return this.salaryService.getMy(user.tenantID, user.userID);
  }

  // Same reasoning as getAll — payment history of every employee is internal
  // finance data.
  @Roles('director', 'admin', 'superadmin')
  @Get('payments')
  getPayments(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getPayments(user.tenantID, query);
  }

  @Roles('director', 'superadmin')
  @Post('payments')
  createPayment(@CurrentUser() user: JwtPayload, @Body() dto: CreateSalaryPaymentDto) {
    return this.salaryService.createPayment(user.tenantID, user.userID, dto);
  }
}
