import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../../common/guards/permissions.guard';
import { actorPointId } from '../../common/point-scope';
import { OwnerHomeService } from './owner-home.service';

/** Additive internal pilot routes. No legacy report permissions or semantics change. */
@Controller('reports/owner-home')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('director', 'superadmin')
@RequirePermission('financial_reports')
export class OwnerHomeController {
  constructor(private readonly service: OwnerHomeService) {}

  @Get('profit')
  profit(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    return this.service.profit(user.tenantID, actorPointId(user), query.asOf);
  }

  @Get('timeline')
  timeline(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    return this.service.timeline(user.tenantID, actorPointId(user), query);
  }

  @Get('visits')
  visits(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    return this.service.visits(user.tenantID, actorPointId(user), query);
  }

  @Get('clients')
  clients(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    return this.service.clients(user.tenantID, actorPointId(user), query);
  }

  @Get('rapid-returns')
  rapidReturns(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    return this.service.rapidReturns(user.tenantID, actorPointId(user), query);
  }
}
