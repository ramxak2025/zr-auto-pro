import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CarsService } from './cars.service';
import { CreateCarDto } from './dto/create-car.dto';
import { UpdateCarDto } from './dto/update-car.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('cars')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Get()
  @RequirePermissions('clients_view')
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.carsService.findAll({ page, limit, search, clientId });
  }

  @Get(':id')
  @RequirePermissions('clients_view')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.carsService.findById(id);
  }

  @Post()
  @RequirePermissions('clients_edit')
  create(@Body() dto: CreateCarDto) {
    return this.carsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('clients_edit')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCarDto,
  ) {
    return this.carsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clients_edit')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.carsService.remove(id);
  }
}
