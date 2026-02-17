import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('shifts')
@UseGuards(JwtAuthGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  async findAll(@Req() req: any, @Query('date') date?: string) {
    const tenantId = req.user.tenantId;
    return this.shiftsService.findAll(tenantId, date);
  }

  @Get('my')
  async getMyShift(@Req() req: any) {
    const userId = req.user.id;
    const todayStr = new Date().toISOString().split('T')[0];
    return this.shiftsService.getMyShift(userId, todayStr);
  }

  @Post('open')
  async openShift(@Req() req: any, @Body() body: { note?: string }) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    return this.shiftsService.openShift(tenantId, userId, body.note);
  }

  @Post(':id/close')
  async closeShift(@Param('id') id: string) {
    return this.shiftsService.closeShift(id);
  }
}
