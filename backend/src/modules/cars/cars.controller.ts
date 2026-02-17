import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CarsService } from './cars.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Car } from './car.entity';

@Controller('cars')
@UseGuards(JwtAuthGuard)
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Get()
  async findAll(
    @Req() req: any,
    @Query('clientId') clientId?: string,
    @Query('tenantId') queryTenantId?: string,
  ) {
    const tenantId =
      req.user.role === 'superadmin' && queryTenantId
        ? queryTenantId
        : req.user.tenantId;
    return this.carsService.findAll(tenantId, clientId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.carsService.findById(id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: Partial<Car>) {
    dto.tenantId = req.user.tenantId;
    return this.carsService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<Car>) {
    return this.carsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.carsService.remove(id);
    return { message: 'Car deleted successfully' };
  }
}
