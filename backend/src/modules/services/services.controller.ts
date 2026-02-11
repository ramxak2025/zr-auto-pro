import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('services')
@UseGuards(JwtAuthGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.servicesService.findAll({ page, limit, search, category });
  }

  @Get('categories')
  getCategories() {
    return this.servicesService.getCategories();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.servicesService.findById(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('warehouse_access')
  create(@Body() dto: CreateServiceDto) {
    return this.servicesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('warehouse_access')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('warehouse_access')
  remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }
}
