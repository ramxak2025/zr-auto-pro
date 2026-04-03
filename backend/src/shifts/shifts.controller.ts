import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.getAll(user.tenantID);
  }

  @Get('my')
  getMy(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.getMy(user.userID, user.tenantID);
  }

  @Post('open')
  open(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.open(user.userID, user.tenantID);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.shiftsService.close(id, user.tenantID, user.userID);
  }
}
