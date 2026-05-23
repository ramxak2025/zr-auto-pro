import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { JournalService } from './journal.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

class WarehouseDocsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(['purchase', 'return_to_supplier', 'defect_transfer', 'writeoff', 'supplier_payment', 'used_purchase'])
  type?:
    | 'purchase'
    | 'return_to_supplier'
    | 'defect_transfer'
    | 'writeoff'
    | 'supplier_payment'
    | 'used_purchase';
}

// All financial documents — finance role only.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('director', 'admin', 'superadmin')
@Controller('journal')
export class JournalController {
  constructor(private journal: JournalService) {}

  @Get('warehouse-docs')
  warehouseDocs(@CurrentUser() user: JwtPayload, @Query() q: WarehouseDocsQueryDto) {
    return this.journal.getWarehouseDocs(user.tenantID, q);
  }
}
