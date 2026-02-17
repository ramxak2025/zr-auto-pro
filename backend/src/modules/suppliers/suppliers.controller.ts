import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';

import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query('search') search?: string,
  ) {
    return this.suppliersService.findAll(req.user.tenantId, search);
  }

  // ── Deliveries (must be before :id) ────────────────────────

  @Get('deliveries')
  async getDeliveries(
    @Request() req: any,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.suppliersService.getDeliveries(req.user.tenantId, supplierId);
  }

  @Post('deliveries')
  async createDelivery(@Request() req: any, @Body() body: any) {
    return this.suppliersService.createDelivery({
      ...body,
      tenantId: req.user.tenantId,
    });
  }

  @Get('deliveries/:id')
  async getDeliveryById(@Param('id') id: string) {
    return this.suppliersService.getDeliveryById(id);
  }

  // ── Payments (must be before :id) ──────────────────────────

  @Get('payments')
  async getPayments(
    @Request() req: any,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.suppliersService.getPayments(req.user.tenantId, supplierId);
  }

  @Post('payments')
  async createPayment(@Request() req: any, @Body() body: any) {
    return this.suppliersService.createPayment({
      ...body,
      tenantId: req.user.tenantId,
    });
  }

  // ── Supplier CRUD ──────────────────────────────────────────

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.suppliersService.findById(id);
  }

  @Post()
  async create(@Request() req: any, @Body() body: any) {
    return this.suppliersService.create({
      ...body,
      tenantId: req.user.tenantId,
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.suppliersService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }
}
