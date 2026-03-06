import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    return this.usersService.getAll(user.tenantID);
  }

  @Get('masters')
  getMasters(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMasters(user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getById(id, user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.tenantID, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.remove(id, user.tenantID, user.userID, user.role);
  }

  // ─── Product Commissions ────────────────────────────────────────────

  @Get(':id/product-commissions')
  getProductCommissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getProductCommissions(id, user.tenantID);
  }

  @Post(':id/product-commissions')
  setProductCommissions(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { productSalaryPercent: number; items: Array<{ productId: string; percent: number }> },
  ) {
    return this.usersService.setProductCommissions(id, user.tenantID, dto);
  }
}
