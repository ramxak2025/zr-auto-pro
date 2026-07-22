import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { WarrantyService } from './warranty.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

class RedeemWarrantyDto {
  @IsString()
  checkId!: string;
}

class ActiveWarrantyQueryDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  carId?: string;
}

// Reads (active / active-for-car) — открыты любому аутентифицированному:
// Касса подсвечивает активные гарантии при выборе клиента/авто. `redeem` —
// часть проведения чека → 'checks_create' (сид мастера true — 1:1);
// owner-class (director/superadmin) обходит через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('warranty-claims')
export class WarrantyController {
  constructor(private warrantyService: WarrantyService) {}

  /**
   * Active warranty claims for the given client and/or car.
   * Called by the cash screen when the master picks a client/car so the UI
   * can offer "взять по гарантии" before the check is built.
   */
  @Get('active')
  active(@CurrentUser() user: JwtPayload, @Query() q: ActiveWarrantyQueryDto) {
    return this.warrantyService.getActive(user.tenantID, {
      clientId: q.clientId,
      carId: q.carId,
    });
  }

  /**
   * Active warranties for one car, badge-ready (itemType / itemName /
   * warrantyDays / expiresAt), soonest-to-expire first. The CheckCreate
   * screen shows these as "Диагностика ещё 24 дня" chips when a car is picked.
   */
  @Get('active-for-car/:carId')
  activeForCar(@Param('carId') carId: string, @CurrentUser() user: JwtPayload) {
    return this.warrantyService.listActiveForCar(user.tenantID, carId);
  }

  /**
   * Mark a claim as redeemed against a specific newly-created check.
   * Idempotent in the sense that re-calling for an already-used claim
   * throws BadRequest (the FE blocks it but we never silently re-use).
   */
  @RequirePermission('checks_create')
  @Post(':id/redeem')
  redeem(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RedeemWarrantyDto) {
    return this.warrantyService.redeem(user.tenantID, id, dto.checkId);
  }
}
