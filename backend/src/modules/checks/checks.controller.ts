import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChecksService } from './checks.service';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('checks')
@UseGuards(JwtAuthGuard)
export class ChecksController {
  constructor(private readonly checksService: ChecksService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_view')
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('masterId') masterId?: string,
    @Query('clientId') clientId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.checksService.findAll({ page, limit, masterId, clientId, dateFrom, dateTo });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_view')
  findOne(@Param('id') id: string) {
    return this.checksService.findById(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_create')
  create(@Body() dto: CreateCheckDto, @CurrentUser() user: any) {
    return this.checksService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_edit')
  update(@Param('id') id: string, @Body() dto: UpdateCheckDto) {
    return this.checksService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('checks_delete')
  remove(@Param('id') id: string) {
    return this.checksService.remove(id);
  }
}
