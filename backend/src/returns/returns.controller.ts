import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ReturnsService, CreateReturnDto } from './returns.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Returns are a financial event. Masters MUST NOT issue refunds on their own
// orders — the role-restriction here matches the rest of the destructive
// owner-only endpoints (checks remove, stock-movements create).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('director', 'admin', 'superadmin')
@Controller('returns')
export class ReturnsController {
  constructor(private returnsService: ReturnsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: { from?: string; to?: string }) {
    return this.returnsService.list(user.tenantID, query);
  }

  @Post(':checkId')
  create(@Param('checkId') checkId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateReturnDto) {
    return this.returnsService.createReturn(user.tenantID, user.userID, checkId, dto);
  }
}
