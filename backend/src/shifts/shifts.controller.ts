import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.shiftsService.findAll(user.tenantId, query);
  }

  @Get('my')
  getMy(@CurrentUser('id') userId: string) {
    return this.shiftsService.getMy(userId);
  }

  @Post('open')
  open(@CurrentUser() user: any, @Body() body: any) {
    return this.shiftsService.open(user.id, user.tenantId, body);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.shiftsService.close(id);
  }
}
