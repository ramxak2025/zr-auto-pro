import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('shifts')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post('open')
  open(@TenantId() tenantId: string, @CurrentUser() user: any) {
    return this.shiftsService.openShift(tenantId, user.id);
  }

  @Post('close')
  close(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body('note') note?: string,
  ) {
    return this.shiftsService.closeShift(tenantId, user.id, note);
  }

  @Get('my')
  getMyShift(@TenantId() tenantId: string, @CurrentUser() user: any) {
    return this.shiftsService.getMyShift(tenantId, user.id);
  }

  @Get('today')
  getTodayShifts(@TenantId() tenantId: string) {
    return this.shiftsService.getTodayShifts(tenantId);
  }

  @Get('history')
  getHistory(
    @TenantId() tenantId: string,
    @Query('userId') userId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.shiftsService.getShiftHistory(tenantId, {
      userId,
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }
}
