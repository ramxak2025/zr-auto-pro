import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ProductKitsService } from './product-kits.service';
import { AssembleKitDto, DisassembleKitDto, KitRecipeDto, RecomposeKitDto } from './product-kits.dto';
class UpdateKitRecipeDto extends KitRecipeDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('product-kits')
export class ProductKitsController {
  constructor(private readonly kits: ProductKitsService) {}
  @RequirePermission('warehouse_access') @Get('recipes') recipes(@CurrentUser() actor: JwtPayload) {
    return this.kits.recipes(actor);
  }
  @RequirePermission('warehouse_manage') @Post('recipes') recipe(
    @Body() dto: KitRecipeDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.kits.saveRecipe(dto, actor);
  }
  @RequirePermission('warehouse_manage') @Patch('recipes/:id') updateRecipe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateKitRecipeDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.kits.saveRecipe(dto, actor, id, dto.expectedVersion);
  }
  @RequirePermission('warehouse_manage') @Post('assemble') assemble(
    @Body() dto: AssembleKitDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.kits.assemble(dto, actor);
  }
  @RequirePermission('warehouse_access') @Get(':id') get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.kits.get(id, actor);
  }
  @RequirePermission('warehouse_manage') @Post(':id/disassemble') disassemble(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DisassembleKitDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.kits.disassemble(id, dto, actor);
  }
  @RequirePermission('warehouse_manage') @Post(':id/recompose') recompose(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecomposeKitDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.kits.recompose(id, dto, actor);
  }
}
